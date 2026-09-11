---
name: Browser-safe shared contracts
description: How browser code preserves legacy shared schema imports without importing the database package.
---

Legacy frontend code may depend on shared entities and form validation contracts, but those contracts must be represented in a browser-safe module rather than by importing the database package.

**Why:** The workspace isolates packages, and the database package owns server-side connection code. Importing it into browser bundles can cause builds to fail or expose the wrong runtime dependencies.

**How to apply:** Keep frontend compatibility types and the form schemas it actively uses in a local frontend module. Database types and schema exports remain server-only.