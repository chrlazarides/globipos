---
name: Large catalog loading
description: Performance constraints for browser and API behavior with a six-figure product catalog.
---

Never load the complete item catalog as global application state or recursively serialize large API responses into logs. Catalog screens must use bounded server-side pagination/search, and optional bulk panels must not query until opened.

**Why:** A catalog above 100,000 products freezes the browser during JSON parsing/rendering and can also block the server while response middleware copies and logs the body.

**How to apply:** Keep general screens independent of item data; paginate item-management views; use direct barcode/search endpoints for selectors and POS flows; summarize large arrays in request logs.