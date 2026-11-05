//! Read-only access to project folders the user has chosen. Every read is checked to stay
//! inside a chosen folder (no `..`, no symlink escapes), and secret files are refused.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".nuxt", "venv", ".venv", "env",
    "__pycache__", ".cache", ".parcel-cache", "target", ".idea", ".vscode", "coverage", ".turbo", ".gradle",
    "Pods", "vendor", ".pytest_cache", ".mypy_cache", "DerivedData", ".ssh", ".gnupg", ".aws", ".kube",
];
const MAX_ENTRIES: usize = 4000;

pub struct Roots {
    set: Mutex<BTreeSet<PathBuf>>,
    file: PathBuf,
}

impl Roots {
    pub fn load(dir: &Path) -> Self {
        let file = dir.join("folders.json");
        let set = std::fs::read_to_string(&file)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<PathBuf>>(&s).ok())
            .unwrap_or_default()
            .into_iter()
            .collect();
        Self { set: Mutex::new(set), file }
    }
    fn add(&self, p: PathBuf) {
        if let Ok(mut s) = self.set.lock() {
            s.insert(p);
            let list: Vec<_> = s.iter().cloned().collect();
            let _ = std::fs::write(&self.file, serde_json::to_string(&list).unwrap_or_default());
        }
    }
    fn allowed(&self, root: &Path) -> Option<PathBuf> {
        let canon = root.canonicalize().ok()?;
        self.set.lock().ok()?.contains(&canon).then_some(canon)
    }
}

pub fn is_sensitive(rel: &str) -> bool {
    let name = rel.rsplit('/').next().unwrap_or(rel).to_ascii_lowercase();
    if rel.split('/').any(|seg| [".ssh", ".gnupg", ".aws", ".kube"].contains(&seg)) {
        return true;
    }
    if name.starts_with(".env") && !matches!(name.as_str(), ".env.example" | ".env.sample" | ".env.template") {
        return true;
    }
    let ext = name.rsplit('.').next().unwrap_or("");
    if ["pem", "key", "p12", "pfx", "jks", "keystore", "kdbx", "asc", "gpg", "tfstate", "tfvars"].contains(&ext)
        || name.ends_with(".tfstate.backup")
    {
        return true;
    }
    let base = name.trim_end_matches(".pub");
    ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"].contains(&base)
        || [".npmrc", ".pypirc", ".netrc", ".git-credentials", ".htpasswd"].contains(&name.as_str())
        || name.starts_with("credentials")
        || name.contains("secret")
        || (name.starts_with("service") && name.contains("account") && name.ends_with(".json"))
}

fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if rel.is_empty() || p.is_absolute() || p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("invalid path".into());
    }
    let full = root.join(p).canonicalize().map_err(|_| format!("{rel} not found"))?;
    if !full.starts_with(root) {
        return Err("path is outside the chosen folder".into());
    }
    Ok(full)
}

#[derive(Serialize)]
pub struct Picked {
    path: String,
    name: String,
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle, roots: State<'_, Roots>) -> Result<Option<Picked>, String> {
    let Some(fp) = app.dialog().file().blocking_pick_folder() else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?.canonicalize().map_err(|e| e.to_string())?;
    roots.add(path.clone());
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.display().to_string());
    Ok(Some(Picked { path: path.display().to_string(), name }))
}

#[derive(Serialize)]
pub struct Entry {
    path: String,
    dir: bool,
    size: u64,
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<Entry>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut items: Vec<_> = rd.flatten().collect();
    items.sort_by_key(|e| e.file_name());
    for e in items {
        if out.len() >= MAX_ENTRIES {
            return;
        }
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        let full = e.path();
        let rel = full.strip_prefix(root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        if ft.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) || depth >= 10 {
                continue;
            }
            out.push(Entry { path: format!("{rel}/"), dir: true, size: 0 });
            walk(root, &full, depth + 1, out);
        } else if ft.is_file() {
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(Entry { path: rel, dir: false, size });
        }
    }
}

#[tauri::command]
pub async fn fs_list(roots: State<'_, Roots>, root: String) -> Result<Vec<Entry>, String> {
    let root = roots.allowed(Path::new(&root)).ok_or("That folder hasn't been chosen in Page Aura.")?;
    let mut out = Vec::new();
    walk(&root, &root, 0, &mut out);
    Ok(out)
}

#[derive(Serialize)]
pub struct FileText {
    text: String,
    size: u64,
}

#[tauri::command]
pub async fn fs_read(roots: State<'_, Roots>, root: String, rel: String, max: Option<u64>) -> Result<FileText, String> {
    let root = roots.allowed(Path::new(&root)).ok_or("That folder hasn't been chosen in Page Aura.")?;
    if is_sensitive(&rel) {
        return Err(format!("{rel} looks like a secrets file, so Page Aura never shares it."));
    }
    let full = safe_join(&root, &rel)?;
    let size = tokio::fs::metadata(&full).await.map_err(|e| e.to_string())?.len();
    let max = max.unwrap_or(5 * 1024 * 1024).min(20 * 1024 * 1024);
    if size > max {
        return Err(format!("{rel} is too large ({size} bytes)."));
    }
    let bytes = tokio::fs::read(&full).await.map_err(|e| e.to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| format!("{rel} is not a text file."))?;
    Ok(FileText { text, size })
}

/// Claude Code keeps per-project memory in ~/.claude/projects/<project path with every
/// non-alphanumeric character replaced by '-'>/memory. Find it for a chosen project.
#[tauri::command]
pub async fn claude_memory_dir(roots: State<'_, Roots>, project: String) -> Result<Option<String>, String> {
    let project = roots.allowed(Path::new(&project)).ok_or("That folder hasn't been chosen in Page Aura.")?;
    let Some(home) = dirs::home_dir() else { return Ok(None) };
    let encoded: String = project.display().to_string().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let dir = home.join(".claude").join("projects").join(encoded).join("memory");
    match dir.canonicalize() {
        Ok(d) if d.is_dir() => {
            roots.add(d.clone());
            Ok(Some(d.display().to_string()))
        }
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn save_bytes(app: AppHandle, name: String, b64: String) -> Result<Option<String>, String> {
    let bytes = B64.decode(b64).map_err(|e| e.to_string())?;
    let safe: String = name.chars().map(|c| if c.is_alphanumeric() || " ._-()".contains(c) { c } else { '_' }).take(120).collect();
    let Some(fp) = app.dialog().file().set_file_name(if safe.is_empty() { "file" } else { &safe }).blocking_save_file() else {
        return Ok(None);
    };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    tokio::fs::write(&path, bytes).await.map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
pub fn open_data_dir(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    app.opener().open_path(dir.display().to_string(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sensitive_names() {
        for s in [".env", "app/.env.local", "id_ed25519", "certs/server.pem", "config/secrets.yaml", ".ssh/config", "credentials.json"] {
            assert!(is_sensitive(s), "{s}");
        }
        for s in [".env.example", "CLAUDE.md", "config/modem.yaml", "src/main.rs"] {
            assert!(!is_sensitive(s), "{s}");
        }
    }
    #[test]
    fn join_rejects_escapes() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        assert!(safe_join(&root, "../etc/passwd").is_err());
        assert!(safe_join(&root, "/etc/passwd").is_err());
    }
}
