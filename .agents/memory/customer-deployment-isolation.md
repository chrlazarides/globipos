---
name: Customer deployment isolation
description: GlobiPOS customer isolation and central release-management direction.
---

The user's preferred target is now a complete separate deployment and data store per customer, ideally on a customer subdomain, with one central Back Office to choose and roll out a version to selected or all installations. The current published installation should be the first test customer/canary. A shared multi-tenant platform with path-based URLs was explored as an easier alternative, but does not meet the user's stated ideal of independently deployed customers.

**Why:** The user wants isolation of each customer's installation and data, but does not want to publish each update manually across a chain of projects.

An interim central inventory may accept operator-supplied installation URLs and operator-attested release outcomes. This is a record of independently hosted installations, not automatic provisioning, publishing, or remote version enforcement. Leave the existing published installation untouched while building and reviewing that inventory.

**Why:** The user explicitly chose to stop the live DNS experiment and to supply new installation URLs themselves; the hosting provider and an automated fleet deployment mechanism have not been selected.

Moving customer installations off Replit is acceptable if the central Back Office can actually control provisioning and one-click version upgrades. Keep the existing published installation in place until an alternate hosting path is proven; this is permission to design for another host, not approval to migrate production now.

**Why:** Replit's documented Publishing controls do not expose a supported programmatic fleet-publish API, so the existing queued rollout cannot fulfill the requested one-click upgrade.

The user chose to retain existing live GlobiPOS data as the first customer's data if a shared tenant migration is pursued; with the preferred separate-deployment approach, preserve it in the first installation instead.

**Why:** Existing business records must not be discarded or silently made visible to newly signed-up customers.

**How to apply:** Do not replace separate installations with a shared database merely to make releases one-click. Pin each installation to a release and verify migration, health, and rollback per customer. Do not represent the existing rollout queue as automatic publishing; Replit's documented Publishing controls do not expose a supported programmatic fleet-publish API. A true one-click rollout may require a hosting platform with a deployment API. For any Replit custom hostname, add it to the exact Publishing project and use its Replit-provided A/TXT values for GoDaddy DNS; keep DNS credentials only in central control.