/**
 * Scale / weighted-item barcode parser.
 *
 * Retail scales print EAN-13 barcodes that embed either a weight or a price
 * directly inside the barcode digits so the POS can ring up a variable-weight
 * item without a live scale connection.
 *
 * ── Format ───────────────────────────────────────────────────────────────────
 *  Digit position:  1   2  3-7     8-12    13
 *                  [2][flag][PLU:5][Value:5][Check]
 *
 *  flag (digit 2):
 *    0          → PLU-only  — add the product at qty 1, no embedded value
 *    1, 2, 3, 4 → Weight    — Value field = grams  (e.g. 01500 → 1.500 kg)
 *    5, 6, 7, 8, 9 → Price  — Value field = cents  (e.g. 01299 → €12.99)
 *
 *  The EAN-13 check digit (position 13) is always validated before accepting
 *  the code as a scale barcode to avoid false positives on normal EAN-13s
 *  that happen to start with 2 (e.g. some European brand codes).
 *
 * ── Lookup strategy ──────────────────────────────────────────────────────────
 *  Products may be stored with:
 *    a) just the 5-digit PLU as their barcode field, OR
 *    b) the full 13-digit scale EAN as their barcode field.
 *  The caller should try the PLU first, then fall back to the full code.
 */

export type ScaleBarcodeType = "weight" | "price" | "plu";

export interface ScaleBarcode {
  type: ScaleBarcodeType;
  plu: string;        // 5-digit PLU string (leading zeros preserved)
  rawValue: number;   // raw 5-digit integer from the barcode
  /** For weight barcodes: weight in kg (e.g. 1.500).
   *  For price barcodes:  price in currency units (e.g. 12.99).
   *  For PLU barcodes:    0. */
  value: number;
  flagDigit: number;  // the single flag digit (0-9)
}

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

/**
 * Try to parse a scanned barcode as an EAN-13 scale barcode.
 * Returns `null` if the code is not a recognised scale barcode format.
 */
export function parseScaleBarcode(code: string): ScaleBarcode | null {
  // Must be exactly 13 digits and start with '2'
  if (!/^2\d{12}$/.test(code)) return null;

  // Reject if check digit does not match — avoids false-positives on real
  // brand EANs that happen to start with 2
  if (!validateEan13CheckDigit(code)) return null;

  const flagDigit = parseInt(code[1], 10);
  const plu = code.slice(2, 7);
  const rawValue = parseInt(code.slice(7, 12), 10);

  let type: ScaleBarcodeType;
  let value: number;

  if (flagDigit === 0) {
    type = "plu";
    value = 0;
  } else if (flagDigit <= 4) {
    // Weight — value field is in grams
    type = "weight";
    value = rawValue / 1000;
  } else {
    // Price — value field is in minor currency units (cents / pence)
    type = "price";
    value = rawValue / 100;
  }

  return { type, plu, rawValue, value, flagDigit };
}

/**
 * Human-readable summary of a parsed scale barcode — useful for toasts/logs.
 */
export function describeScaleBarcode(sb: ScaleBarcode): string {
  if (sb.type === "weight") return `PLU ${sb.plu} · ${sb.value.toFixed(3)} kg`;
  if (sb.type === "price")  return `PLU ${sb.plu} · €${sb.value.toFixed(2)}`;
  return `PLU ${sb.plu}`;
}
