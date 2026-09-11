---
name: Zod insert schema for child rows created before parent exists
description: When a route builds child-table items client-side before the parent row's id is known (e.g. transfer items before the transfer is inserted), the drizzle-zod insert schema must omit the FK column too.
---

Pattern: `createInsertSchema(childTable).omit({ id: true })` is not enough when the
route parses/validates child items *before* the parent row has been created (so the
FK to the parent, e.g. `transferId`, isn't known yet). The storage layer often already
injects the FK correctly when persisting — but if the Zod schema still requires it,
`schema.parse(item)` throws on every request even though storage logic is correct.

**Why:** This produces a confusing bug where the write path silently succeeds at
the storage layer but 400s at the route/validation layer, making it look like a
storage bug when it's actually a schema `.omit()` gap.

**How to apply:** For any child entity created as part of a "create parent with
nested items" flow, omit both `id` and the parent FK column from the insert schema
used to validate the nested items, and let the storage/service layer inject the FK
after the parent is created.
