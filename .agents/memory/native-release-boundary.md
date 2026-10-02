---
name: Native release verification boundary
description: GitHub CI is the intended native build and update path, separate from publishing the web application.
---

Use the project's GitHub pipeline to verify and distribute native POS changes. A missing local Rust/Tauri toolchain limits local verification; it does not mean the native build has no available verification path.

**Why:** The user clarified that native POS updates are already delivered through GitHub and the Tauri updater. Recommendations must preserve that workflow instead of implying users need a manually installed replacement.

**How to apply:** Check the live GitHub build and signed-release state before describing native changes as available. Web republishing and native releases are separate. New native source must reach GitHub, pass native checks, and be included in a higher-version signed release before existing installations can receive an update. Do not push, tag, or publish a native release merely because the user asked to check the update mechanism.

When reconciling GitHub before a native release, preserve current native release fixes without restoring obsolete pre-migration root-app steps.

**Why:** GitHub and the Replit workspace can have diverged histories; older GitHub workflow fixes may assume legacy root npm/PWA files that no longer exist in the migrated workspace.

**How to apply:** Merge without force-pushing, resolve workflow conflicts against the current workspace layout, and keep native checks intact. A local exclusion of the native source directory can coexist with already-tracked source; stage only tracked version files, not the entire directory or private build output.

Keep a public native release tag immutable when fixing a failed release check; publish the correction under a higher version through the normal signed pipeline.

**Why:** Desktop installers and updater metadata may already be public even when Android fails. Replacing a published tag can make installed binaries and release source disagree.

**How to apply:** Do not move an existing public release tag or silently replace its desktop binaries to repair an Android inspection failure.