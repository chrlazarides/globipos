---
name: WhatsApp chime preference scope
description: Which WhatsApp order-alert preferences follow a staff account versus the current device
---

The scheduled quiet-hours preference (enabled/start/end) follows the signed-in staff account across
devices. Manual chime mute remains local to the browser/device. The temporary urgent-order override is
shared store-wide and persisted with an absolute expiry timestamp.

**Why:** The product owner explicitly confirmed that recurring quiet-hours schedules should follow the
staff member, so a manager using both a shop computer and phone gets the same schedule. Manual mute is
specific to the device making sound, while an urgent-order override must reach every staff device.
Server-side expiry prevents a closed originating device from leaving the override active indefinitely.

**How to apply:** Keep recurring schedule reads/writes account-backed and manual mute device-local.
Always read/write urgent overrides through shared server state and use the activating account's quiet
window end as the expiry.
