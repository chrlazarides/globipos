---
name: Configurable scale/weight barcode rules
description: How pos-app made the EAN-13 weight/price/PLU barcode prefix mapping admin-configurable instead of hardcoded
---

Weighted-item EAN-13 barcodes (scale labels, manufacturer weight PLUs) do not follow one universal prefix convention — different manufacturers assign different meanings (weight vs. price vs. PLU-only) to the same leading digits. A hardcoded "flag digit" scheme (e.g. "5-9 always means price") will silently misclassify barcodes from a manufacturer that uses those same digits for weight (e.g. Pittas uses "28"/"29" for weight-embedded PLUs, which a classic scale scheme would treat as price).

**Why:** the fix must be admin-configurable, not just a hardcoded default swap — new manufacturers/scale vendors keep showing up with their own prefix conventions.

**How to apply:** model the parsing as a list of rules (`prefix`, `kind: weight|price|plu`, `plu_digits`, `value_digits`, `value_divisor`, `check_digit`), each rule fully describing one barcode family, validated so total digit width == 13 and no two enabled rules have overlapping prefixes. Persist as a JSON blob under a single `schema_meta` key (mirrors the existing `hardware_config` pattern in Tauri apps), with a hardcoded `Default` impl as the fallback/seed. The parser takes the config as a parameter (not a global) so it can be swapped/tested and reloaded live in the running POS after an admin edits it.
