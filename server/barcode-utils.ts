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
