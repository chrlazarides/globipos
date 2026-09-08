---
name: Domain incident lifecycle
description: Rules for preserving truthful domain outage and recovery history across routing changes.
---

An open domain incident closes only when a later domain probe succeeds. Repeated failures stay within the same incident, routine successes create nothing, and editing routing must not be recorded as recovery.

**Why:** A routing edit is not evidence that service recovered. Closing incidents during configuration changes produces false recovery timestamps and creates race windows where a new failure can be left without an open incident.

**How to apply:** Derive incident writes from persisted status transitions and keep them in the same transaction as probe results. Enforce at most one open incident per deployment in the database.