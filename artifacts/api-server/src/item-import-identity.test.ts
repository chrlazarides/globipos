import assert from "node:assert/strict";
import test from "node:test";
import { resolveItemImportIdentity } from "./item-import-identity";

const item = { id: "one", sku: "ORIGINAL-SKU" };
const bySku = new Map([[item.sku.toLowerCase(), [item]]]);
const byId = new Map([[item.id, item]]);

test("a barcode-only row matches its existing item and preserves its SKU", () => {
  const owners = new Map([["008421374113", new Set(["item:one"])]]);
  assert.deepEqual(
    resolveItemImportIdentity("", "008421374113", true, bySku, owners, byId),
    { sku: "ORIGINAL-SKU", existing: item },
  );
  assert.throws(
    () => resolveItemImportIdentity("", "008421374113", false, bySku, owners, byId),
    /enable Update Existing Items/,
  );
});

test("a new barcode-only item gets a stable SKU and can be upserted later", () => {
  const owners = new Map<string, Set<string>>();
  const first = resolveItemImportIdentity("", "008421374113", true, bySku, owners, byId);
  assert.deepEqual(first, { sku: "BARCODE-008421374113", existing: undefined });
  const imported = { id: "two", sku: first.sku };
  assert.deepEqual(
    resolveItemImportIdentity("", "008421374113", true,
      new Map([...bySku, [imported.sku.toLowerCase(), [imported]]]),
      owners, new Map([...byId, [imported.id, imported]])),
    { sku: imported.sku, existing: imported },
  );
});

test("barcode-only rows with missing or ambiguous identities are rejected", () => {
  assert.throws(() => resolveItemImportIdentity("", "", true, bySku, new Map(), byId), /either SKU or barcode/);
  assert.throws(() => resolveItemImportIdentity("", "123", true, bySku,
    new Map([["123", new Set(["variant:v1"])]]), byId), /variant/);
  assert.throws(() => resolveItemImportIdentity("", "123", true, bySku,
    new Map([["123", new Set(["item:one", "item:two"])]]), byId), /multiple products/);
});

test("a provided SKU continues to match by SKU", () => {
  assert.deepEqual(resolveItemImportIdentity("ORIGINAL-SKU", "", true, bySku, new Map(), byId),
    { sku: "ORIGINAL-SKU", existing: item });
});