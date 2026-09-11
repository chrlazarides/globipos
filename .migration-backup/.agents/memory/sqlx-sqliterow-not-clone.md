---
name: sqlx SqliteRow is not Clone
description: Why row.clone() fails to compile on sqlx query results and what to do instead
---

`sqlx::sqlite::SqliteRow` (returned from `.fetch_one()` / `.fetch_optional()`) does not implement `Clone`. If you need the same row's data in two places (e.g. return it from a command AND embed it in an outbox/sync payload), calling `.clone()` on the row itself will not compile.

**Why:** SqliteRow holds a reference/handle into the underlying driver's result set rather than owned data, so cloning it isn't meaningful/supported.

**How to apply:** Convert the row to an owned representation first (e.g. a `serde_json::Value` via a `row_to_json` helper, or a plain struct), then clone *that* value as many times as needed. Do the conversion once, store it in a local variable, and reuse it for both the return value and any serialized payload.
