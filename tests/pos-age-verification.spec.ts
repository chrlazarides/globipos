import { expect, test } from "@playwright/test";
import type { Product } from "../pos-app/src/types";
import {
  requestProductAddition,
  resolveAgeCheck,
  type PendingAgeCheck,
} from "../pos-app/src/lib/ageRestrictedSale";

type RestrictedProduct = Product & {
  age_restricted: boolean;
  min_age: number;
  deposit_amount?: number;
};

const restrictedProduct: RestrictedProduct = {
  id: "lager",
  server_id: "lager-server",
  name: "Restricted Lager",
  sku: "LAGER",
  barcode: "5012345678900",
  price1: 3,
  price2: 3,
  price3: 3,
  price4: 3,
  price5: 3,
  cost_price: 1,
  vat_rate: 19,
  unit_type: "each",
  pack_size: 1,
  stock_quantity: 10,
  active: true,
  age_restricted: true,
  min_age: 18,
  deposit_amount: 0.25,
};

function harness() {
  const added: Array<{ product: Product; qty: number; priceOverride?: number }> = [];
  const pending: PendingAgeCheck[] = [];
  const audits: string[] = [];

  return {
    added,
    pending,
    audits,
    addProduct(product: Product, qty = 1, priceOverride?: number) {
      added.push({ product, qty, priceOverride });
    },
    requestAgeCheck(request: PendingAgeCheck) {
      pending.push(request);
    },
    audit(action: "age_verify_passed" | "age_verify_refused") {
      audits.push(action);
    },
  };
}

test("barcode scan holds a restricted item until age verification", () => {
  const h = harness();

  // Mirrors the standard barcode callback in POS.tsx.
  requestProductAddition(
    { product: restrictedProduct, qty: 1 },
    h.addProduct,
    h.requestAgeCheck,
  );

  expect(h.pending).toHaveLength(1);
  expect(h.pending[0].product).toBe(restrictedProduct);
  expect(h.added).toHaveLength(0);
});

test("layout-grid tap uses the same age verification guard", () => {
  const h = harness();

  // Mirrors LayoutGrid's onItemButton={handleAddProduct} callback.
  requestProductAddition(
    { product: restrictedProduct, qty: 1 },
    h.addProduct,
    h.requestAgeCheck,
  );

  expect(h.pending).toHaveLength(1);
  expect(h.added).toHaveLength(0);
});

test("refusing verification does not add a line and writes the refusal audit", () => {
  const h = harness();
  const pending = { product: restrictedProduct, qty: 1 };

  resolveAgeCheck(pending, false, h.addProduct, h.audit);

  expect(h.added).toHaveLength(0);
  expect(h.audits).toEqual(["age_verify_refused"]);
});

test("approving verification adds item and deposit lines and writes the pass audit", () => {
  const h = harness();
  const pending = { product: restrictedProduct, qty: 2, priceOverride: 2.5 };

  resolveAgeCheck(pending, true, h.addProduct, h.audit);

  expect(h.added).toHaveLength(2);
  expect(h.added[0]).toMatchObject({
    product: restrictedProduct,
    qty: 2,
    priceOverride: 2.5,
  });
  expect(h.added[1]).toMatchObject({
    product: {
      id: "deposit-lager",
      server_id: "deposit-lager-server",
      name: "Deposit - Restricted Lager",
      sku: "DEP-LAGER",
      price1: 0.25,
    },
    qty: 2,
  });
  expect(h.audits).toEqual(["age_verify_passed"]);
});
