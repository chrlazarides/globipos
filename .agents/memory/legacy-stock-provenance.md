---
name: Legacy stock provenance
description: Operational boundary between pre-existing global inventory, shop allocations, and newly received stock.
---

Do not automatically distribute legacy global stock to shops, even when there are only two active locations. Its physical location is not known. Shop quantities must come from a location-tagged count/import; Stock In means *newly received* units and must not be used to assign existing units.

**Why:** A guessed allocation could expose a held last item for sale at the wrong shop. Adding existing units through Stock In instead would inflate the global balance.

The user approved a staged rollout: multi-store stock control stays disabled by default while shop quantities are populated gradually. Setup-mode sales retain legacy global-stock behavior; reservations cannot be created in setup mode.

**Why:** Publishing strict shop-stock enforcement before counts exist would stop normal trading. Partial shop imports must not overwrite the existing global total.

**How to apply:** Treat shop counts as setup snapshots while control is disabled, not as live sale balances. Legacy sales can make those snapshots stale, so reconcile them with global totals before activation. Once enabled, enforce unreserved location stock for shop and online sales; refuse disabling with active holds. Do not bypass holds simply because a setting is missing.

Transfers remain usable during staged rollout, but require entered source-shop quantities even when stock control is disabled. They move existing units, not new receipts.

**Why:** The global balance does not establish physical ownership by a shop. Falling back to global stock for a transfer would invent that ownership; treating transfers as Stock In would inflate total stock.

**How to apply:** Protect reserved units in every transfer channel and mode. Require source counts instead of guessing an allocation, and leave global quantities unchanged.