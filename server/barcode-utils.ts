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
// B.2 = short sequential EAN-8 codes for when the descriptive parts don't fit.
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
