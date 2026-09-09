---
name: Item image storage fallback
description: Durable storage rule for generated item-photo renditions across isolated customer deployments.
---

Item photo APIs must keep stable, versioned application URLs and support a deployment-local PostgreSQL fallback when Replit App Storage has no attached default bucket.

**Why:** Constructing the App Storage client succeeds without configuration, but the first upload fails with “bucket name is needed.” Customer deployments must not silently lose or reject item photos because storage was not attached.

**How to apply:** Prefer App Storage when available, but keep the same public image URL contract regardless of backend. Store only optimized renditions in the fallback, switch item pointers after every rendition succeeds, and remove superseded objects after the pointer switch.