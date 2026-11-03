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
