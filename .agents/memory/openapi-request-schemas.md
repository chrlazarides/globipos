---
name: Named OpenAPI request schemas
description: Avoid request-schema export collisions in this workspace's generated API libraries.
---

Use named component schemas for new OpenAPI request bodies rather than inline object schemas.

**Why:** The workspace's generation pipeline can emit overlapping inline request-body names into the generated barrels, causing duplicate exports despite valid OpenAPI.

**How to apply:** Define reusable named request components and reference them from the operations; regenerate and typecheck the API libraries when adding operations.