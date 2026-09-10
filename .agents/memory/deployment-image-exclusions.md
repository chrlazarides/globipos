---
name: Deployment image exclusions
description: Prevent local native build outputs and tool caches from inflating Replit web deployment images.
---

Git ignore rules and the top-level `.replit` `hidden` list do not guarantee that large local native build outputs and workspace caches are excluded from a Replit deployment image. Put generated targets, package caches, agent/tool state, and unrelated preview artifacts in `[deployment].ignorePaths`.

**Why:** A web build completed successfully but publishing repeatedly failed at image assembly because a 5+ GiB native POS target remained in the bundle despite being listed under `hidden`. Replit's deployment-specific exclusion setting is `deployment.ignorePaths`.

**How to apply:** After native or browser tooling creates multi-gigabyte workspace directories, check top-level disk usage before publishing. Add generated, non-runtime paths to `[deployment].ignorePaths` through the validated `.replit` replacement flow; do not delete source or runtime assets.