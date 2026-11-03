//! Secrets live in the operating system's keychain (macOS Keychain, Windows Credential
//! Manager, Linux Secret Service). The web UI can store or clear them, but there is
//! deliberately no command that returns a secret to the UI.

use keyring::Entry;
use std::collections::HashMap;
use std::sync::Mutex;

const SERVICE: &str = "io.github.roysinclair.pageaura";
const API_KEY: &str = "anthropic-api-key";

/// Fallback for systems without a keychain service: kept in memory for this run only.
static SESSION: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn session_get(name: &str) -> Option<String> {
    SESSION.lock().ok()?.as_ref()?.get(name).cloned()
}
fn session_set(name: &str, value: Option<String>) {
    if let Ok(mut g) = SESSION.lock() {
        let map = g.get_or_insert_with(HashMap::new);
        match value {
            Some(v) => { map.insert(name.to_string(), v); }
            None => { map.remove(name); }
        }
    }
}

fn entry(name: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

pub fn get(name: &str) -> Option<String> {
    if let Some(v) = session_get(name) {
        return Some(v);
    }
    entry(name).ok()?.get_password().ok().filter(|v| !v.is_empty())
}

/// Returns "keychain" or "session" (no keychain available: kept until the app quits).
fn set(name: &str, value: &str) -> Result<String, String> {
    match entry(name).and_then(|e| e.set_password(value).map_err(|e| e.to_string())) {
        Ok(()) => {
            session_set(name, None);
            Ok("keychain".into())
        }
        Err(_) => {
            session_set(name, Some(value.to_string()));
            Ok("session".into())
        }
    }
}

fn clear(name: &str) -> Result<(), String> {
    session_set(name, None);
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn api_key() -> Option<String> {
    get(API_KEY)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn app_secret_name(id: &str) -> Option<String> {
    valid_id(id).then(|| format!("app-{id}"))
}

#[tauri::command]
pub fn key_status() -> bool {
    api_key().is_some()
}

#[tauri::command]
pub fn key_set(key: String) -> Result<String, String> {
    let k = key.trim();
    if k.is_empty() || k.len() > 512 || k.chars().any(|c| c.is_whitespace()) {
        return Err("That doesn't look like an API key.".into());
    }
    set(API_KEY, k)
}

#[tauri::command]
pub fn key_clear() -> Result<(), String> {
    clear(API_KEY)
}

#[tauri::command]
pub fn secret_set(id: String, value: String) -> Result<String, String> {
    let name = app_secret_name(&id).ok_or("invalid id")?;
    if value.is_empty() || value.len() > 8192 {
        return Err("invalid token".into());
    }
    set(&name, value.trim())
}

#[tauri::command]
pub fn secret_clear(id: String) -> Result<(), String> {
    clear(&app_secret_name(&id).ok_or("invalid id")?)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Needs a running keychain service; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn keychain_round_trip() {
        assert_eq!(key_set("sk-ant-roundtrip-test".into()).unwrap(), "keychain");
        assert!(key_status());
        assert_eq!(api_key().as_deref(), Some("sk-ant-roundtrip-test"));
        secret_set("app123".into(), "tok-abc".into()).unwrap();
        assert_eq!(get("app-app123").as_deref(), Some("tok-abc"));
        key_clear().unwrap();
        secret_clear("app123".into()).unwrap();
        assert!(!key_status());
    }
    #[test]
    fn rejects_bad_input() {
        assert!(key_set("   ".into()).is_err());
        assert!(secret_set("../evil".into(), "x".into()).is_err());
    }
}
