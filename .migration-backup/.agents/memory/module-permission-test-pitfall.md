---
name: Module-permission middleware test pitfall
description: Why a manually minted test JWT can make a permission-gate middleware look broken when it isn't
---

When testing a module-permission middleware (e.g. `requireModule(module)`) by minting a JWT
by hand (via `jsonwebtoken` in a curl-based test script) rather than going through the app's
real `signToken()`, make sure the payload includes every field the real token includes —
especially `permissions`.

**Why:** Middleware that treats "empty/undefined permissions array = full access" (a common,
correct pattern for "no restrictions configured") will happily let a token with a *missing*
`permissions` field through, because `undefined` satisfies the same falsy check as `[]`. This
makes a real bug (module gating not enforced) invisible, and also makes a *correctly working*
middleware look broken in the other direction if you assumed the missing field would default
to "no access" instead of "full access".

**How to apply:** Before trusting a permission-test result, print/log the exact JWT payload
(minus the signature) you minted and diff it against the shape produced by the app's real
`signToken`/login flow. If a field is missing, add it explicitly rather than assuming a
sensible default.
