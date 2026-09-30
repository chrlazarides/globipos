---
name: Legacy stock provenance
description: Operational boundary between pre-existing global inventory, shop allocations, and newly received stock.
---

Do not automatically distribute legacy global stock to shops, even when there are only two active locations. Its physical location is not known. Shop quantities must come from a location-tagged count/import; Stock In means *newly received* units and must not be used to assign existing units.

**Why:** A guessed allocation could expose a held last item for sale at the wrong shop. Adding existing units through Stock In instead would inflate the global balance.

**How to apply:** When extending inventory, keep location-controlled sales fail-closed until real per-shop counts exist. Treat a location-tagged import as an absolute count, not a receipt, and preserve the sum of assigned shop quantities as the global balance.