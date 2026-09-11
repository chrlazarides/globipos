---
name: Async Chromium test completion
description: Reliable completion signaling for long-running browser tests that use IndexedDB.
---

Headless Chromium's DOM dump can return while an asynchronous module is still running, even with a virtual-time budget. Long IndexedDB tests should expose an explicit completion state and have the runner poll it through the DevTools protocol.

**Why:** DOM dumping returned the initial page while a real catalog sync was still executing, creating a false test failure.

**How to apply:** For browser tests whose completion depends on IndexedDB transactions or many asynchronous pages, launch Chromium with remote debugging and wait for an explicit pass or fail value before terminating it.