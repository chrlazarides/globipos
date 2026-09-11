---
name: Client console.error can kill the dev server
description: Why a page that triggers any React console.error (e.g. DOM-nesting warning) makes the whole dev app die with no crash trace.
---

The dev setup forwards browser `console.error` output into the Vite logger, and
the server's Vite integration calls `process.exit(1)` on any Vite error log.
Result: merely *opening* a page that logs a React warning (e.g.
`validateDOMNesting: <div> cannot appear as a descendant of <p>` from a shadcn
`Badge`, which renders a `<div>`, placed inside a `<p>`) silently kills the
entire Express+Vite process.

**Why:** the exit-on-error hook is meant for build errors, but forwarded client
warnings go through the same logger, so a cosmetic React warning becomes a
server crash with no stack trace in the workflow log — it just ends after the
warning text and the workflow shows FAILED.

**How to apply:**
- If the dev server "randomly" dies right after someone opens a specific page,
  grep the tail of the workflow log for `[console.error]` — the page logging a
  React warning is likely the killer.
- Never nest block elements (Badge, div) inside `<p>` or shadcn
  `CardDescription` (renders `<p>`).
- Verify UI pages with a real authenticated browser pass (Playwright cookie
  inject) — curl-only API checks miss this class of bug entirely.
