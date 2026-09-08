---
name: Safe catalog transfer
description: Invariants for moving large catalogs between isolated deployments without damaging live operational data.
---

Transfer categories, items, variants, and barcode aliases in one bounded, serialized transaction. Resolve target item identities by stable SKU, preserve target IDs, and validate barcode ownership across item, variant, and alias sources before writing. Replacing global stock must fail if location-level allocations exist.

**Why:** Whole-database restore deletes unrelated live records; ID-only imports break references; cross-table barcode conflicts can silently make scans resolve to the wrong product; global stock replacement can disagree with location stock.

**How to apply:** Keep catalog transfer separate from backup restore, require superuser access, bound compressed and expanded input, lock catalog ownership tables through preflight and writes, and verify mapped row counts before commit.