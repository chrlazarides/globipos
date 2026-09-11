---
name: Single stock pool vs multi-location moves
description: How to implement "stock transfers" when the schema only tracks one global stockQuantity per item
---

Some apps model inventory with a single `items.stockQuantity` column and no per-location
stock table, even though the UI has a "Transfers" or "Move Stock" feature between named
locations (e.g. warehouse -> store, store -> store).

**Why:** Building a full per-location stock ledger is a much bigger schema change than the
feature usually calls for, and often isn't needed — the dominant real-world case is moving
stock in/out of one tracked "source of truth" location (e.g. a central warehouse), while
store-to-store or shelf-to-shelf moves are typically just informational logging in these
apps.

**How to apply:** When only one global stock pool exists, designate the tracked location
(e.g. by name match like "warehouse"). On transfer completion:
- If the tracked location is the `from` side, decrement stockQuantity (reject with a 400 if
  insufficient stock).
- If the tracked location is the `to` side, increment stockQuantity.
- If neither side is the tracked location, don't touch stockQuantity — the transfer is still
  recorded as a movement log, but neither side is the pool being tracked.
Document this limitation directly in the schema/comments near the relevant tables so future
work doesn't assume real multi-location stock tracking exists.
