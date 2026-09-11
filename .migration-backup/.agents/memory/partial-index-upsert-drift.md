---
name: Partial-index upsert drift
description: Prevents idempotent imports from relying on a declared partial unique index that is absent in the live development database.
---

Before using `ON CONFLICT` against a partial unique index, verify the index exists in the actual database and that its predicate matches the conflict target predicate exactly.

**Why:** The loyalty schema and old migrations declared a source-key unique index, but development lacked it. TypeScript and dry-run checks passed while the first transactional apply failed at PostgreSQL conflict inference.

**How to apply:** Preflight duplicate source pairs, repair missing indexes with a later idempotent migration, create the index in development, then exercise the real upsert path and verify duplicate-free reruns.