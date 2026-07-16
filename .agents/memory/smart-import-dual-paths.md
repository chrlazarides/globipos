---
name: Smart import dual paths
description: Excel smart import has two server paths that must stay behavior-identical
---
The smart import page sends data via two paths: multipart file upload (per-entity /api/X/import) and a JSON path (/api/items/import/json) used for pre-parsed wine price lists.

**Why:** Adding a feature (e.g. upsert mode, "NULL" string normalization) to only the multipart routes silently leaves the pre-parsed path behaving differently — duplicate-SKU errors instead of updates.

**How to apply:** Any change to import semantics (matching keys, value cleaning, response shape) must be mirrored in both the multipart routes and the /json route, and the client must send the same flags on both fetches.
