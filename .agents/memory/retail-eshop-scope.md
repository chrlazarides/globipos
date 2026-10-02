---
name: Retail eShop scope
description: The eShop is part of the GlobiPOS ecosystem, with retail-specific appearance choices available during deployment and upgrades.
---

The user wants a fully functional retail eShop connected to the existing ecosystem, with multiple look-and-feel options such as Grocery Store, Sports and Toy Store. These choices must be available in deployment options and upgrades, not only during initial design.

The first implementation must be GlobiPOS-native. The user wants flexibility to offer Shopify, Wix and other platform options later; external commerce platforms are not prerequisites for the native launch.

**Why:** The user explicitly requested ecosystem-connected retail stores with selectable industry appearances at deployment and upgrade time, then clarified: “I need it flexible, but Globipos first implementation and Shopify, wix etc options.”

**How to apply:** Plan and implement native GlobiPOS first, leaving room for optional platform integrations. Include both initial deployment selection and later changes in the scope. The named retail types and external platforms are examples, not closed lists. Do not treat an isolated visual storefront or a deployment-only theme picker as meeting this requirement. External-platform capabilities and inventory-ownership rules require explicit assessment before integrating them.

## Stock configuration

Stock setup must include flexible scenarios and business models. The user's preferred setup is an eShop-specific stock location set, or an option to accept orders without requiring stock, while retaining all the flexibility discussed.

**Why:** The user explicitly requested flexible stock scenarios and business models, then confirmed: “yes configurable rules, ideally the eshop has its own stock location set or no stock options on order, but include all flexibility as discussed.”

**How to apply:** Include dedicated eShop locations and a no-stock-required ordering option without making either the only supported model. Keep shared stock, warehouses, multi-location fulfilment, supplier fulfilment, preorders/backorders, consignment and hybrid product rules in the planning scope. These are requirements, not claims that the capabilities are already implemented.