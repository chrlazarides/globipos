---
name: Financial client recovery
description: Preserve original financial requests across terminal reloads and exercise real client payloads in tests.
---

Persist a financial checkout's immutable request before sending it; uncertain outcomes must retain that request and ID across reloads and subsequent authentication failures. Never persist the cashier PIN with the recovery record.

**Why:** Server-side idempotency alone does not prevent a terminal from generating a new checkout ID after losing its response or restarting. An authentication error on a later retry cannot prove the original purchase failed.

**How to apply:** Scope recovery to store, terminal and cashier; keep financial fields frozen, require fresh authentication, and clear recovery only after confirmed completion or a definitive rejection of a first attempt.

Include real terminal payload helpers in financial integration tests, not only manually constructed request bodies.

**Why:** Manually correct HTTP fixtures can pass while both actual terminals send an incompatible payment field.

**How to apply:** Exercise cash, recorded card and account-credit payloads from each maintained terminal client against the same backend checkout contract.