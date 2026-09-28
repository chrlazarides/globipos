import { normalizeSourceBarcode } from "./catalog-import-barcodes";

export type ImportItem = { id: string; sku: string };

export function resolveItemImportIdentity(
  suppliedSku: string,
  suppliedBarcode: string,
  upsert: boolean,
  existingBySku: Map<string, ImportItem[]>,
  ownersByBarcode: Map<string, Set<string>>,
  itemsById: Map<string, ImportItem>,
): { sku: string; existing?: ImportItem } {
  const barcode = normalizeSourceBarcode(suppliedBarcode);
  if (!suppliedSku && !barcode) throw new Error("Name and either SKU or barcode are required");

  if (suppliedSku) {
    const matches = upsert ? existingBySku.get(suppliedSku.toLowerCase()) || [] : [];
    if (matches.length > 1) throw new Error(`SKU "${suppliedSku}" matches multiple existing products when compared case-insensitively`);
    return { sku: suppliedSku, existing: matches[0] };
  }

  const owners = ownersByBarcode.get(barcode) || new Set<string>();
  if (owners.size > 1 || [...owners].some(owner => !owner.startsWith("item:"))) {
    throw new Error(`Barcode "${barcode}" belongs to multiple products or a variant; provide a SKU to identify the item`);
  }
  const ownerId = owners.size ? [...owners][0].slice("item:".length) : null;
  const barcodeOwner = ownerId ? itemsById.get(ownerId) : undefined;
  if (ownerId && !barcodeOwner) throw new Error(`Barcode "${barcode}" belongs to an unknown item`);

  // A stable fallback also lets invalid supplier barcodes (which are replaced
  // with internal EANs) match the same imported item on a subsequent upsert.
  const generatedSku = `BARCODE-${barcode}`;
  const matches = existingBySku.get(generatedSku.toLowerCase()) || [];
  if (matches.length > 1) throw new Error(`Generated SKU "${generatedSku}" matches multiple existing products`);
  if (matches[0] && barcodeOwner && matches[0].id !== barcodeOwner.id) {
    throw new Error(`Barcode "${barcode}" and generated SKU belong to different items`);
  }
  const existing = barcodeOwner || matches[0];
  if (existing && !upsert) throw new Error(`Barcode "${barcode}" already identifies an item; enable Update Existing Items to import it`);
  return { sku: existing?.sku || generatedSku, existing };
}