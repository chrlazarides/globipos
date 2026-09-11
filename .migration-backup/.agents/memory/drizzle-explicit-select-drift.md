---
name: Drizzle explicit select() column drift
description: New columns added to a Drizzle schema/table silently vanish from API responses if a storage function uses an explicit db.select({...}) column map instead of db.select().
---

When a storage function builds its query with `db.select({ id: table.id, name: table.name, ... })` (an explicit field map, often combined with a join to bring in a related field like `locationName`), adding a new column to the underlying table schema does NOT automatically appear in the query result — it must be added to the field map by hand.

**Why:** This is easy to miss because the route layer, the frontend type, and even the schema can all already reference the new field correctly, giving false confidence that "it's already wired up." The only place the wiring silently breaks is the explicit column list in the storage layer. Found via: `GET /api/pos/terminals` had `peripheralStatus`/`peripheralConfig` in the schema and in the route's declared response shape, but `storage.getPosTerminals()` used an explicit `db.select({...})` that never listed those two jsonb columns, so every terminal came back with them undefined.

**How to apply:** When adding a column to a Drizzle table that needs to surface through an existing endpoint, grep the storage layer for `db.select({` (not `db.select()`) queries against that table and confirm the new column is included. `tsc --noEmit` will only catch this if the function's declared return type still lists the field as required (non-optional) — a `Promise<SomeType[]>` return annotation with an optional/partial field, or a return type inferred from the query itself, will not error even when the column is silently dropped.
