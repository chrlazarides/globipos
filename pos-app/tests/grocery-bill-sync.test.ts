import assert from "node:assert/strict";
import { test } from "node:test";
import { validateTerminalBill, terminalBillMatchesExisting } from "../../artifacts/api-server/src/terminal-bill";
import { computeLineAmounts, computeOrderTotals, createDepartmentLine } from "../src/lib/pricing";
import { departmentButtonAction } from "../src/lib/departmentEntry";
import type { OrderLine } from "../src/types";

function payload(lines: OrderLine[], pct = 0, fixed = 0, surcharge = 0) {
  const totals = computeOrderTotals(lines, pct, fixed, surcharge);
  return {
    pricingMode: "native-net-v1", orderNumber: "GROCERY-TEST", status: "completed",
    createdAt: "2026-10-04T12:00:00Z", paymentMethod: "cash",
    amountTendered: totals.total, changeDue: 0,
    subtotal: totals.subtotal, total: totals.total, discountAmount: totals.discountAmount,
    vatAmount: totals.vatAmount, orderDiscountPercent: pct, orderDiscountFixed: fixed,
    surchargePercent: surcharge,
    lines: lines.map(line => ({
      itemId: line.product_id, categoryId: line.category_id, description: line.description,
      quantity: line.qty, unitPrice: line.override_price ?? line.unit_price,
      priceIncludesVat: line.price_includes_vat ?? false, discountPercent: line.line_discount_pct,
      discountFixed: line.line_discount_fixed, surchargePercent: line.line_surcharge_pct,
      vatRate: line.vat_rate, total: line.line_total, vatAmount: line.vat_amount, voided: line.voided,
    })),
  };
}
const category = { id: "fruit", server_id: "fruit", name: "Fruits", active: true, vat_rate: 5 };
const dept = createDepartmentLine(category, 2.30, "test", "dept");
function sku(overrides: Partial<OrderLine> = {}): OrderLine {
  const partial = { ...dept, id: "sku", product_id: "banana", price_includes_vat: false,
    unit_price: 2.99, qty: .750, ...overrides };
  const computed = computeLineAmounts(partial);
  return { ...partial, line_total: computed.lineTotal, vat_amount: computed.vatAmount };
}

test("department and weighed-item bills reconcile with the real upload validator", () => {
  for (const lines of [[dept], [sku()], [dept, sku()]]) {
    const input = payload(lines);
    const normalized = validateTerminalBill(input);
    assert.equal(normalized.total, input.total);
    assert.equal(normalized.vatAmount, input.vatAmount);
    assert.equal(normalized.lines.length, lines.length);
    assert.equal(terminalBillMatchesExisting(normalized, normalized), true);
  }
});

test("280 then category is a named, non-stock €2.80 sale with VAT included", () => {
  for (const vat_rate of [0, 5, 9, 19]) {
    const selected = { ...category, name: "Bakery", vat_rate };
    const action = departmentButtonAction(selected.server_id, "280", [selected]);
    assert.equal(action.type, "sale");
    if (action.type !== "sale") throw new Error("Expected a department sale");
    const line = createDepartmentLine(action.category, action.amount, "test", "cash-register");
    assert.equal(line.description, "Bakery");
    assert.equal(line.category_id, selected.server_id);
    assert.equal(line.product_id, undefined, "a department sale has no stock item");
    assert.equal(line.qty, 1);
    assert.equal(line.line_total, 2.80);
    assert.equal(line.price_includes_vat, true);
    assert.equal(line.vat_rate, vat_rate);
    const bill = validateTerminalBill(payload([line]));
    assert.equal(bill.total, 2.80);
    assert.equal(bill.lines[0].itemId, null, "inventory receives no item to decrement");
    assert.equal(bill.lines[0].description, "Bakery");
    assert.equal(bill.vatAmount, line.vat_amount);
  }
});

test("native discounts, override prices, voids and surcharges preserve charged totals", () => {
  const modified = sku({ override_price: 3.49, line_discount_pct: 10,
    line_discount_fixed: .10, line_surcharge_pct: 5 });
  for (const pct of [0, 10, 100]) for (const fixed of [0, .25]) for (const surcharge of [0, 10]) {
    const input = payload([dept, modified, { ...sku(), voided: true }], pct, fixed, surcharge);
    const normalized = validateTerminalBill(input);
    assert.equal(normalized.total, input.total);
    assert.equal(normalized.vatAmount, input.vatAmount);
  }
});

test("penny VAT rounding survives synchronization without increasing department sales", () => {
  for (const rate of [0, 5, 9, 19, 100]) for (let cents = 1; cents <= 100; cents++) {
    const line = createDepartmentLine({ ...category, vat_rate: rate }, cents / 100, "test", "dept");
    assert.equal(validateTerminalBill(payload([line])).total, cents / 100);
  }
});

test("tampered native amounts and unknown contract versions fail explicitly", () => {
  const input = payload([dept, sku()]);
  for (const field of ["total", "subtotal", "vatAmount", "discountAmount"] as const) {
    assert.throws(() => validateTerminalBill({ ...input, [field]: input[field] + 1 }));
  }
  assert.throws(() => validateTerminalBill({ ...input, pricingMode: "native-net-future" }));
  assert.throws(() => validateTerminalBill({ ...input, lines: [{ ...input.lines[0], total: 100 }] }));
});