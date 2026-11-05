//! Folder sync: chats, memories and notes as JSON files in a folder the user chooses
//! (typically inside iCloud Drive, Dropbox, OneDrive or Google Drive). Only these paths
//! are accepted, all inside "<chosen folder>/Page Aura Sync":
//!   chats/<id>.json, deleted/<id>.json, memories.json, notes.json
//! Writes go to a temporary file first and are then renamed, so a sync client never
//! picks up a half-written file.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

const SUBDIR: &str = "Page Aura Sync";

pub struct SyncDir {
    dir: Mutex<Option<PathBuf>>,
    config: PathBuf,
}

impl SyncDir {
    pub fn load(app_dir: &Path) -> Self {
        let config = app_dir.join("sync.json");
        let dir = std::fs::read_to_string(&config)
            .ok()
            .and_then(|s| serde_json::from_str::<PathBuf>(&s).ok())
            .filter(|p| p.is_dir());
        Self { dir: Mutex::new(dir), config }
    }
    fn get(&self) -> Result<PathBuf, String> {
        self.dir.lock().map_err(|e| e.to_string())?.clone().ok_or_else(|| "No sync folder chosen".to_string())
    }
    fn set(&self, p: Option<PathBuf>) -> Result<(), String> {
        match &p {
            Some(p) => std::fs::write(&self.config, serde_json::to_string(p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?,
            None => {
                let _ = std::fs::remove_file(&self.config);
            }
        }
        *self.dir.lock().map_err(|e| e.to_string())? = p;
        Ok(())
    }
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Accepts only the documented layout and returns the relative path.
fn check_rel(rel: &str) -> Result<PathBuf, String> {
    if rel == "memories.json" || rel == "notes.json" {
        return Ok(PathBuf::from(rel));
    }
    let (sub, file) = rel.split_once('/').ok_or("invalid sync path")?;
    let id = file.strip_suffix(".json").ok_or("invalid sync path")?;
    if !(sub == "chats" || sub == "deleted") || !valid_id(id) {
        return Err("invalid sync path".into());
    }
    Ok(Path::new(sub).join(file))
}

#[derive(Serialize)]
pub struct Status {
    path: String,
    name: String,
    ready: bool,
}

fn status_for(dir: &Path) -> Status {
    let parent = dir.parent().unwrap_or(dir);
    Status {
        path: dir.display().to_string(),
        name: parent.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| parent.display().to_string()),
        ready: true,
    }
}

#[tauri::command]
pub fn sync_status(sync: State<'_, SyncDir>) -> Option<Status> {
    sync.get().ok().map(|d| status_for(&d))
}

#[tauri::command]
pub async fn sync_pick(app: AppHandle, sync: State<'_, SyncDir>) -> Result<Option<Status>, String> {
    let Some(fp) = app.dialog().file().set_title("Choose a folder to sync Page Aura with").blocking_pick_folder() else {
        return Ok(None);
    };
    let root = fp.into_path().map_err(|e| e.to_string())?;
    let dir = root.join(SUBDIR);
    for sub in ["chats", "deleted"] {
        tokio::fs::create_dir_all(dir.join(sub)).await.map_err(|e| e.to_string())?;
    }
    let dir = dir.canonicalize().map_err(|e| e.to_string())?;
    sync.set(Some(dir.clone()))?;
    Ok(Some(status_for(&dir)))
}

#[tauri::command]
pub fn sync_clear(sync: State<'_, SyncDir>) -> Result<(), String> {
    sync.set(None)
}

#[derive(Serialize)]
pub struct Listed {
    name: String,
    modified: u64,
}

#[tauri::command]
pub async fn sync_list(sync: State<'_, SyncDir>, sub: String) -> Result<Vec<Listed>, String> {
    if sub != "chats" && sub != "deleted" {
        return Err("invalid folder".into());
    }
    let dir = sync.get()?.join(&sub);
    tokio::task::spawn_blocking(move || list_dir(&dir)).await.map_err(|e| e.to_string())?
}

/// Blocking directory scan behind `sync_list`; runs on the blocking thread pool.
fn list_dir(dir: &Path) -> Result<Vec<Listed>, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Some(id) = name.strip_suffix(".json") else { continue };
        if !valid_id(id) || !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let modified = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(Listed { name, modified });
    }
    Ok(out)
}

#[tauri::command]
pub async fn sync_read(sync: State<'_, SyncDir>, rel: String) -> Result<String, String> {
    let path = sync.get()?.join(check_rel(&rel)?);
    let meta = tokio::fs::symlink_metadata(&path).await.map_err(|_| format!("{rel} not found"))?;
    if !meta.is_file() || meta.len() > 200 * 1024 * 1024 {
        return Err(format!("{rel} can't be read"));
    }
    tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_write(sync: State<'_, SyncDir>, rel: String, text: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&text).map_err(|_| "sync files must be JSON".to_string())?;
    let path = sync.get()?.join(check_rel(&rel)?);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, text.as_bytes()).await.map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp, &path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_delete(sync: State<'_, SyncDir>, rel: String) -> Result<(), String> {
    let path = sync.get()?.join(check_rel(&rel)?);
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Manager;

    /// A throwaway sync folder, plus a mock app that manages a `SyncDir` pointing at it.
    fn fixture(tag: &str) -> (PathBuf, tauri::App<tauri::test::MockRuntime>) {
        let base = std::env::temp_dir().join(format!("page-aura-sync-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let dir = base.join(SUBDIR);
        std::fs::create_dir_all(&dir).unwrap();
        let app = tauri::test::mock_app();
        app.manage(SyncDir { dir: Mutex::new(Some(dir.canonicalize().unwrap())), config: base.join("sync.json") });
        (base, app)
    }

    const BAD_PATHS: &[&str] = &[
        "../x.json",
        "chats/../../etc.json",
        "chats/../notes.json",
        "chats/a/b.json",
        "other/a.json",
        "chats/a.txt",
        "/etc/passwd",
        "chats/.json",
        "chats/..%2f..%2fx.json",
        "chats/a\\b.json",
        "chats//a.json",
        "",
    ];

    #[tokio::test]
    async fn read_write_delete_reject_traversal() {
        let (base, app) = fixture("reject");
        // A file outside the sync folder that a traversal would reach.
        std::fs::write(base.join("secret.json"), "{}").unwrap();
        for bad in BAD_PATHS {
            assert_eq!(sync_read(app.state::<SyncDir>(), bad.to_string()).await, Err("invalid sync path".to_string()), "read {bad}");
            assert_eq!(sync_write(app.state::<SyncDir>(), bad.to_string(), "{}".into()).await, Err("invalid sync path".to_string()), "write {bad}");
            assert_eq!(sync_delete(app.state::<SyncDir>(), bad.to_string()).await, Err("invalid sync path".to_string()), "delete {bad}");
        }
        assert!(base.join("secret.json").exists());
        for bad in ["..", "../chats", "chats/", "Chats", "", "memories.json"] {
            assert_eq!(sync_list(app.state::<SyncDir>(), bad.to_string()).await.err(), Some("invalid folder".to_string()), "list {bad}");
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn write_read_list_delete_round_trip() {
        let (base, app) = fixture("roundtrip");
        sync_write(app.state::<SyncDir>(), "chats/abc.json".into(), "{\"a\":1}".into()).await.unwrap();
        sync_write(app.state::<SyncDir>(), "notes.json".into(), "[]".into()).await.unwrap();
        assert_eq!(sync_write(app.state::<SyncDir>(), "notes.json".into(), "not json".into()).await, Err("sync files must be JSON".to_string()));
        assert_eq!(sync_read(app.state::<SyncDir>(), "chats/abc.json".into()).await.unwrap(), "{\"a\":1}");
        assert_eq!(sync_read(app.state::<SyncDir>(), "chats/nope.json".into()).await, Err("chats/nope.json not found".to_string()));
        // No temporary file is left behind after the rename.
        assert!(!base.join(SUBDIR).join("chats/abc.json.tmp").exists());

        let dir = base.join(SUBDIR).join("chats");
        std::fs::write(dir.join("junk.txt"), "x").unwrap();
        std::fs::write(dir.join("bad id.json"), "{}").unwrap();
        std::fs::create_dir(dir.join("subdir.json")).unwrap();
        let listed = sync_list(app.state::<SyncDir>(), "chats".into()).await.unwrap();
        assert_eq!(listed.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(), ["abc.json"]);
        assert!(listed[0].modified > 0);
        // Listing a folder that does not exist yet creates it.
        assert!(sync_list(app.state::<SyncDir>(), "deleted".into()).await.unwrap().is_empty());

        sync_delete(app.state::<SyncDir>(), "chats/abc.json".into()).await.unwrap();
        sync_delete(app.state::<SyncDir>(), "chats/abc.json".into()).await.unwrap(); // already gone is fine
        assert!(!dir.join("abc.json").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn read_refuses_symlinks() {
        let (base, app) = fixture("symlink");
        std::fs::write(base.join("outside.json"), "{}").unwrap();
        let chats = base.join(SUBDIR).join("chats");
        std::fs::create_dir_all(&chats).unwrap();
        std::os::unix::fs::symlink(base.join("outside.json"), chats.join("link.json")).unwrap();
        assert_eq!(sync_read(app.state::<SyncDir>(), "chats/link.json".into()).await, Err("chats/link.json can't be read".to_string()));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn only_documented_paths() {
        for ok in ["chats/abc123.json", "deleted/x_y-z.json", "memories.json", "notes.json"] {
            assert!(check_rel(ok).is_ok(), "{ok}");
        }
        for bad in ["../x.json", "chats/../../etc.json", "chats/a/b.json", "other/a.json", "chats/a.txt", "/etc/passwd", "chats/.json", "chats/..%2fx.json", "chats//a.json", ""] {
            assert!(check_rel(bad).is_err(), "{bad}");
        }
    }
}
