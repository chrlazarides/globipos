---
name: Layout simulation boundary
description: Distinguish local simulator actions from saved function-rule previews on a full POS layout.
---

The full-layout preview should use its actual test cart and transaction context to evaluate saved conditions, but configured financial outcomes and macro plans remain non-mutating traces unless a separately verified simulator handler exists. Ordinary built-in simulator buttons can still alter the local test cart.

**Why:** A proposed voucher or a macro step is not proof of issuance, printing, accounting, or checkout execution. Treating a trace as a completed operation would make an admin's test misleading.

**How to apply:** Show rule matches, missing inputs and unimplemented steps explicitly; never silently apply a saved financial configuration in the layout preview. If real checkout behavior is later simulated, distinguish that execution from the configuration trace and verify both paths separately.