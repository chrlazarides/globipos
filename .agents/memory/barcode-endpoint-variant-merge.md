---
name: /api/items/barcode returns variant-merged items
description: The barcode lookup endpoint can return a parent item merged with a specific variant, which breaks features that lack variantId support
---

`GET /api/items/barcode/:code` does not always return a plain parent item. When the
scanned barcode belongs to a variant, it returns a merged view (parent item id +
`variantId` + variant-specific fields via `mergeVariantIntoItem`). It may also return
an item with `hasVariants === true`.

**Why:** Any "add by scan" feature whose data model has no `variantId` column (e.g.
stock transfers, whose `stock_transfer_items` is parent-only) will silently record a
variant as a parent-level line, moving/adjusting the wrong stock.

**How to apply:** In any scan handler that feeds a variant-unaware model, guard the
result: if `item.hasVariants || item.variantId`, reject with a clear message instead
of adding it. A UI picker that filters out `hasVariants` items is NOT enough — the
scan path bypasses that filter.
