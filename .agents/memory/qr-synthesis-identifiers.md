---
name: QR synthesis identifiers
description: Why QR inventory identifiers are self-describing and how future code should handle them.
---

Synthesized QR inventory identifiers use a `QR:` prefix, and the complete prefixed value is encoded into the QR image and stored as the item barcode.

**Why:** Existing items and label queues do not persist a separate barcode-symbology field. A self-describing prefix lets label rendering and scanners distinguish QR from linear barcodes without a database migration or fragile content-length guessing.

**How to apply:** Preserve the prefix through inventory posting, item lookup, scanning, synchronization, and label printing. New barcode consumers should recognize `QR:` before applying EAN or Code-128 detection.