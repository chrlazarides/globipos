---
name: Tauri 2.0 SQLite pattern
description: How to use SQLite correctly in a Tauri 2.0 app — sqlx in Rust, not tauri-plugin-sql
---

## Rule
Use `sqlx` with `features = ["sqlite", "runtime-tokio"]` for all Rust-side SQLite in Tauri 2.0 apps.
Do NOT use `tauri-plugin-sql` from Rust — its `DbPool::connect()` API doesn't exist in v2; the plugin is frontend-JS-only.

**Why:** tauri-plugin-sql v2 exposes SQLite to the frontend JS only (via `@tauri-apps/plugin-sql`). There is no `DbPool::connect()` in the Rust crate for v2. Trying to use it from Rust will fail to compile. sqlx gives full direct access.

**How to apply:**
1. In Cargo.toml: `sqlx = { version = "0.8", features = ["sqlite", "runtime-tokio", "macros"] }`
2. Remove `tauri-plugin-sql` from Cargo.toml and `capabilities/*.json`
3. Store `SqlitePool` in a `pub struct AppState { db: SqlitePool, ... }` managed via `app.manage()`
4. Each Tauri command receives `State<'_, AppState>` and does `sqlx::query(...).fetch_all(&state.db).await`
5. Rows → JSON: use a `row_to_json(row: SqliteRow)` helper that tries i64/f64/bool/String per column type
6. Add `use sqlx::{Row, SqlitePool};` to every file that calls `.try_get()` on rows
