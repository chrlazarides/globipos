export type ScaleBarcode = {
  type: "weight" | "price" | "plu";
  plu: string;
  value: number;
};

export type BarcodeConfig = {
  enabled: boolean;
  rules: Array<{
    prefix: string;
    kind: ScaleBarcode["type"];
    plu_digits: number;
    value_digits: number;
    value_divisor: number;
    check_digit: boolean;
    enabled: boolean;
  }>;
};

export const DEFAULT_BARCODE_CONFIG: BarcodeConfig = {
  enabled: true,
  rules: [
    { prefix: "20", kind: "price", plu_digits: 5, value_digits: 5, value_divisor: 100, check_digit: true, enabled: true },
    { prefix: "21", kind: "weight", plu_digits: 5, value_digits: 5, value_divisor: 1000, check_digit: true, enabled: true },
    { prefix: "25", kind: "price", plu_digits: 5, value_digits: 5, value_divisor: 100, check_digit: true, enabled: true },
    { prefix: "28", kind: "weight", plu_digits: 5, value_digits: 5, value_divisor: 1000, check_digit: true, enabled: true },
    { prefix: "29", kind: "weight", plu_digits: 5, value_digits: 5, value_divisor: 1000, check_digit: true, enabled: true },
  ],
};

export function parseScaleBarcode(code: string, config: BarcodeConfig = DEFAULT_BARCODE_CONFIG): ScaleBarcode | null {
  if (!config.enabled || !/^\d{13}$/.test(code)) return null;
  const rule = config.rules
    .filter((candidate) => candidate.enabled && code.startsWith(candidate.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!rule) return null;
  if (rule.prefix.length + rule.plu_digits + rule.value_digits + (rule.check_digit ? 1 : 0) !== 13) return null;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  if (rule.check_digit && (10 - (sum % 10)) % 10 !== Number(code[12])) return null;
  const pluStart = rule.prefix.length;
  const pluEnd = pluStart + rule.plu_digits;
  const rawValue = Number(code.slice(pluEnd, pluEnd + rule.value_digits));
  return {
    type: rule.kind,
    plu: code.slice(pluStart, pluEnd),
    value: rule.kind === "plu" ? 0 : rawValue / Math.max(rule.value_divisor, 1),
  };
}