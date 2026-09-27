---
name: Customer deployment isolation
description: The user's chosen architecture and operating model for GlobiPOS client installations.
---

Each customer gets a separate published Replit project and a fresh, isolated database, while all installations follow one shared codebase. One customer can have multiple locations and POS terminals under that installation. The user chose guided setup with manual Replit Publish as the easiest-to-follow approach; central control should record each customer's versions and update outcomes without claiming that recording a rollout actually publishes it.

**Why:** The user wants isolation of customer data, a customer-specific subdomain, repeatable updates across customers, and a full history of which customer received which version. GoDaddy hosts the domain's authoritative DNS, but merely connecting the main domain to Replit does not provision each new customer's custom hostname.

**How to apply:** Keep project provisioning, publishing, and actual release verification explicit. Add each exact hostname in its own project's Replit Publishing settings first; only then use the Replit-provided A/TXT values for GoDaddy DNS. Keep DNS credentials exclusively in the central control installation, never in customer projects. Treat fleet rollout targets as intentions until an individual installation is updated and checked; never use a shared production database merely to support multiple customer hostnames.