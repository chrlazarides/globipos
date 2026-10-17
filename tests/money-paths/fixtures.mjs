import { app, now } from "./bootstrap.mjs";
export const product = (extra = {}) => ({
  id: "sample-item", server_id: "sample-item", name: "Sample Halloumi", sku: "TEST-001",
  barcode: "5290000000015", category_id: "dairy", vat_rate: 5,
  price1: 3.2, price2: 2.9, price3: 3, price4: 2.8, price5: 2.7,
  active: true, stock_quantity: 10, ...extra,
});
export function line(extra = {}) {
  const input = {
    id: "line-1", order_id: "sample-order", product_id: "sample-item", category_id: "dairy",
    description: "Sample Halloumi", qty: 1, unit_price: 3.2, price_includes_vat: true,
    line_discount_pct: 0, line_discount_fixed: 0, line_surcharge_pct: 0,
    vat_rate: 5, voided: false, ...extra,
  };
  const values = app.pricing.computeLineAmounts(input);
  return { ...input, line_total: values.lineTotal, vat_amount: values.vatAmount };
}
export const golden = () => [
  line({ id: "halloumi", qty: 2 }),
  line({ id: "bread", unit_price: 1.85 }),
  line({ id: "tomatoes", qty: 1.24, unit_price: 2.49 }),
  line({ id: "milk", qty: 2, unit_price: 1.42, line_discount_pct: 10 }),
  line({ id: "water", unit_price: 2.99, vat_rate: 19 }),
  line({ id: "feta", unit_price: 5.6 }),
];
export const tender = (method, amount, extra = {}) => ({
  id: `test-${method}`, method, amount, label: method, ...extra,
});
export const policy = {
  loyaltyEnabled: true, cashbackEnabled: true, pointsPerEuro: 1,
  redeemPointsPerEuro: 100, minimumRedemptionPoints: 100,
  silverThreshold: 500, goldThreshold: 1000,
  bronzeCashbackPercent: 1, silverCashbackPercent: 2, goldCashbackPercent: 3,
  maxCashbackOrderPercent: 20,
};
export const item = {
  id: "sample-item", name: "Sample Halloumi", categoryId: "dairy", brand: "TEST",
  price1: "3.20", price2: "2.90", price3: "3.00", price4: "2.80", price5: "2.70",
  vatRate: "5", packSize: 6, costPrice: "2.10",
};
export const price = (extra = {}) => app.invoice.priceInvoiceLine(
  extra.item ?? item, extra.variant ?? null,
  { quantity: 1, saleUnit: "pc", ...extra.line },
  extra.level ?? 1, extra.contracts ?? [], extra.rules ?? [], extra.fixed ?? [],
  extra.inclusive ?? true,
);
export const promo = (extra = {}) => ({
  id: "sample-deal", name: "Sample deal", type: "mix_match",
  product_ids: [], category_ids: ["dairy"], threshold_qty: 3, get_qty: 1,
  threshold_price: 2, bundle_price: 6, discount_pct: 0, discount_fixed: 0,
  active: true, priority: 1, stackable: false, ...extra,
});
export const bill = (extra = {}) => ({
  orderNumber: "POS-TEST-001", cashierId: "sample-cashier", cashierName: "Sample Cashier",
  subtotal: 9, discountAmount: 0, vatAmount: 0.43, total: 9,
  paymentMethod: "cash", amountTendered: 10, changeDue: 1, status: "completed",
  createdAt: now,
  lines: [{ itemId: "sample-item", description: "Sample Milk", quantity: 3,
    unitPrice: 3, discountPercent: 0, vatRate: 5, total: 9 }],
  ...extra,
});
