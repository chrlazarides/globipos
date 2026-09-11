---
name: Radix Select empty-string value crashes whole page
description: A <SelectItem value=""> (e.g. an "All X" option) throws an uncaught Radix error that can crash the page render, masquerading as "feature X is broken"
---

Radix UI's `<Select.Item>` throws at render time if given `value=""` — the error is
"A `<Select.Item />` must have a value prop that is not an empty string." This is an
uncaught exception, so it can break the entire page (or wherever the offending Select
mounts), not just that dropdown.

**Why:** A user reported an unrelated-sounding bug ("promotions not working") that
was actually this crash on an admin edit dialog's "All Locations" option using
`value=""`. The dev-server crash logs from an unrelated moment were initially assumed
to be the culprit, delaying root-cause discovery.

**How to apply:** When a page/dialog is reported as "broken"/"erroring" with no other
symptoms, grep for `SelectItem value=""` (or any empty-string value passed to a Radix
Select item) in the affected file first — it's a fast, high-signal check. Fix by using
a sentinel string (e.g. `"__all__"`) as the value and mapping it back to `null`/`""` in
the `onValueChange` handler.
