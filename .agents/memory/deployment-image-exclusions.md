---
name: Deployment image exclusions
description: Prevent local native build outputs and tool caches from inflating Replit web deployment images.
---

Git ignore rules do not guarantee that large local native build outputs and workspace caches are excluded from a Replit deployment image. Keep generated targets, package caches, agent/tool state, and unrelated preview artifacts in the `.replit` `hidden` list.

**Why:** A web build completed successfully but publishing failed at image assembly because local native POS outputs and caches pushed the image above the 8 GiB limit.

**How to apply:** After native or browser tooling creates multi-gigabyte workspace directories, check top-level disk usage before publishing. Exclude generated, non-runtime paths through the validated `.replit` replacement flow; do not delete source or runtime assets.