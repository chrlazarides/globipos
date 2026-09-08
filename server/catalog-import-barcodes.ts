import { parseScaleBarcode } from "./barcode-utils";

export type BarcodeIssueReason = "missing" | "invalid" | "duplicate" | "scale_pattern";

export interface BarcodeIssue {
  row: number;
  sku: string;
  sourceBarcode: string | null;
  assignedBarcode: string;
  reason: BarcodeIssueReason;
  message: string;
}

export interface ExistingBarcodeOwner {
  barcode: string | null;
  ownerKey: string;
}

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);
export const INTERNAL_EAN13_PREFIX = "04";

export function computeGtinCheckDigit(data: string): string {
  let sum = 0;
  let weight = 3;
  for (let i = data.length - 1; i >= 0; i--) {
    sum += Number(data[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidGtin(value: string): boolean {
  return /^\d+$/.test(value)
    && GTIN_LENGTHS.has(value.length)
    && computeGtinCheckDigit(value.slice(0, -1)) === value.at(-1);
}

export function normalizeSourceBarcode(value: unknown): string {
  if (value === null || value === undefined) return "";
  const normalized = String(value).trim().replace(/\s+/g, "");
  return /^null$/i.test(normalized) ? "" : normalized;
}

export class CatalogImportBarcodeAllocator {
  private readonly ownersByBarcode = new Map<string, Set<string>>();
  private nextInternalSequence = 0;

  constructor(existing: ExistingBarcodeOwner[]) {
    for (const entry of existing) {
      const barcode = normalizeSourceBarcode(entry.barcode);
      if (barcode) {
        const owners = this.ownersByBarcode.get(barcode) || new Set<string>();
        owners.add(entry.ownerKey);
        this.ownersByBarcode.set(barcode, owners);
      }
    }
  }

  assign(sourceValue: unknown, skuValue: string, row: number, ownerKey = `import:${skuValue.toLowerCase()}`): { barcode: string; issue?: BarcodeIssue } {
    const sourceBarcode = normalizeSourceBarcode(sourceValue);
    const sku = skuValue.trim();
    const owners = sourceBarcode ? this.ownersByBarcode.get(sourceBarcode) : undefined;
    const sameProduct = !!owners && owners.size === 1 && owners.has(ownerKey);

    const matchesScalePattern = !!sourceBarcode && parseScaleBarcode(sourceBarcode) !== null;
    if (sourceBarcode && isValidGtin(sourceBarcode) && !matchesScalePattern && (!owners || sameProduct)) {
      this.ownersByBarcode.set(sourceBarcode, new Set([ownerKey]));
      return { barcode: sourceBarcode };
    }

    const reason: BarcodeIssueReason = !sourceBarcode
      ? "missing"
      : !isValidGtin(sourceBarcode)
        ? "invalid"
        : matchesScalePattern
          ? "scale_pattern"
          : "duplicate";
    const assignedBarcode = this.generateInternalBarcode(ownerKey);
    const detail = reason === "duplicate"
      ? `Source barcode ${sourceBarcode} is already assigned to ${Array.from(owners || []).join(", ")}; generated a separate internal barcode`
      : reason === "scale_pattern"
        ? `Source barcode ${sourceBarcode} matches a configured scale/weight barcode pattern`
      : reason === "invalid"
        ? `Source barcode ${sourceBarcode} is not a valid GTIN-8, UPC-A, EAN-13, or GTIN-14`
        : "Source barcode is missing";

    return {
      barcode: assignedBarcode,
      issue: {
        row,
        sku,
        sourceBarcode: sourceBarcode || null,
        assignedBarcode,
        reason,
        message: `${detail}; assigned ${assignedBarcode}`,
      },
    };
  }

  rebindOwner(previousOwnerKey: string, nextOwnerKey: string): void {
    if (previousOwnerKey === nextOwnerKey) return;
    for (const owners of this.ownersByBarcode.values()) {
      if (owners.delete(previousOwnerKey)) owners.add(nextOwnerKey);
    }
  }

  private generateInternalBarcode(ownerKey: string): string {
    while (this.nextInternalSequence <= 9_999_999_999) {
      const data12 = `${INTERNAL_EAN13_PREFIX}${String(this.nextInternalSequence++).padStart(10, "0")}`;
      const candidate = data12 + computeGtinCheckDigit(data12);
      if (!this.ownersByBarcode.has(candidate)) {
        this.ownersByBarcode.set(candidate, new Set([ownerKey]));
        return candidate;
      }
    }
    throw new Error("Internal EAN-13 restricted-circulation range is exhausted");
  }
}