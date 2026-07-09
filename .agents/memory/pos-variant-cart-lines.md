---
name: POS cart lines with variants need a compound identity
description: How POS register/simulator cart lines must key on itemId+variantId, not itemId alone, once variants exist
---

When a cart/line-item model in this app supports item variants (color/size/etc.), any place that dedupes or targets a cart line by `itemId` alone (qty +/-, remove, merge-on-add) must switch to a compound key (`itemId::variantId`), otherwise adding two different variants of the same parent item collapses them into one line or lets removing one remove both.

**Why:** `pos-register.tsx` and `pos-simulate.tsx` cart state pre-dated variants and identified lines purely by `itemId`. Bolting variants on required updating every keyed lookup (qty change, remove, existing-line merge, `key=` in list render) to the compound key, not just adding a `variantId` field to the line type.

**How to apply:** When adding variant support to any new cart/order UI, grep for all `l.itemId ===` / `line.itemId` comparisons first — each one is a candidate bug if left un-updated. A single `GET /api/item-variants` (all variants, unfiltered by item) is useful for client-side barcode/SKU scan-matching across the whole catalog without N+1 fetching per item.
