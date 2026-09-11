import assert from "node:assert/strict";
import test from "node:test";
import { calculateLine, createOrderLine, createOrderNumber, effectivePrice, parseValidCashTender } from "./pos-calculations.ts";

const product = {
  id: "p1", server_id: "p1", name: "Milk", sku: "MILK", price1: 2, price2: 3,
  price3: 4, price4: 5, price5: 6, cost_price: 1, vat_rate: 5, unit_type: "unit",
  pack_size: 1, stock_quantity: 10, active: true,
};

test("uses the configured terminal price level", () => {
  assert.equal(effectivePrice(product, 1), 2);
  assert.equal(effectivePrice(product, 3), 4);
  assert.equal(effectivePrice(product, 9), 6);
});

test("recomputes total and VAT whenever quantity changes", () => {
  const initial = createOrderLine(product, 2, "line-1");
  const updated = calculateLine(initial, 3);
  assert.equal(updated.unit_price, 3);
  assert.equal(updated.line_total, 9);
  assert.equal(updated.vat_amount, 0.43);
});

test("rejects blank, negative, non-finite, and underpaid cash tenders", () => {
  assert.equal(parseValidCashTender("", 10), null);
  assert.equal(parseValidCashTender("-1", 10), null);
  assert.equal(parseValidCashTender("Infinity", 10), null);
  assert.equal(parseValidCashTender("9.99", 10), null);
  assert.equal(parseValidCashTender("10", 10), 10);
  assert.equal(parseValidCashTender("20", 10), 20);
});

test("creates globally distinct order numbers across terminals", () => {
  const a = createOrderNumber("T001", 1000, "aaaaaaaa-bbbb");
  const b = createOrderNumber("T002", 1000, "aaaaaaaa-bbbb");
  const c = createOrderNumber("T001", 1000, "cccccccc-dddd");
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^POS-T001-1000-/);
});