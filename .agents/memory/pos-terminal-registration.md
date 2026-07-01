---
name: POS Terminal Registration Flow
description: How the Tauri POS app registers with the GlobiPOS server, what fields are expected, and what bugs were fixed.
---

## The registration endpoint is PUBLIC (no session cookie)

`/api/pos/terminals/register` is listed in `server/auth.ts` `PUBLIC_PATHS` — it must stay there.
The terminal sends this call on first boot before it has any auth token.

**Why:** The Tauri app on Windows has no cookie or JWT until after successful registration. Without the PUBLIC_PATHS entry, it gets 401 and the setup screen can never complete.

**How to apply:** If you ever regenerate auth middleware or add new public POS bootstrap endpoints, always check PUBLIC_PATHS in `server/auth.ts`.

## Rust → Server field name mismatch (fixed)

Rust `sync.rs` was sending `{ "code": terminal_code }` but server expected `{ "terminalCode" }`.
**Fixed:** Rust now sends `terminalCode`. Server also accepts the old `code` field as a fallback.

## RegisterResponse serde deserialization (fixed)

`RegisterResponse` struct in `models.rs` needed `#[serde(rename_all = "camelCase")]` because the server sends camelCase JSON keys (`layoutButtons`, `inboxItems`, `syncConfig`) but serde defaults to snake_case.

**How to apply:** Any new Rust struct that deserializes JSON from this server must either use `rename_all = "camelCase"` or explicit `#[serde(rename = "...")]` per field.

## Cashiers are server-managed, synced on registration

Server has a `pos_cashiers` table. Registration response now includes `cashiers: [{id, name, pin, role}]`.
Tauri syncs them into local SQLite via `upsert_cashier()` in `auth.rs`.

PIN is stored as **plaintext on server**, **hashed locally** by the Rust `hash_pin()` (DefaultHasher).
Bulk cashier sync endpoint: `GET /api/pos/sync/cashiers` (requireTerminal).
Admin CRUD: `GET/POST/PUT/DELETE /api/pos/cashiers` (requireAdmin).

## Layout buttons bulk endpoint

`PUT /api/pos/layouts/:id/buttons` was missing. Added it — calls `storage.setPosLayoutButtons()` (delete+re-insert).
The seed script uses this endpoint.

## Supermarket test data

Run `node supermarket-test-seed.mjs` to create:
- Location: Fresh Market Supermarket (code: MKTMAIN)
- Terminal: Checkout 1 (code: T001)
- 10 categories, 45 products with barcodes, 28 layout buttons
- Cashiers: Maria/1234 (manager), Yiannis/2222 (supervisor), Andreas/3333, Eleni/4444
