---
name: Tauri 2.0 async state initialization
description: How to initialize async state (DB pool) in Tauri 2.0 setup() hook, and mutex rules
---

## Rule: Async init in setup()
Use `tauri::async_runtime::block_on(async { ... })` inside the `.setup(|app| { ... })` hook to run async code (like `SqlitePool::connect()`) synchronously before the app starts.

```rust
.setup(|app| {
    let pool: SqlitePool = tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite:data.db").await?;
        run_migrations(&pool).await?;
        Ok::<SqlitePool, sqlx::Error>(pool)
    })
    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

    app.manage(AppState { db: pool, config: Mutex::new(None), ... });
    Ok(())
})
```

**Why:** setup() is sync but needs async for DB init. block_on is safe here since no tokio runtime is running yet for the user's code.

## Rule: std::sync::Mutex in async commands
`std::sync::Mutex` guards are NOT `Send`. Never hold a `MutexGuard` across an `.await` point in an async Tauri command — the future won't implement `Send` and it won't compile.

**Pattern:** Use a block `{ let g = lock.lock()?; extract values; }` to drop the guard, then do the await outside.

```rust
// WRONG — holds lock across await
let (url, code) = {
    let cfg = state.config.lock().unwrap();
    let r = sqlx::query(...).fetch_one(&state.db).await?; // COMPILE ERROR
    (cfg.url.clone(), cfg.code.clone())
};

// CORRECT — lock dropped before await
let (url, code) = {
    let cfg = state.config.lock().unwrap();
    (cfg.url.clone(), cfg.code.clone())
};  // lock dropped here
let r = sqlx::query(...).fetch_one(&state.db).await?; // fine
```
