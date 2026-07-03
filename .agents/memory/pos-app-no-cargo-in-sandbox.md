---
name: pos-app cargo check unavailable in this sandbox
description: Rust/Tauri backend changes for pos-app cannot be verified with cargo check here
---

The Replit sandbox this project runs in does not have `cargo`/`rustc` on `PATH` (confirmed: `cargo check` → "command not found", and `which rustc` / `find / -iname cargo` also come up empty). The `pos-app` (Tauri) frontend is also not bound to any configured preview workflow, so there is no running dev server to smoke-test the Rust backend against either.

**Why:** pos-app is a Tauri desktop app; its Rust toolchain isn't installed in this particular environment, and none of the configured workflows (Customer App, Start application, mockup-sandbox) start it.

**How to apply:** When editing `pos-app/src-tauri/src/*.rs`, verify correctness through careful manual review instead of `cargo check`:
- Check ownership/borrow patterns explicitly (e.g. does the type actually implement `Clone`? — see `sqlx-sqliterow-not-clone.md`).
- Cross-check `sqlx::query(...).bind(...)` argument counts/order against the SQL placeholders.
- Cross-check new Tauri commands are registered in `generate_handler!` and that frontend TS wrapper signatures in `db.ts` match the Rust command's parameter names/types (Tauri uses camelCase JS ↔ snake_case Rust automatically, but argument order/optionality must still align).
- For the TypeScript side, `pos-app`'s `tsc --noEmit` will always show a fixed set of `Cannot find module '@tauri-apps/...'` errors in this sandbox (missing native module resolution) — these are pre-existing/environmental, not regressions. Diff the error list before/after your change to confirm you haven't introduced new errors.
