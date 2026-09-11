---
name: Fleet domain monitoring
description: Reliability rules for periodically probing active customer deployment domains.
---

Periodic fleet probes must use a database-backed lease in addition to a process-local overlap guard. Each network probe needs a hard deadline shorter than the lease, and one target's failure must not abort the rest of the fleet.

**Why:** Process-local flags do not coordinate multiple server replicas, optimistic result writes prevent duplicate persistence but not duplicate outbound probes, and an unbounded DNS lookup can permanently hold a scheduler loop.

**How to apply:** Claim each due profile conditionally before network work, persist results only for the matching claim and unchanged routing, retry failures at a slower bounded cadence, and isolate errors per profile.