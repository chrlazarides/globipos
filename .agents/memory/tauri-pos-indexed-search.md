---
name: Tauri POS indexed search
description: Durable rules for fast SQLite product retrieval without breaking configured sale buttons or scheduled prices.
---

Use exact B-tree lookups for barcode/SKU scans and FTS5 token-prefix search for product text. Keep browse results bounded, hydrate every layout-referenced item separately by stable server ID, and bootstrap the local catalog through resumable keyset pages rather than the terminal-registration response.

**Why:** Leading-wildcard `LIKE` scans the catalog, while simply limiting the shared product list makes configured layout buttons outside that page unsaleable. Returning the full catalog during registration also exceeds practical proxy/client response limits on large deployments.

**How to apply:** Maintain FTS through SQLite triggers, preserve exact-match priority outside the FTS limit, and verify plans with `EXPLAIN QUERY PLAN`. Download deterministic bounded pages, persist a cursor scoped to server and terminal, commit each page atomically, and mark sync complete only after the final page. Current price selection must normalize ISO dates, enforce start/end windows, and break legacy ties deterministically.