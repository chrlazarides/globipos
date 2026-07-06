---
name: Browser Playwright test auth+deps setup
description: How to write a real browser-driven Playwright test in this project (vs API-only specs) — auth bypass, Radix Select quirk, missing Chromium system libs.
---

Existing specs in `tests/*.spec.ts` are API-only (no `page.goto`). When a task
needs to assert on actual rendered UI/dialog state (not just API responses),
a few non-obvious things matter:

- **Auth bypass must use a real DB row, not a synthetic id.** Pure-API tests
  can sign a JWT with a made-up user id, but browser tests can't: the
  client's AuthGate calls `/api/auth/me` on every load, which does a fresh
  DB lookup by id and 401s otherwise. Look up a real seeded admin/superuser
  id first, then inject the signed cookie before `page.goto`.
  **Why:** most API endpoints trust `req.user` from the JWT alone, but the
  client-side auth gate re-validates against the DB.

- **Component libraries that don't forward `data-testid` to the DOM** (e.g.
  Radix `Select.Root` in this codebase) require targeting by visible text or
  a different accessible attribute instead of `getByTestId`/`getByRole` on
  the wrapper — check what the library actually renders before assuming a
  testid prop reaches the DOM.

- **Prefer mocking a status/config endpoint over conditionally skipping.**
  When a feature's availability depends on environment config (e.g. whether
  a payment provider is configured), mock the status endpoint deterministically
  so the test always exercises the real scenario, rather than adding a
  `test.skip` fallback that can silently mask the assertions in some
  environments.

- **Headless Chromium in this sandbox needs extra Nix system libs**
  (glib, nss, dbus, atk, mesa, cairo, pango, gtk3, etc. via
  `installSystemDependencies`) before it can launch at all — not
  preinstalled by default.
