---
name: Customer deployment isolation
description: GlobiPOS customer isolation and central release-management direction.
---

Earlier, the user preferred a complete separate deployment and data store per customer, ideally on a customer subdomain. A later request explicitly calls for Deployment Control to present a **single shared published release** with one version/history and per-customer signup, configuration, health, and flags. The older separate-installation preference should not override this newer request.

**Why:** The user wants isolation of each customer's installation and data, but does not want to publish each update manually across a chain of projects.

If one API process temporarily serves several customer hosts, keep one fully separate database per installation rather than adding host-based routing over the unscoped legacy tables. Never silently assign the existing database to a second business.

**Why:** The installation schema predates tenant ownership; a hostname alone cannot enforce ownership across direct IDs, exports, POS sync, and background queries. Separate databases maintain a hard boundary without relying on every query remembering a filter.

**How to apply:** Preserve independent deployments as the preferred topology; treat shared-process database-per-installation mode as explicit, provisioned infrastructure with tenant-bound request and job context, not as an automatic signup shortcut.

Even when all ORM calls use a tenant-bound pool, external database utilities can bypass it by reading a process-wide connection URL. Keep package exports and other out-of-process dump paths unavailable in shared-process mode unless they select the verified tenant database explicitly.

**Why:** A tenant's superuser can legitimately reach an export endpoint while its dump command silently reads the original installation; route authorization alone cannot constrain a separate process.

**How to apply:** Include out-of-process backups, restores, archives, and provider configuration in every tenant isolation audit; exercise real registered endpoints with separate test databases, not only simulated CRUD handlers.

An interim central inventory may accept operator-supplied installation URLs and operator-attested release outcomes. This is a record of independently hosted installations, not automatic provisioning, publishing, or remote version enforcement. Leave the existing published installation untouched while building and reviewing that inventory.

**Why:** The user explicitly chose to stop the live DNS experiment and to supply new installation URLs themselves; the hosting provider and an automated fleet deployment mechanism have not been selected.

Moving customer installations off Replit is acceptable if the central Back Office can actually control provisioning and one-click version upgrades. Keep the existing published installation in place until an alternate hosting path is proven; this is permission to design for another host, not approval to migrate production now.

**Why:** Replit's documented Publishing controls do not expose a supported programmatic fleet-publish API, so the existing queued rollout cannot fulfill the requested one-click upgrade.

The user chose to retain existing live GlobiPOS data as the first customer's data if a shared tenant migration is pursued; with the preferred separate-deployment approach, preserve it in the first installation instead.

**Why:** Existing business records must not be discarded or silently made visible to newly signed-up customers.

**How to apply:** In Deployment Control, show one shared release history, with per-customer operational status. Do not represent a planning queue or operator-recorded version as an automatic publish or as independently measured production evidence. If a future task revisits separate deployments, resolve that product decision before changing release semantics. For Replit custom hostnames, use the Publishing project's exact A/TXT values; keep DNS credentials in central control.
