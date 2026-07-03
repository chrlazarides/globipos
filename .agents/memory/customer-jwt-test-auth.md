---
name: Customer JWT auth in Playwright tests
description: How to sign a valid customer bearer token for testing /api/customer/* endpoints
---

`/api/customer/*` routes use a separate JWT secret from admin/staff routes:
`(process.env.SESSION_SECRET || "fallback") + "_customer"`, with payload
`{ customerId, customerCode, type: "customer" }`. Admin/staff tokens use
`process.env.SESSION_SECRET || "vintrade-secret-key-2024"` with `{ id, username, email, role }`.

**Why:** These are two independent `jwt.sign`/`jwt.verify` scopes defined inline in
`server/routes.ts`. A token signed with the wrong secret or shape silently fails
auth (401) with no indication which secret was expected.

**How to apply:** When writing Playwright API tests that hit `/api/customer/*`
endpoints, sign tokens with the customer secret/shape shown above. `/api/customers`
(plural, admin CRUD) still requires an admin/staff token via the other secret —
don't confuse the two when a test needs to both create a customer (admin token)
and then act as that customer (customer token).
