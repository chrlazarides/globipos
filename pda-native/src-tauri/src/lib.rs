// The hosted PDA keeps its existing authentication, API and offline boundaries.
// Deliberately no invoke handlers, filesystem, shell, HTTP or updater plugins:
// a remotely served document must not receive native POS privileges.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("GlobiPOS PDA could not start");
}
