---
name: Spreadsheet import parity
description: Why the data import should submit the rows and mappings shown in its review screen.
---

For spreadsheet imports, keep the submitted data identical to the rows and column mapping the user reviewed. Do not rely on a second parser to discover headers differently at the save step.

**Why:** A supplier workbook repeated its report title across the first row, with actual column headings below. Separate browser and server parsing paths led to repeated failures despite a correct-looking mapping; changing only the header heuristic did not resolve the user's retry. The reviewed rows are the more reliable import contract.

**How to apply:** When extending another import entity or changing spreadsheet detection, verify that its save path consumes the reviewed rows or proves parity with them. A parser-only test does not establish that an authenticated import succeeded; avoid writes to live item data just to test this.