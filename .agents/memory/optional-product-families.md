---
name: Optional product families
description: Catalog classification and transfer rules for SwiftPOS-style horizontal product families.
---

A product may belong to one optional family independently of its category. Categories remain the vertical hierarchy; families group products horizontally across unrelated categories. Never infer assignments when the source export contains definitions but no product-to-family key.

**Why:** SwiftPOS FamilyTable supplies family definitions but the available ProductTable has no FamilyID link. Guessing assignments would silently misclassify products, while database IDs can differ across deployments.

**How to apply:** Keep family assignment nullable, permit filtering across categories, seed known definitions without assigning products, and map catalog-transfer references through stable family codes.