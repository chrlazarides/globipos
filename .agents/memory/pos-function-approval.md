---
name: POS function approval boundary
description: Approval is a saved admin review state, not automatic checkout execution; built-in codes remain stable across renames.
---

Keep a function's stable code when changing its display name. Approval belongs to the saved setup; cloning or saving edited work as a draft must not inherit approval. Existing layout buttons can retain their own labels independently of catalog names.

**Why:** Layouts and legacy handlers reference function codes. Changing a built-in code or treating an admin-approved specification as a deployed payment or printing handler could break layouts or falsely imply safe checkout behavior.

**How to apply:** Preserve codes and separate display labels from button IDs. Make approval explicit and show its scope clearly. Explicitly implemented external-tool launches may use approved destinations; do not infer that payment, printing, refund or general macro behavior became live. Any future use of approval as a broader execution gate needs separate server-side and Terminal verification.