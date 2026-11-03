//! Desktop conveniences: notifications, the global "summon" shortcut, and updates.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;

/// Brings the main window to the front (used by the global shortcut).
pub fn summon(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub const SHORTCUT: &str = "CommandOrControl+Shift+Space";

#[tauri::command]
pub fn shortcut_label() -> &'static str {
    if cfg!(target_os = "macos") { "⌘⇧Space" } else { "Ctrl+Shift+Space" }
}

/// Shows a system notification (e.g. a long reply finished while Page Aura was in the background).
#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    let title: String = title.chars().take(80).collect();
    let body: String = body.chars().take(240).collect();
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

/* ---- updates ----
   Updates are signed with a key you create for free (`npx tauri signer generate`); the public
   half is compiled in from PAGE_AURA_UPDATER_PUBKEY. Builds without it simply have no updater. */

pub const UPDATER_PUBKEY: Option<&str> = option_env!("PAGE_AURA_UPDATER_PUBKEY");
pub fn updater_enabled() -> bool {
    UPDATER_PUBKEY.map(|k| !k.trim().is_empty()).unwrap_or(false)
}
const UPDATE_URL: &str = "https://github.com/roysinclair/page-studio-apps/releases/latest/download/latest.json";

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    enabled: bool,
    current: String,
    available: Option<String>,
    notes: Option<String>,
}

#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<UpdateInfo, String> {
    use tauri_plugin_updater::UpdaterExt;
    let current = app.package_info().version.to_string();
    if !updater_enabled() {
        return Ok(UpdateInfo { enabled: false, current, available: None, notes: None });
    }
    let url = UPDATE_URL.parse().map_err(|e: url::ParseError| e.to_string())?;
    let updater = app
        .updater_builder()
        .pubkey(UPDATER_PUBKEY.unwrap_or_default())
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|e| e.to_string())?;
    let info = UpdateInfo {
        enabled: true,
        current,
        available: found.as_ref().map(|u| u.version.clone()),
        notes: found.as_ref().and_then(|u| u.body.clone()),
    };
    *pending.0.lock().map_err(|e| e.to_string())? = found;
    Ok(info)
}

#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = pending.0.lock().map_err(|e| e.to_string())?.take().ok_or("No update to install — check first.")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}
