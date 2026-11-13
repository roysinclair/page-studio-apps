//! Chats, memories and remembered folders, saved in a SQLite file in the app's data folder.

use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

const STORES: [&str; 3] = ["chats", "memories", "folders"];

pub struct Store {
    conn: Mutex<Connection>,
    pub path: PathBuf,
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS records(
               store TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL,
               PRIMARY KEY(store, key));",
        )?;
        Ok(Self { conn: Mutex::new(conn), path: path.to_path_buf() })
    }
}

fn check(store: &str) -> Result<(), String> {
    STORES.contains(&store).then_some(()).ok_or_else(|| format!("unknown store {store}"))
}
fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[tauri::command]
pub fn db_all(db: State<'_, Store>, store: String) -> Result<Vec<String>, String> {
    check(&store)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT value FROM records WHERE store=?1").map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![store], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_put(db: State<'_, Store>, store: String, key: String, value: String) -> Result<(), String> {
    check(&store)?;
    serde_json::from_str::<serde_json::Value>(&value).map_err(|_| "value must be JSON".to_string())?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO records(store,key,value,updated) VALUES(?1,?2,?3,?4)
         ON CONFLICT(store,key) DO UPDATE SET value=excluded.value, updated=excluded.updated",
        params![store, key, value, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_del(db: State<'_, Store>, store: String, key: String) -> Result<(), String> {
    check(&store)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM records WHERE store=?1 AND key=?2", params![store, key]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn data_location(db: State<'_, Store>) -> String {
    db.path.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Manager;

    /// A throwaway database file, plus a mock app that manages a `Store` opened on it.
    fn fixture(tag: &str) -> (PathBuf, tauri::App<tauri::test::MockRuntime>) {
        let dir = std::env::temp_dir().join(format!("page-aura-store-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let app = tauri::test::mock_app();
        app.manage(Store::open(&dir.join("page-aura.db")).unwrap());
        (dir, app)
    }

    fn chat(i: usize) -> String {
        format!(r#"{{"id":"chat{i:04}","title":"Chat {i}","messages":[{{"role":"user","content":"hello {i}"}}],"updatedAt":{i}}}"#)
    }

    /// Chats have no cap: 999 (and more) are all kept, read back, and survive reopening the file.
    #[test]
    fn keeps_every_chat_with_no_cap() {
        let (dir, app) = fixture("many");
        let n = 1_200;
        for i in 0..n {
            db_put(app.state::<Store>(), "chats".into(), format!("chat{i:04}"), chat(i)).unwrap();
        }
        let all = db_all(app.state::<Store>(), "chats".into()).unwrap();
        assert_eq!(all.len(), n);
        for i in [0, 4, 5, 998, 999, n - 1] {
            assert!(all.contains(&chat(i)), "chat {i} is kept");
        }

        // Updating a chat replaces it in place; it doesn't add a row or push another one out.
        let edited = chat(3).replace("hello 3", "hello again");
        db_put(app.state::<Store>(), "chats".into(), "chat0003".into(), edited.clone()).unwrap();
        let all = db_all(app.state::<Store>(), "chats".into()).unwrap();
        assert_eq!(all.len(), n);
        assert!(all.contains(&edited));

        // Deleting one removes exactly that one.
        db_del(app.state::<Store>(), "chats".into(), "chat0500".into()).unwrap();
        let all = db_all(app.state::<Store>(), "chats".into()).unwrap();
        assert_eq!(all.len(), n - 1);
        assert!(!all.contains(&chat(500)));

        // Everything is still there after the app closes and opens the file again.
        drop(app);
        let app = tauri::test::mock_app();
        app.manage(Store::open(&dir.join("page-aura.db")).unwrap());
        assert_eq!(db_all(app.state::<Store>(), "chats".into()).unwrap().len(), n - 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unknown_stores_and_non_json() {
        let (dir, app) = fixture("checks");
        assert_eq!(db_put(app.state::<Store>(), "other".into(), "k".into(), "{}".into()), Err("unknown store other".to_string()));
        assert_eq!(db_put(app.state::<Store>(), "chats".into(), "k".into(), "not json".into()), Err("value must be JSON".to_string()));
        assert!(db_all(app.state::<Store>(), "chats".into()).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
