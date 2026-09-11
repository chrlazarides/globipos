---
name: ERP sync deployment boundary
description: Why ERP business-data synchronization runs locally inside each isolated customer deployment.
---

ERP synchronization must run inside the customer deployment that owns the business database. The central deployment-control process may manage rollout metadata, but must not read local business tables and send them using credentials selected for another deployment.

**Why:** Business tables are intentionally not tenant-keyed because each customer has a separate backend and database. Selecting a remote deployment while reading the current process's tables creates a cross-customer disclosure and corruption risk.

**How to apply:** Keep ERP configuration singleton-scoped to the local deployment database, resolve credentials only from that deployment's secrets, and never add a central deployment picker to the business-data sync API.