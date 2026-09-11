---
name: Client deployment isolation
description: The agreed deployment and upgrade model for independently operated GlobiPOS clients.
---

Each client must run as a separate backend deployment with its own database. Keep all clients on the same main codebase; do not create client-specific branches or add tenant columns to shared business tables.

The main published app in this Replit remains the permanent demonstration environment. Never repurpose it as a customer installation; provision a new isolated deployment when a customer is onboarded.

**Why:** Physical deployment/database isolation minimizes cross-client data leakage, while one source tree keeps support and upgrades consistent. Keeping the main publication as a demo provides a stable sales and testing environment. Client-specific branding, domains, modules, providers, and release targets belong in centrally managed deployment profiles.

**How to apply:** Build control-plane features in the development back office, gated to superusers and disabled in client production environments unless explicitly enabled. Exclude the main demo from customer provisioning and customer data. Keep rollout orchestration provider-neutral until Replit Admin API or GitHub automation is attached. Generate `<slug>.globipos.shop` as the customer's single primary hostname for both back office and POS. Reserve `web-<slug>.globipos.shop` for the separately provisioned e-shop. Replit does not support wildcard custom domains, so connect each generated hostname individually in Publishing and DNS. Keep one reusable customer-app build and select its storefront template from deployment branding, mirrored into the isolated deployment's `customer_storefront_template` setting; do not fork the customer app per template.