import assert from "node:assert/strict";
import test from "node:test";
import { mapCashier, mapProduct, toAuditEntry, toBillPayload } from "./terminal-contract.ts";

test("maps server cashier hashes and catalog numbers", () => {
  const cashier = mapCashier({ id: "c1", name: "Alex", role: "cashier", pinHash: "ABCDEF" });
  assert.equal(cashier.pin_hash, "abcdef");
  assert.ok(cashier.permissions.includes("sell"));

  const product = mapProduct({ id: "p1", name: "Milk", price1: "2.45", vatRate: "5", packSize: "2" });
  assert.equal(product.price1, 2.45);
  assert.equal(product.vat_rate, 5);
  assert.equal(product.pack_size, 2);
});

test("maps browser orders and audit records to the terminal API contract", () => {
  const bill = toBillPayload({
    id: "local-order",
    order_number: "POS-123",
    status: "completed",
    cashier_id: "c1",
    cashier_name: "Alex",
    price_level: 1,
    order_discount_pct: 0,
    order_discount_fixed: 0,
    surcharge_pct: 0,
    surcharge_amount: 0,
    subtotal: 2.45,
    discount_amount: 0,
    vat_amount: 0.12,
    total: 2.45,
    payment_method: "cash",
    amount_tendered: 5,
    change_due: 2.55,
    created_at: "2026-09-11T10:00:00.000Z",
  }, [{
    id: "line-1",
    order_id: "local-order",
    product_id: "p1",
    description: "Milk",
    qty: 1,
    unit_price: 2.45,
    line_discount_pct: 0,
    line_discount_fixed: 0,
    line_surcharge_pct: 0,
    vat_rate: 5,
    line_total: 2.45,
    vat_amount: 0.12,
    voided: false,
  }]);
  assert.equal(bill.orderNumber, "POS-123");
  assert.equal(bill.createdAt, "2026-09-11T10:00:00.000Z");
  assert.equal(bill.lines[0].itemId, "p1");
  assert.equal(bill.lines[0].quantity, 1);

  assert.deepEqual(toAuditEntry({ id: 7, action: "sale", timestamp: "now" }), {
    localId: 7,
    cashierId: null,
    cashierName: null,
    action: "sale",
    entity: null,
    entityId: null,
    detail: null,
    createdAt: "now",
  });
});