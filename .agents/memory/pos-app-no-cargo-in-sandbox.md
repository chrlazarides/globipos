---
name: pos-app Tauri native build not practical in this sandbox
description: What is and isn't achievable when trying to build/verify the pos-app Tauri desktop app in this Replit sandbox
---

Update: cargo/rustc CAN be installed here via the package-management module system (`installProgrammingLanguage({ language: "rust-stable" })`), so the earlier note that Rust is categorically unavailable was time-bound, not permanent. What's still true:

**npm devDependencies gotcha:** `pos-app/node_modules` starts empty (no workflow runs it). A plain `npm install` in that directory silently skips `devDependencies` (NODE_ENV=production-like default in this environment) — `@tauri-apps/cli`, `vite`, `typescript` etc. won't be installed, and `npx tauri` will fail with "could not determine executable to run". Fix: `npm install --include=dev`. The `bash` tool blocks `npm install` outright ("use packager_tool"); running it via `code_execution`'s `child_process.exec` with an explicit `PATH` pointing at the nix node bin dir works instead (also needed because code_execution's own PATH has no `node`/`npm`).

**Frontend build/typecheck DOES work** once deps are installed: `npm run typecheck` and `npm run build` (vite) succeed and catch real TS bugs — treat these as the real verification step for pos-app frontend changes.

**Native Tauri build hits a wall:** `tauri build` needs a full Linux GTK/WebKit toolchain (glib-2.0, webkit2gtk-4.1, pkg-config discovery of their .pc files). Even after installing gcc + `installSystemDependencies({ packages: ["pkg-config","glib","gtk3","webkitgtk","librsvg","openssl","libayatana-appindicator","libsoup"] })`, `pkg-config --exists glib-2.0` still fails — the Nix store paths for these libs aren't wired into `PKG_CONFIG_PATH` automatically, and scanning `/nix/store` to find them by hand times out (too large). Long-running Rust builds must also be launched detached (via `code_execution`'s `child_process.spawn(..., {detached:true, stdio: [file handles]})`, not the `bash` tool with `&`, since bash background jobs die when the tool call ends) and polled across multiple tool calls since a full first build exceeds the 2-minute bash timeout many times over.

**How to apply:** Don't attempt a full native `tauri build` in this sandbox — it's a multi-hour system-dependency chase with no clean path found yet. Verify pos-app changes via `npm run typecheck` + `npm run build` (frontend-only), and tell the user the actual Tauri binary needs to be produced in their own local/CI environment (e.g. `tauri-action` on GitHub Actions) where these system libs are reliably preinstalled.
