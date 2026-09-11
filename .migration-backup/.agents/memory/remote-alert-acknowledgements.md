---
name: Remote alert acknowledgements
description: How to prevent a stale device heartbeat from resurrecting a remotely cleared alert.
---

When a monitor acknowledges a device alert, preserve that acknowledgement while incoming heartbeats still report the same alert state. Clear the acknowledgement only after the device reports a non-alert state, allowing a later alert to surface normally.

**Why:** Device and monitor state change independently. Without an acknowledgement latch, the next heartbeat can immediately overwrite the monitor action and make a cleared alert reappear.

**How to apply:** Use this rule for remotely acknowledged lane, terminal, or device alerts when the device has no direct command channel back from the monitoring UI.