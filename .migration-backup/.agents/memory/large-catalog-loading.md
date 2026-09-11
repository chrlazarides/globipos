---
name: Large catalog loading
description: Performance constraints for browser and API behavior with a six-figure product catalog.
---

Never load the complete item catalog as global application state or recursively serialize large API responses into logs. Catalog screens must use bounded server-side pagination/search, and optional bulk panels must not query until opened.

**Why:** A catalog above 100,000 products freezes the browser during JSON parsing/rendering and can also block the server while response middleware copies and logs the body.

**How to apply:** Keep general screens independent of item data; paginate item-management views; use direct barcode/search endpoints for selectors and POS flows; summarize large arrays in request logs.

Terminal bootstrap pages must retry interrupted GET requests. Persist the opaque page cursor only after the complete response body is read and its data is committed locally.

**Why:** An Autoscale proxy can close a catalog response stream after the server has already logged a normal HTTP 200 response. A catalog with six figures of items magnifies the chance of encountering this transient failure during its hundreds of page requests.

**How to apply:** Retry only transport and response-body read failures with bounded backoff on the same cursor. Do not retry malformed JSON or non-success HTTP responses automatically; surface those as actionable server/API failures.