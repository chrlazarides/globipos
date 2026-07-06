---
name: Chime/quiet-hours device scope decision
description: Whether the WhatsApp order-alert chime mute + quiet hours should be per-device or per-user
---

The WhatsApp new-order chime's mute toggle and quiet-hours window (enabled/start/end) are stored in
`localStorage`, scoped per browser/device, not synced to a user account server-side. The session-only
"override quiet hours for tonight" uses `sessionStorage` similarly.

This was a deliberate choice, not an oversight: the chime is a physical sound played by whichever
computer/device currently has the admin panel open. Scoping it per-device means muting a shared
front-desk PC at night doesn't silence the chime on another staff member's personal laptop, and vice
versa — which matches how a physical alert bell would behave in a shop.

**Why:** When asked directly whether this should instead follow the staff member across devices
(per-user, server-side), the product owner had no preference / declined to decide. Per-device was kept
as the lower-risk default since it was already the existing, working behavior and requires no new
server-side state or account-linked settings.

**How to apply:** If a future task wants quiet hours to follow the person instead of the device, move
`whatsapp_alert_quiet_hours_enabled` / `_start` / `_end` (and optionally the mute key) from localStorage
into a per-user preference (new table/column keyed by user id) with API read/write endpoints. Keep the
session-only override as device/session-local regardless, since it's meant to be transient.
