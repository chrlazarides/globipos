// Exercise the real native models, authentication and existing tests without
// requiring desktop GTK/WebKit or a Tauri window.
#[path = "../../../src-tauri/src/models.rs"]
pub mod models;
#[path = "../../../src-tauri/src/auth.rs"]
pub mod auth;
#[path = "../../../src-tauri/src/terminal_profile.rs"]
pub mod terminal_profile;
#[cfg(test)]
#[path = "../../../src-tauri/src/tests.rs"]
mod tests;