---
name: No hard-delete route for items
description: Items API has no DELETE endpoint; use PATCH active:false for soft-delete, or direct SQL for true removal of test/seed data
---

There is no `DELETE /api/items/:id` route in `server/routes.ts`. Items support only soft-delete via `PATCH /api/items/:id` with `{ active: false }`.

**Why:** Attempting `DELETE /api/items/:id` returns HTTP 200 but the body is the Vite/SPA `index.html` fallback (not JSON, not an error) because Express falls through to the catch-all route when no matching route exists. This looks like a "success" at a glance (200 status) but silently does nothing — the item is untouched.

**How to apply:** When cleaning up test/seed items created via the API during verification, either (a) PATCH the item to `active: false`, or (b) if a true hard delete is required (e.g. to avoid polluting sequence numbers or catalog listings), connect directly to the Postgres database (`DATABASE_URL`) and `DELETE FROM item_variants WHERE item_id = ...` then `DELETE FROM items WHERE id = ...`. Always check the actual response body/shape, not just the HTTP status code, when verifying a delete "succeeded" against this API.
