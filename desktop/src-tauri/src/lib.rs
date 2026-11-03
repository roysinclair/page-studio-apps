mod api;
mod desktop;
mod files;
mod mcp;
mod secrets;
mod store;
mod sync;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Opens a chat in its own window (e.g. `chat=abc&solo=1`).
#[tauri::command]
fn new_window(app: tauri::AppHandle, query: String) -> Result<(), String> {
    if !query.chars().all(|c| c.is_ascii_alphanumeric() || "=&_-".contains(c)) {
        return Err("invalid window query".into());
    }
    let label = format!("chat-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(format!("index.html?{query}").into()))
        .title("Page Aura")
        .inner_size(960.0, 900.0)
        .min_inner_size(420.0, 520.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::ShortcutState;
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        desktop::summon(app);
                    }
                })
                .build(),
        );
        if desktop::updater_enabled() {
            builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
        }
    }
    builder
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(store::Store::open(&dir.join("page-aura.db"))?);
            app.manage(files::Roots::load(&dir));
            app.manage(api::Inflight::default());
            app.manage(sync::SyncDir::load(&dir));
            app.manage(mcp::LocalApps::load(&dir));
            app.manage(desktop::PendingUpdate::default());
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                if let Err(e) = app.global_shortcut().register(desktop::SHORTCUT) {
                    eprintln!("Page Aura: global shortcut unavailable ({e})");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api::api_fetch,
            api::api_abort,
            secrets::key_status,
            secrets::key_set,
            secrets::key_clear,
            secrets::secret_set,
            secrets::secret_clear,
            store::db_all,
            store::db_put,
            store::db_del,
            store::data_location,
            files::pick_folder,
            files::fs_list,
            files::fs_read,
            files::claude_memory_dir,
            files::save_bytes,
            files::open_data_dir,
            sync::sync_status,
            sync::sync_pick,
            sync::sync_clear,
            sync::sync_list,
            sync::sync_read,
            sync::sync_write,
            sync::sync_delete,
            mcp::local_list,
            mcp::local_add,
            mcp::local_remove,
            mcp::local_tools,
            mcp::local_call,
            mcp::local_stop,
            mcp::local_import_claude,
            desktop::notify,
            desktop::shortcut_label,
            desktop::update_check,
            desktop::update_install,
            new_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Page Aura");
}
