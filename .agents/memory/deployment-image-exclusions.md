---
name: Deployment image exclusions
description: Prevent local native build outputs and tool caches from inflating Replit web deployment images.
---

Git ignore rules and the top-level `.replit` `hidden` list do not guarantee that large local native build outputs and workspace caches are excluded from a Replit deployment image. Use a root `.replitignore` file for deployment-bundle exclusions.

**Why:** Web builds completed successfully but Autoscale publishing repeatedly failed at image assembly because a 5+ GiB native POS target remained in the bundle despite being listed under both `hidden` and `deployment.ignorePaths`. Current Replit documentation identifies `.replitignore` as the primary bundle exclusion mechanism.

**How to apply:** After native or browser tooling creates multi-gigabyte directories, check top-level disk usage before publishing and add generated, non-runtime paths to `.replitignore`. If repeated publishes still exceed the limit, remove reproducible build caches after confirming the user accepts the rebuild cost; never delete source or runtime assets.