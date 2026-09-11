---
name: Missing single-resource GET route masked by SPA fallback
description: When a frontend page fetches GET /api/x/:id but only list/PUT/DELETE routes exist for that resource, the request silently falls through to the Vite/SPA catch-all (returns index.html with 200) instead of a clear 404, so query data stays undefined forever with no visible error.
---

Symptom pattern: a page shows "0 items" / blank grid / empty state even though the list and sub-resource endpoints work fine and the DB has data. Browser network tab may show a 200 for the failing request because it's the app shell HTML, not JSON — `.json()` parsing then throws or silently yields wrong data, and React Query's `data` stays `undefined`, so any `useEffect` gated on `if (!data) return;` never runs.

**Why:** Express matches routes by exact path; a route only for `/api/x/:id/sub` does not also serve `/api/x/:id`. If the base single-resource GET was never added (only list/create/update/delete + sub-routes exist), requests for it fall through to the SPA catch-all rather than erroring loudly.

**How to apply:** When a "data isn't loading/rendering" bug is reported for a page that clearly does a `GET /api/.../:id` fetch, check the route table for that exact base route before assuming a frontend logic bug — `grep` all `app.get/post/put/delete` for the resource prefix and diff against what the frontend's `queryKey`/`apiRequest` calls actually hit. A suspiciously fast "200" response for what should be a JSON endpoint is a red flag it's actually the HTML fallback.
