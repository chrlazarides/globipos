---
name: Deployment image exclusions
description: Prevent local native build outputs and tool caches from inflating Replit web deployment images.
---

Git ignore rules and the top-level `.replit` `hidden` list do not guarantee that large local native build outputs and workspace caches are excluded from a Replit deployment image. Use a root `.replitignore` file for deployment-bundle exclusions.

**Why:** Web builds completed successfully but Autoscale publishing repeatedly failed at image assembly because a 5+ GiB native POS target remained in the bundle despite being listed under both `hidden` and `deployment.ignorePaths`. Current Replit documentation identifies `.replitignore` as the primary bundle exclusion mechanism.

**How to apply:** Keep every local Tauri `CARGO_TARGET_DIR` outside the repository and reject caller overrides that resolve inside it. Before every web publish, fail if an in-workspace native target exists and check workspace size; do not make web publishing depend on GitHub availability. Never exclude the root `dist/` directory: the deployment build creates `dist/index.cjs` there, and `.replitignore` is also applied when assembling the final runtime image. Verify uploaded nonempty installers and signed updater metadata inside the native release workflow. Backend data snapshots retain their own `app_version` control while Tauri release manifests stay aligned through the POS version helper. If repeated publishes still exceed the limit, remove reproducible build caches after confirming the user accepts the rebuild cost; never delete source or runtime assets.