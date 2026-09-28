---
name: Spreadsheet import parity
description: Why the data import should submit the rows and mappings shown in its review screen.
---

For spreadsheet imports, keep the submitted data identical to the rows and column mapping the user reviewed. Do not rely on a second parser to discover headers differently at the save step.

**Why:** A supplier workbook repeated its report title across the first row, with actual column headings below. Separate browser and server parsing paths led to repeated failures despite a correct-looking mapping; changing only the header heuristic did not resolve the user's retry. The reviewed rows are the more reliable import contract.

**How to apply:** When extending another import entity or changing spreadsheet detection, verify that its save path consumes the reviewed rows or proves parity with them. A parser-only test does not establish that an authenticated import succeeded; avoid writes to live item data just to test this.

For Items rows without a SKU, use the source barcode to find an existing item (including its aliases) and preserve that item's SKU. Give a new item a deterministic internal SKU derived from its source barcode; reject ambiguous barcode ownership rather than attaching the row to an arbitrary item.

**Why:** The product record requires a unique SKU, but suppliers may only provide barcodes. Treating a barcode-only row as a new item on every import would create duplicates or replace a barcode that already belongs to a different item.

**How to apply:** Keep barcode-only imports idempotent on retry, including when an invalid source barcode is replaced by an internal one. Never silently reassign a variant or multiply-owned barcode.