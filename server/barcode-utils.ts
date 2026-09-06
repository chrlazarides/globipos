// Deterministic EAN-13-compatible barcode synthesis for textile-style color/size(/quality) variant matrices.
// Layout (12 data digits + 1 check digit = 13 total, scannable as EAN-13/Code128/Code39/QR):
//   [prefix:2]="29" (internal-use range) + [itemSeq:4] + [colorIndex:2] + [sizeIndex:2] + [qualityIndex:1] + [seasonDigit:1]
function computeEAN13CheckDigit(data12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(data12[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

export type ScaleBarcodeType = "weight" | "price" | "plu";

export interface BarcodeRule {
  id: string;
  prefix: string;
  kind: ScaleBarcodeType;
  plu_digits: number;
  value_digits: number;
  value_divisor: number;
  check_digit: boolean;
  enabled: boolean;
}

export interface BarcodeConfig {
  enabled: boolean;
  rules: BarcodeRule[];
}

export interface ScaleBarcode {
  type: ScaleBarcodeType;
  plu: string;
  rawValue: number;
  value: number;
  ruleId: string;
}

export const DEFAULT_BARCODE_CONFIG: BarcodeConfig = {
  enabled: true,
  rules: [
    { id: "price-20", prefix: "20", kind: "price", plu_digits: 5, value_digits: 5, value_divisor: 100, check_digit: true, enabled: true },
    { id: "weight-21-24", prefix: "21", kind: "weight", plu_digits: 5, value_digits: 5, value_divisor: 1000, check_digit: true, enabled: true },
    { id: "price-25-27", prefix: "25", kind: "price", plu_digits: 5, value_digits: 5, value_divisor: 100, check_digit: true, enabled: true },
    { id: "weight-28", prefix: "28", kind: "weight", plu_digits: 5, value_digits: 5, value_divisor: 1000, check_digit: true, enabled: true },
    { id: "weight-29", prefix: "29", kind: "weight", plu_digits: 5, value_digits: 5, value_divisor: 1000, check_digit: true, enabled: true },
  ],
};

export function parseScaleBarcode(code: string, config: BarcodeConfig = DEFAULT_BARCODE_CONFIG): ScaleBarcode | null {
  if (!config.enabled || !/^\d{13}$/.test(code)) return null;
  const rule = config.rules
    .filter((candidate) => candidate.enabled && code.startsWith(candidate.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!rule) return null;
  const expectedLength = rule.prefix.length + rule.plu_digits + rule.value_digits + (rule.check_digit ? 1 : 0);
  if (expectedLength !== 13) return null;
  if (rule.check_digit && computeEAN13CheckDigit(code.slice(0, 12)) !== code[12]) return null;
  const pluStart = rule.prefix.length;
  const pluEnd = pluStart + rule.plu_digits;
  const valueEnd = pluEnd + rule.value_digits;
  const rawValue = Number.parseInt(code.slice(pluEnd, valueEnd), 10);
  return {
    type: rule.kind,
    plu: code.slice(pluStart, pluEnd),
    rawValue,
    value: rule.kind === "plu" ? 0 : rawValue / Math.max(rule.value_divisor, 1),
    ruleId: rule.id,
  };
}

/** Exact variant matches take precedence because synthesized variants may share scale prefixes. */
export function parseScaleBarcodeAfterVariantLookup(
  code: string,
  exactVariantFound: boolean,
  config: BarcodeConfig = DEFAULT_BARCODE_CONFIG,
): ScaleBarcode | null {
  return exactVariantFound ? null : parseScaleBarcode(code, config);
}

export function applyScaleBarcodeSaleValues(
  scale: ScaleBarcode | null,
  requestedQuantity: number,
  normalUnitPrice: number,
): { quantity: number; unitPrice: number } {
  if (scale?.type === "weight" && scale.value > 0) {
    return { quantity: Number(scale.value.toFixed(3)), unitPrice: normalUnitPrice };
  }
  if (scale?.type === "price" && scale.value > 0) {
    return { quantity: 1, unitPrice: Number(scale.value.toFixed(2)) };
  }
  return { quantity: requestedQuantity, unitPrice: normalUnitPrice };
}

/** Price labels need an exact server-side registration; an EAN checksum is not authorization. */
export function isEmbeddedPriceLabelAuthorized(
  scale: ScaleBarcode | null,
  resolvedItemId: string,
  exactRegisteredItemId?: string,
): boolean {
  return scale?.type !== "price" || exactRegisteredItemId === resolvedItemId;
}

/** Resolve exact code, then PLU only after an explicit no-match from the same operation. */
export async function resolveScaleBarcodeExactFirst<T>(
  code: string,
  lookup: (candidate: string) => Promise<T | undefined>,
): Promise<T | undefined> {
  const exact = await lookup(code);
  if (exact) return exact;
  const scale = parseScaleBarcode(code);
  return scale ? lookup(scale.plu) : undefined;
}

function seasonToDigit(season: string | null | undefined): string {
  if (!season) return "0";
  let hash = 0;
  for (let i = 0; i < season.length; i++) {
    hash = (hash * 31 + season.charCodeAt(i)) % 10;
  }
  return String(hash);
}

// Legacy CPLPOS-style "Item Code Synthesizing" for the Inventory-In with Col/Size
// screen. B.1 = descriptive Code-39 codes built from Department/Style/Color/Size;
// B.2 = short sequential EAN-8 codes for when the descriptive parts don't fit;
// QR = a self-describing QR payload derived from the same product attributes.
function alnumCode(value: string, len: number): string {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (cleaned.slice(0, len) || "X").padEnd(len, "X");
}

export function synthesizeDescriptiveCode(params: {
  categoryName: string;
  style: string;
  colorName: string;
  sizeName: string;
}): string {
  const categoryPart = alnumCode(params.categoryName, 3);
  const stylePart = alnumCode(params.style, 6);
  const colorPart = alnumCode(params.colorName, 3);
  const sizePart = alnumCode(params.sizeName, 4);
  return `${categoryPart}${stylePart}${colorPart}${sizePart}`.slice(0, 16);
}

function computeEAN8CheckDigit(data7: string): string {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const digit = parseInt(data7[i], 10);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

export function synthesizeSequentialCode(nextSeq: number): string {
  const data7 = String(nextSeq % 10000000).padStart(7, "0");
  return data7 + computeEAN8CheckDigit(data7);
}

export function synthesizeQrCode(params: {
  categoryName: string;
  style: string;
  colorName: string;
  sizeName: string;
  salt?: number;
}): string {
  const base = synthesizeDescriptiveCode(params);
  return `QR:${base}${params.salt ? `-${params.salt}` : ""}`;
}

export function generateVariantBarcode(params: {
  itemSequenceNo: number;
  colorIndex: number;
  sizeIndex: number;
  qualityIndex?: number;
  season?: string | null;
  salt?: number;
}): string {
  const itemPart = String((params.itemSequenceNo + (params.salt || 0) * 10000) % 10000).padStart(4, "0");
  const colorPart = String(params.colorIndex % 100).padStart(2, "0");
  const sizePart = String(params.sizeIndex % 100).padStart(2, "0");
  const qualityPart = String((params.qualityIndex ?? 0) % 10);
  const seasonPart = seasonToDigit(params.season);
  const data12 = `29${itemPart}${colorPart}${sizePart}${qualityPart}${seasonPart}`;
  const check = computeEAN13CheckDigit(data12);
  return data12 + check;
}
