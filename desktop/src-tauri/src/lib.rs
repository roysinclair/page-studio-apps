mod api;
mod files;
mod secrets;
mod store;

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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(store::Store::open(&dir.join("page-aura.db"))?);
            app.manage(files::Roots::load(&dir));
            app.manage(api::Inflight::default());
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
            new_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Page Aura");
}
