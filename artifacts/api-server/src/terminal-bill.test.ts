import assert from "node:assert/strict";
import test from "node:test";
import { terminalBillMatchesExisting, validateTerminalBill } from "./terminal-bill";

const bill = {
  orderNumber: "POS-T001-1-abc", cashierId: "c1", cashierName: "Alex",
  subtotal: 9, discountAmount: 0, vatAmount: 0.43, total: 9,
  paymentMethod: "cash", amountTendered: 10, changeDue: 1, status: "completed",
  createdAt: "2026-09-10T08:30:00.000Z",
  lines: [{ itemId: "p1", description: "Milk", quantity: 3, unitPrice: 3, discountPercent: 0, vatRate: 5, total: 9 }],
};

test("validates and normalizes terminal bill arithmetic", () => {
  const normalized = validateTerminalBill(bill);
  assert.equal(normalized.total, 9);
  assert.equal(normalized.vatAmount, 0.43);
  assert.equal(normalized.createdAt.toISOString(), "2026-09-10T08:30:00.000Z");
});

test("rejects inconsistent totals and underpayment", () => {
  assert.throws(() => validateTerminalBill({ ...bill, total: 8 }), /totals/);
  assert.throws(() => validateTerminalBill({ ...bill, amountTendered: 1, changeDue: 0 }), /tender/);
  assert.throws(() => validateTerminalBill({ ...bill, paymentMethod: "voucher" }), /unsupported/);
  assert.throws(() => validateTerminalBill({ ...bill, paymentMethod: "card", amountTendered: 9, changeDue: 0 }), /card/);
});

test("accepts only exact duplicate payloads as idempotent", () => {
  const normalized = validateTerminalBill(bill);
  assert.equal(terminalBillMatchesExisting({ ...normalized, lines: normalized.lines }, normalized), true);
  assert.equal(terminalBillMatchesExisting({ ...normalized, total: 8, lines: normalized.lines }, normalized), false);
  assert.equal(terminalBillMatchesExisting({ ...normalized, notes: "changed", lines: normalized.lines }, normalized), false);
});

test("rounds VAT per line to match the offline Terminal", () => {
  const multiLine = {
    ...bill,
    subtotal: 1.98,
    total: 1.98,
    vatAmount: 0.1,
    amountTendered: 2,
    changeDue: 0.02,
    lines: [
      { itemId: "p1", description: "A", quantity: 1, unitPrice: 0.99, discountPercent: 0, vatRate: 5, total: 0.99 },
      { itemId: "p2", description: "B", quantity: 1, unitPrice: 0.99, discountPercent: 0, vatRate: 5, total: 0.99 },
    ],
  };
  assert.equal(validateTerminalBill(multiLine).vatAmount, 0.1);
});