---
name: Product variants stock adjustment pattern
description: How per-variant stock is kept in sync across sales invoices, credit notes, and purchase invoices when a base item also has variants.
---

When a product catalog has both a parent item stock pool and per-variant stock pools (`itemVariants.stockQuantity`), every place that mutates stock for a line item must branch on whether the line carries a `variantId`.

**Why:** the item and its variants are separate rows with separate `stockQuantity` columns. If any code path (create, update/replace, delete/reverse) mutates only the parent item's stock, variant stock silently drifts out of sync with real inventory the moment variants are involved.

**How to apply:** centralize the branch in one small helper per document type (e.g. `adjustSaleLineStock` for sales invoices/credit notes, `adjustPurchaseLineStock` for purchase invoices) that takes a `sign: 1 | -1` and internally does: if `line.variantId` exists and the variant is found, mutate `itemVariants.stockQuantity`; otherwise fall back to `items.stockQuantity`. Call this helper from every mutation site for that document type — create, delete/reverse, and update (both the "reverse old" and "apply new" halves) — instead of duplicating the increment/decrement logic inline at each site. Barcode-lookup endpoints should also return a merged view (variant price/stock overlaid on the parent item) so scanning a variant barcode operates on the right pool from the start.
