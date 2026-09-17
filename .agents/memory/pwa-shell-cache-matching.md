---
name: PWA shell cache matching
description: Why offline PWA shell assets require variance-insensitive Cache Storage lookups in this environment.
---

For immutable, build-hashed PWA shell assets, use Cache Storage lookups that ignore response variance.

**Why:** The preview or hosting proxy can add a `Vary` header. A precached script or stylesheet can then appear in Cache Storage but fail to match the browser parser's request during a true network outage, leaving the offline shell blank.

**How to apply:** Validate offline launch by stopping the HTTP server after service-worker installation and opening a fresh controlled page. Confirm the rendered shell, not only cache contents or source patterns.