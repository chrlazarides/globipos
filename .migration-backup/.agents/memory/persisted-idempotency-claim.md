---
name: Persisted idempotency claim design
description: How to design a DB-backed "in-flight claim" guard for an operation with real external side effects (e.g. charging a payment provider), so a process restart cannot let a retry double-fire the side effect.
---

When an in-memory idempotency/in-flight guard (e.g. a `Set` of keys) is backed
up by a persisted DB column so it survives a process restart, the persisted
claim function must NOT treat "the same key was resubmitted" as an automatic
successful (re-)claim that lets the caller proceed to redo the real side
effect (e.g. call the payment provider again).

**Why:** the in-memory guard already handles same-process duplicate detection
synchronously. The persisted guard exists specifically for the case where that
in-memory state is gone (restart) and a retry with the *same* key arrives. If
"matching key => claim succeeds => proceed" is used, then after a restart a
retry with the same key sails straight through and re-triggers the side
effect — exactly the failure mode the persisted guard was built to prevent.
This was caught by code review after an initial (wrong) implementation.

**How to apply:** the persisted claim should only succeed when there is *no*
existing recent attempt at all — i.e. the slot is empty (null) or the prior
attempt is older than a shared "still might be in-flight" TTL window (treat it
as abandoned). A matching key with a still-recent attempt must be treated
exactly like a conflicting key: reject the claim and route the caller to a
"verify the actual outcome" flow (e.g. poll a status endpoint) instead of
letting it redo the operation. Share the same TTL constant between the claim
function, the status endpoint, and any boot-time reconciliation scan so their
notion of "still in progress" can't drift apart.
