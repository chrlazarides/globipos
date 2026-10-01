---
name: Native release verification boundary
description: GitHub CI is the intended native build and update path, separate from publishing the web application.
---

Use the project's GitHub pipeline to verify and distribute native POS changes. A missing local Rust/Tauri toolchain limits local verification; it does not mean the native build has no available verification path.

**Why:** The user clarified that native POS updates are already delivered through GitHub and the Tauri updater. Recommendations must preserve that workflow instead of implying users need a manually installed replacement.

**How to apply:** Check the live GitHub build and signed-release state before describing native changes as available. Web republishing and native releases are separate. New native source must reach GitHub, pass native checks, and be included in a higher-version signed release before existing installations can receive an update. Do not push, tag, or publish a native release merely because the user asked to check the update mechanism.