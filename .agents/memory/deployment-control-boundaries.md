---
name: Deployment control boundaries
description: Approved master/customer separation and host-independent installation identity.
---

Develop the shared GlobiPOS source here, but operate fleet management from a dedicated published master. Customer installations are independent and must continue trading when the master is unavailable. Fleet credentials must not be copied into customer installations.

**Why:** The owner approved central production management with independent WHM/cPanel customer installations, rather than relying on development workflows for live operations.

**How to apply:** Enforce Master/Customer responsibilities on the server, not just in menus. Do not convert an existing trading installation into a control-only master without separately addressing its business data.

A customer's deployment identity is independent of its WHM server or cPanel account. Hosting connections must be configurable per server, and changing the preferred server must not silently migrate existing customers.

**Why:** The owner explicitly requires deployment flexibility across different servers. A physical host change must not replace the customer's identity or allow simultaneous writes to divergent databases.

**How to apply:** Keep stable deployment identity/history separate from hosting assignments. Treat a server move as an explicit migration, fence the old writer and account for post-cutover transactions before any rollback.

Sync indicators must describe confirmed operational state, not just network connectivity. Catalog records, acknowledged transactions and physically transferred stock units are distinct metrics. Missing device reports must become stale, not remain apparently live.

**Why:** The owner requires standalone POS/PWA progress, transferred counts and last-sync visibility. A closed or sleeping PWA cannot continuously report, and attempted requests do not prove successful stock or transaction processing.

**How to apply:** Preserve channel-specific success times across restarts, advance confirmed counters only after acknowledgement and local persistence, and retain failed/pending work. Distinguish device reporting freshness from application-server health.