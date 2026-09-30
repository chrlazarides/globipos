---
name: Voucher device trust boundary
description: Why money-bearing Terminal operations require separate device pairing
---

Require a separately paired, high-entropy device credential as well as online cashier authorization before creating or redeeming monetary instruments through the browser Terminal. Function approval controls availability, not authentication.

**Why:** The legacy Terminal bootstrap uses a human-readable terminal code, and offline cashier login requires downloading short-PIN hashes. A party with a terminal code could otherwise recover a cashier PIN offline; PIN rate limiting on new monetary endpoints would not solve that.

**How to apply:** When adding other money-moving Terminal APIs, enforce the paired-device boundary at the server route before business logic, then validate cashier identity and approval inside the transaction. Do not rely on a Terminal button being hidden or on a locally checked PIN.