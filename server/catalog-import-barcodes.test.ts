import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { parseScaleBarcode } from "./barcode-utils";
import { storage } from "./storage";
import { itemBarcodes, items, itemVariants } from "../shared/schema";
import {
  CatalogImportBarcodeAllocator,
  computeGtinCheckDigit,
  isValidGtin,
} from "./catalog-import-barcodes";

const withCheckDigit = (data: string) => data + computeGtinCheckDigit(data);

test("validates GTIN-8, UPC-A, EAN-13, and GTIN-14 check digits", () => {
  for (const data of ["1234567", "03600029145", "400638133393", "1001234500001"]) {
    const valid = withCheckDigit(data);
    assert.equal(isValidGtin(valid), true, valid);
    assert.equal(isValidGtin(valid.slice(0, -1) + ((Number(valid.at(-1)) + 1) % 10)), false, valid);
  }
  assert.equal(isValidGtin("ABC123"), false);
});

test("duplicate source barcodes remain mapped to separate products", () => {
  const source = withCheckDigit("400638133393");
  const allocator = new CatalogImportBarcodeAllocator([]);
  const first = allocator.assign(source, "SKU-A", 1);
  const second = allocator.assign(source, "SKU-B", 2);

  assert.equal(first.barcode, source);
  assert.equal(second.issue?.reason, "duplicate");
  assert.notEqual(second.barcode, source);
  assert.notEqual(second.barcode, first.barcode);
});

test("missing and invalid values receive unique valid internal EAN-13 codes that are not scale labels", () => {
  const allocator = new CatalogImportBarcodeAllocator([{ barcode: withCheckDigit("040000000000"), ownerKey: "item:existing" }]);
  const assignments = [
    allocator.assign("", "SKU-A", 1),
    allocator.assign("4006381333932", "SKU-B", 2),
    allocator.assign(null, "SKU-C", 3),
  ];

  assert.equal(new Set(assignments.map((entry) => entry.barcode)).size, assignments.length);
  for (const assignment of assignments) {
    assert.equal(isValidGtin(assignment.barcode), true);
    assert.match(assignment.barcode, /^04/);
    assert.equal(parseScaleBarcode(assignment.barcode), null);
  }
});

test("an item upsert may retain its own barcode but cannot take a variant barcode with the same SKU", () => {
  const ownBarcode = withCheckDigit("400638133393");
  const variantBarcode = withCheckDigit("03600029145");
  const allocator = new CatalogImportBarcodeAllocator([
    { barcode: ownBarcode, ownerKey: "item:item-1" },
    { barcode: variantBarcode, ownerKey: "variant:variant-1" },
  ]);

  assert.equal(allocator.assign(ownBarcode, "SHARED", 1, "item:item-1").barcode, ownBarcode);
  const conflict = allocator.assign(variantBarcode, "SHARED", 2, "item:item-1");
  assert.equal(conflict.issue?.reason, "duplicate");
  assert.notEqual(conflict.barcode, variantBarcode);
});

test("a legacy barcode with multiple owners is always replaced, even for one of those owners", () => {
  const duplicate = withCheckDigit("400638133393");
  const allocator = new CatalogImportBarcodeAllocator([
    { barcode: duplicate, ownerKey: "item:first" },
    { barcode: duplicate, ownerKey: "variant:second" },
  ]);

  const assignment = allocator.assign(duplicate, "FIRST", 1, "item:first");
  assert.equal(assignment.issue?.reason, "duplicate");
  assert.notEqual(assignment.barcode, duplicate);
});

test("blank upserts can retain an existing uniquely-owned valid barcode", () => {
  const existing = withCheckDigit("400638133393");
  const allocator = new CatalogImportBarcodeAllocator([
    { barcode: existing, ownerKey: "item:existing" },
  ]);

  const assignment = allocator.assign(existing, "EXISTING", 1, "item:existing");
  assert.equal(assignment.barcode, existing);
  assert.equal(assignment.issue, undefined);
});

test("a newly created product can retain its barcode on a later upsert row", () => {
  const source = withCheckDigit("400638133393");
  const allocator = new CatalogImportBarcodeAllocator([]);
  const first = allocator.assign(source, "REPEATED", 1, "import-row:1");
  allocator.rebindOwner("import-row:1", "item:created-id");
  const second = allocator.assign(first.barcode, "REPEATED", 2, "item:created-id");

  assert.equal(second.barcode, first.barcode);
  assert.equal(second.issue, undefined);
});

test("valid source GTINs that look like scale labels receive safe internal codes", () => {
  const allocator = new CatalogImportBarcodeAllocator([]);
  const scaleLike = withCheckDigit("210123400100");
  assert.notEqual(parseScaleBarcode(scaleLike), null);

  const assignment = allocator.assign(scaleLike, "SCALE-LIKE", 1, "import-row:1");
  assert.equal(assignment.issue?.reason, "scale_pattern");
  assert.match(assignment.barcode, /^04/);
  assert.equal(parseScaleBarcode(assignment.barcode), null);
});

test("every persisted imported barcode resolves to exactly one product", async () => {
  const [existingItems, existingVariants, existingAliases] = await Promise.all([
    storage.getItems(),
    storage.getAllItemVariantsIncludingInactive(),
    storage.getAllItemBarcodes(),
  ]);
  const allocator = new CatalogImportBarcodeAllocator([
    ...existingItems.map((item) => ({ barcode: item.barcode, ownerKey: `item:${item.id}` })),
    ...existingVariants.map((variant) => ({ barcode: variant.barcode, ownerKey: `variant:${variant.id}` })),
    ...existingAliases.map((alias) => ({ barcode: alias.barcode, ownerKey: `item:${alias.itemId}` })),
  ]);
  const source = withCheckDigit("03600029145");
  const suffix = `${Date.now()}-${process.pid}`;
  const planned = [
    { sku: `IMPORT-A-${suffix}`, ...allocator.assign(source, `IMPORT-A-${suffix}`, 1, "import-row:1") },
    { sku: `IMPORT-B-${suffix}`, ...allocator.assign(source, `IMPORT-B-${suffix}`, 2, "import-row:2") },
    { sku: `IMPORT-C-${suffix}`, ...allocator.assign("invalid", `IMPORT-C-${suffix}`, 3, "import-row:3") },
    { sku: `IMPORT-D-${suffix}`, ...allocator.assign("", `IMPORT-D-${suffix}`, 4, "import-row:4") },
  ];
  const createdIds: string[] = [];

  try {
    for (const plannedItem of planned) {
      const created = await storage.createItem({
        name: plannedItem.sku,
        sku: plannedItem.sku,
        barcode: plannedItem.barcode,
      });
      createdIds.push(created.id);
    }

    for (const plannedItem of planned) {
      const resolved = await storage.getItemByAnyBarcode(plannedItem.barcode);
      assert.equal(resolved?.sku, plannedItem.sku);

      const [primaryOwners, variantOwners, aliasOwners] = await Promise.all([
        db.select().from(items).where(eq(items.barcode, plannedItem.barcode)),
        db.select().from(itemVariants).where(eq(itemVariants.barcode, plannedItem.barcode)),
        db.select().from(itemBarcodes).where(eq(itemBarcodes.barcode, plannedItem.barcode)),
      ]);
      assert.equal(primaryOwners.length + variantOwners.length + aliasOwners.length, 1);
    }
  } finally {
    for (const id of createdIds) await db.delete(items).where(eq(items.id, id));
  }
});