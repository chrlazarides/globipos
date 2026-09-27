---
name: POS release runner quirks
description: Non-obvious GitHub Actions behaviors that previously blocked the native POS release pipeline.
---

Keep the release workflow's CI-specific package-manager, toolchain-directory, Android SDK package, and direct asset-upload choices intact unless a replacement is verified in GitHub Actions.

**Why:** Root `npm ci` repeatedly ended with npm's `Exit handler never called!` on GitHub runners despite cache removal, retries, npm pinning, and socket tuning; importing the existing lockfile with pinned pnpm completed reliably. Rust targets installed outside the native project applied to the runner's default toolchain instead of the project's pinned toolchain. The Android setup action's removed default `tools` package broke SDK setup. A release action that updates release metadata was denied after the desktop jobs published the release, while direct asset upload was allowed.

**How to apply:** When changing native release CI, verify the full tagged workflow rather than only host-native preflights. Preserve project-directory Rust target installation, explicit supported Android SDK packages, and direct uploads to an existing published release.