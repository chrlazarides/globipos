---
name: Settings default initialization paths
description: Settings defaults are applied independently during server startup and through the admin Load Defaults endpoint.
---

Changes to default settings must cover both startup initialization and the admin-facing Load Defaults endpoint.

**Why:** Server startup creates missing settings before the admin opens Settings, so changing only the UI endpoint leaves fresh deployments with the startup values and normally hides the Load Defaults flow.

**How to apply:** Whenever default setting values or required keys change, compare both initialization lists and any startup cleanup migrations, then verify the behavior of an empty database after startup.