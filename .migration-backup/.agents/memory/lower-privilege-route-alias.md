---
name: Lower-privilege alias of an admin route
description: When exposing an admin-only capability to a lower-privilege role, strip/gate the privileged sub-fields so you don't silently widen scope.
---

When you add a lower-privilege alias route for something that previously lived
behind an admin-only route (e.g. a `requireStaff + requireModule("x")` create
route mirroring an admin `create` route), do NOT pass the full validated payload
straight through — some fields carry admin-only side effects.

**Concrete case:** `POST /api/stock-locations` lets items-module staff create a
`pos_locations` row (creation was previously admin-only under `/api/pos/locations`).
But the schema includes `isDefaultReceiving`, which reassigns the *global* default
receiving location — an admin-only action. The route forces `isDefaultReceiving:false`
on the created row and only calls `setDefaultReceivingLocation` when the caller is
admin/superuser.

**Why:** an insert schema with `.default(false)` on a privileged flag will happily
persist `true` if the client sends it, and `storage.create*` writes the flag directly
without the "clear the others" logic that the dedicated setter has — so you get a
scope escalation AND a data-integrity bug (two defaults) in one line.

**How to apply:** for any privileged boolean/relationship field on a payload reused
by a lower-privilege route, either omit it from the parsed data or overwrite it with
the safe default unless `req.user.role` is admin/superuser.
