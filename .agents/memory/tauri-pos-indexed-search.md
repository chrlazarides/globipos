---
name: Tauri POS indexed search
description: Durable rules for fast SQLite product retrieval without breaking configured sale buttons or scheduled prices.
---

Use exact B-tree lookups for barcode/SKU scans and FTS5 token-prefix search for product text. Keep browse results bounded, but hydrate every layout-referenced item separately by stable server ID.

**Why:** Leading-wildcard `LIKE` scans the catalog, while simply limiting the shared product list makes configured layout buttons outside that page unsaleable.

**How to apply:** Maintain FTS through SQLite triggers, preserve exact-match priority outside the FTS limit, and verify plans with `EXPLAIN QUERY PLAN`. Current price selection must normalize ISO dates, enforce start/end windows, and break legacy ties deterministically.