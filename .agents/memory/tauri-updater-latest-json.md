---
name: Tauri v2 updater latest.json generation failures
description: Why tauri-action silently skips generating the updater manifest (latest.json) even when the build/signing looks fine
---

If GitHub Actions release builds succeed and per-platform `.sig` files exist but `tauri-action` logs "Signature not found for the updater JSON. Skipping upload..." on every platform (not just one), check two things in order:

1. **`bundle.createUpdaterArtifacts: true` must be explicitly set in `tauri.conf.json`.** Without it, Tauri v2's CLI does not produce the `.sig`/`.zip` (nsis.zip, msi.zip, app.tar.gz, AppImage.tar.gz) artifacts the updater needs at all — `tauri-action`'s "Looking for artifacts" log will list the expected paths, but "Found artifacts" will silently omit them because they never existed on disk. This affects all platforms uniformly since it's a shared bundle config flag, not a platform-specific naming issue.

2. **If that's set and it still fails**, check the raw build output for `failed to decode secret key: incorrect updater private key password: Missing comment in secret key` — this means the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub secrets are mismatched or malformed. Fix by regenerating a fresh keypair via `tauri signer generate`, updating `plugins.updater.pubkey` in `tauri.conf.json`, and re-uploading both secrets (encrypted via `crypto_box_seal` — use `libsodium-wrappers`, NOT plain `tweetnacl.box`, since sealed-box requires a deterministic BLAKE2b-derived nonce that tweetnacl doesn't implement).

**Why:** Both failures produce the identical generic "Signature not found for the updater JSON" log line regardless of root cause, so don't assume it's a Linux/naming-slug issue just because Linux logs are checked first — verify Windows/macOS logs show the same failure before chasing platform-specific theories (e.g. deb/rpm productName slugification) which are usually red herrings.

**How to apply:** Any time you're setting up or debugging a Tauri v2 GitHub Actions auto-updater release pipeline.
