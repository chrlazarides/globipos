---
name: WhatsApp chime preference scope
description: Which WhatsApp order-alert preferences follow a staff account versus the current device
---

The scheduled quiet-hours preference (enabled/start/end) follows the signed-in staff account across
devices. The manual chime mute remains local to the browser/device, and the temporary "override quiet
hours for tonight" remains session-local.

**Why:** The product owner explicitly confirmed that recurring quiet-hours schedules should follow the
staff member, so a manager using both a shop computer and phone gets the same schedule. Manual mute and
the temporary override are transient controls for the device currently making sound and must not affect
other devices.

**How to apply:** Keep recurring schedule reads/writes account-backed and refresh them when another
device may have changed them. Do not move the manual mute or temporary override into account settings
unless stakeholders make a separate explicit decision.
