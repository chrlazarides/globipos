---
name: Concurrent migration numbering
description: How to recover safely when parallel work introduces migrations with the same numeric prefix.
---

Migration filenames must have unique numeric prefixes. If parallel branches collide, keep one prefix and add a later, uniquely numbered reconciliation migration that idempotently creates everything either colliding migration was meant to add.

**Why:** Some migration journals deduplicate by numeric version. Merely renaming both old files can still strand environments that already journaled one version while missing the other schema change.

**How to apply:** Make the reconciliation safe for clean installs and for every partial prior state with `IF NOT EXISTS` or equivalent guards, then validate each scenario in isolated schemas.