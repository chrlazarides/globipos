---
name: Duplicate workflow port owners
description: A failed managed-workflow restart may coexist with an older healthy server that still owns the port.
---

When an artifact workflow fails with `EADDRINUSE`, check the actual port owner and HTTP response before changing service configuration. A previous managed server can continue serving the preview even while a replacement workflow reports failure.

**Why:** An environment-wide restart attempted new copies of several artifact services without releasing the older listeners. The new workflows failed, but the earlier processes still answered requests.

**How to apply:** Diagnose with process ownership and a local HTTP check; if a replacement is needed, gracefully stop only the stale process for the affected artifact, then restart its existing managed workflow. Do not create a duplicate workflow or change ports merely because the replacement failed.