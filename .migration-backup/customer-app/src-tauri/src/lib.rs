use tauri::Manager;

/// Emit a kiosk event to restart the idle timer
#[tauri::command]
fn ping_idle(_window: tauri::Window) -> &'static str {
    "pong"
}

/// Quit the kiosk application (supervisor can restart)
#[tauri::command]
fn kiosk_quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Reload the webview (useful for manual refresh in kiosk)
#[tauri::command]
async fn kiosk_reload(window: tauri::Window) -> Result<(), String> {
    window.eval("window.location.reload()").map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            // Hide cursor in kiosk mode on touch-only devices
            #[cfg(target_os = "linux")]
            window.set_cursor_visible(false).ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping_idle, kiosk_quit, kiosk_reload])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
