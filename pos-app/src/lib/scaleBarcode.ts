/**
 * Scale / weighted-item barcode parser.
 *
 * Retail scales and manufacturer weight labels print EAN-13 barcodes that embed
 * either a weight or a price directly inside the barcode digits so the POS can
 * ring up a variable-weight item without a live scale connection.
 *
 * ── Format ───────────────────────────────────────────────────────────────────
 *  Digit position:  1     2-N        ...          13
 *                  [prefix][PLU digits][Value digits][Check]
 *
 *  The prefix → meaning mapping (weight vs price vs PLU-only, digit widths,
 *  and the divisor used to convert the raw integer value into a real-world
 *  unit) is fully configurable via `BarcodeConfig` (see `BARCODE_CONFIG.md`
 *  in Settings → Barcode Structure). Different scale vendors and manufacturer
 *  weight labels use different prefix conventions — e.g. some print weight
 *  under a "1-4" flag digit, others (such as Pittas) embed weight under a
 *  "28"/"29" prefix that a hardcoded "5-9 = price" rule would misclassify.
 *
 *  The EAN-13 check digit (position 13) is validated (when the matching rule
 *  requires it) before accepting the code as a scale barcode, to avoid false
 *  positives on normal EAN-13s that happen to start with the same prefix.
 *
 * ── Lookup strategy ──────────────────────────────────────────────────────────
 *  Products may be stored with:
 *    a) just the PLU as their barcode field, OR
 *    b) the full 13-digit scale EAN as their barcode field.
 *  The caller should try the PLU first, then fall back to the full code.
 */

import type { BarcodeConfig, BarcodeRule } from "../types";

export type ScaleBarcodeType = "weight" | "price" | "plu";

export interface ScaleBarcode {
  type: ScaleBarcodeType;
  plu: string;        // PLU string (leading zeros preserved)
  rawValue: number;   // raw integer value segment from the barcode
  /** For weight barcodes: weight in kg (e.g. 1.500).
   *  For price barcodes:  price in currency units (e.g. 12.99).
   *  For PLU barcodes:    0. */
  value: number;
  ruleId: string;     // id of the BarcodeRule that matched
}

/**
 * Default barcode structure — mirrors the backend's `BarcodeConfig::default()`.
 * Used whenever the admin-configured rules haven't loaded yet (or on terminals
 * running fully offline before their first config sync).
 *
 * Note: prefixes "28" and "29" are classified as WEIGHT (not price) by default,
 * matching manufacturer weight-embedded PLU labels (e.g. Pittas) rather than the
 * classic scale "5-9 = price" flag convention.
 */
export const DEFAULT_BARCODE_CONFIG: BarcodeConfig = {
  enabled: true,
  rules: [
    { id: "plu-20", label: "PLU only (20xxx)", prefix: "20", kind: "plu", plu_digits: 5, value_digits: 5, value_divisor: 1, check_digit: true, enabled: true },
    { id: "weight-21-24", label: "Scale weight (21-24xxx)", prefix: "21", kind: "weight", plu_digits: 5, value_digits: 5, value_divisor: 1000, check_digit: true, enabled: true },
    { id: "price-25-27", label: "Scale price (25-27xxx)", prefix: "25", kind: "price", plu_digits: 5, value_digits: 5, value_divisor: 100, check_digit: true, enabled: true },
    { id: "weight-28", label: "Manufacturer weight PLU (28xxx)", prefix: "28", kind: "weight", plu_digits: 5, value_digits: 5, value_divisor: 1000, check_digit: true, enabled: true },
    { id: "weight-29", label: "Manufacturer weight PLU (29xxx)", prefix: "29", kind: "weight", plu_digits: 5, value_digits: 5, value_divisor: 1000, check_digit: true, enabled: true },
  ],
};

/**
 * Validate the EAN-13 check digit.
 * Alternating weights of 1 and 3 applied to digits 1-12, modulo 10.
 */
function validateEan13CheckDigit(code: string): boolean {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(code[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === parseInt(code[12], 10);
}

/** Find the enabled rule whose prefix matches the start of `code`, if any. */
function findMatchingRule(code: string, config: BarcodeConfig): BarcodeRule | null {
  // Prefer the longest matching prefix so more-specific rules win over shorter ones.
  let best: BarcodeRule | null = null;
  for (const rule of config.rules) {
    if (!rule.enabled) continue;
    if (code.startsWith(rule.prefix)) {
      if (!best || rule.prefix.length > best.prefix.length) best = rule;
    }
  }
  return best;
}

/**
 * Try to parse a scanned barcode as an EAN-13 scale/weight barcode using the
 * given (admin-configurable) barcode structure. Falls back to
 * `DEFAULT_BARCODE_CONFIG` when no config is supplied.
 *
 * Returns `null` if the code is not 13 digits, does not match any enabled
 * rule, or fails that rule's check-digit validation.
 */
export function parseScaleBarcode(code: string, config: BarcodeConfig = DEFAULT_BARCODE_CONFIG): ScaleBarcode | null {
  if (!config.enabled) return null;
  if (!/^\d{13}$/.test(code)) return null;

  const rule = findMatchingRule(code, config);
  if (!rule) return null;

  const expectedLen = rule.prefix.length + rule.plu_digits + rule.value_digits + (rule.check_digit ? 1 : 0);
  if (expectedLen !== 13) return null; // misconfigured rule — refuse to guess

  if (rule.check_digit && !validateEan13CheckDigit(code)) return null;

  const pluStart = rule.prefix.length;
  const pluEnd = pluStart + rule.plu_digits;
  const valueEnd = pluEnd + rule.value_digits;

  const plu = code.slice(pluStart, pluEnd);
  const rawValue = parseInt(code.slice(pluEnd, valueEnd), 10);

  const divisor = rule.value_divisor > 0 ? rule.value_divisor : 1;
  const value = rule.kind === "plu" ? 0 : rawValue / divisor;

  return { type: rule.kind, plu, rawValue, value, ruleId: rule.id };
}

/**
 * Human-readable summary of a parsed scale barcode — useful for toasts/logs.
 */
export function describeScaleBarcode(sb: ScaleBarcode): string {
  if (sb.type === "weight") return `PLU ${sb.plu} · ${sb.value.toFixed(3)} kg`;
  if (sb.type === "price")  return `PLU ${sb.plu} · €${sb.value.toFixed(2)}`;
  return `PLU ${sb.plu}`;
}
