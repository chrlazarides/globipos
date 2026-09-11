---
name: Quiet-hours time-zone authority
description: Why synced recurring schedules must carry their own explicit IANA time zone.
---

Persist an explicit IANA time zone with each account's recurring quiet-hours schedule, and evaluate the window in that zone on every device.

**Why:** Device-local zones make one schedule occur at different real-world times, while deriving the zone from an operational location flag lets unrelated location changes silently alter alert policy.

**How to apply:** Any recurring staff notification schedule should return its authoritative IANA zone with the schedule and use time-zone-aware platform APIs so daylight-saving rules apply automatically.