---
name: New public API route checklist
description: Adding an unauthenticated route requires registering it in PUBLIC_PATHS, not just omitting requireX middleware
---

A global `requireAuth` middleware runs before route matching and 401s any `/api/*`
path not present in the `PUBLIC_PATHS` prefix list in `server/auth.ts`. Simply not
attaching `requireAdmin`/`requireStaff` to a route handler is not enough — the
global gate still blocks it.

**Why:** discovered when a newly added screen-facing route
(`GET /api/signage/play/:code`, `POST /api/signage/play/:code/heartbeat`) with no
auth middleware on the handler itself still returned `{"message":"Authentication
required"}` for anonymous callers, because the path prefix wasn't in `PUBLIC_PATHS`.

**How to apply:** whenever adding a new intentionally-public API surface (pairing
codes, kiosk/player pages, webhook receivers, bootstrap endpoints), add its path
prefix to `PUBLIC_PATHS` in `server/auth.ts` and verify with an unauthenticated
curl request, not just by reading the route handler.
