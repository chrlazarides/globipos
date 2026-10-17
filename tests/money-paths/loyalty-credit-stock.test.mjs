import assert from "node:assert/strict";
import test from "node:test";
import { app, now, known } from "./bootstrap.mjs";
import { policy, bill, price } from "./fixtures.mjs";
import { stockPool } from "./stock-pool.mjs";

test("[loyalty] earn whole-euro points only; cancelled order cannot transition to completed", () => {
  assert.equal(app.loyalty.calculateCompletedRewards(22.49, 340, policy).points, 22);
  assert.throws(() => app.loyalty.assertPortalOrderTransition("cancelled", "completed"), /INVALID/);
  assert.throws(() => app.loyalty.assertPortalOrderTransition("completed", "confirmed"), /INVALID/);
});
test("[loyalty] redeem 200 of 340 points for €2; overdraw and invalid amounts refused", () => {
  assert.equal(app.loyalty.validateRedemption(200, 340, policy), 2);
  for (const n of [0, -100, 200.5, 350, 400]) {
    assert.throws(() => app.loyalty.validateRedemption(n, 340, policy));
  }
  assert.throws(() => app.loyalty.validateRedemption(200, 140, policy), /INSUFFICIENT_POINTS/);
});
test("[loyalty] cashback reservation never exceeds available, sale or policy cap", () => {
  assert.equal(app.loyalty.calculateCashbackReservation(1, 10, true, policy), 1);
  assert.equal(app.loyalty.calculateCashbackReservation(99, 10, true, policy), 2);
  assert.equal(app.loyalty.calculateCashbackReservation(-1, 10, true, policy), 0);
  assert.equal(app.loyalty.calculateCashbackReservation(99, 10, false, policy), 0);
});
test("[loyalty] full refund restores applied cashback and reverses earned rewards exactly", () => {
  assert.equal(app.loyalty.calculateRefundCashbackBalance(8, 2, 1), 7);
});
known("[loyalty] refunded spent rewards cannot leave a negative cashback balance",
  "Policy conflict: existing refund-liability policy deliberately permits -€2 when earned rewards were spent; requested blanket non-negative rule needs Chris's decision", () => {
    const balance = app.loyalty.calculateRefundCashbackBalance(0, 2, 0);
    assert.ok(balance >= 0, `Refunded cashback balance was ${balance}`);
  });
test("[credit] pending/suspended refused; exact available limit allowed, excess refused", () => {
  for (const approvalStatus of ["pending", "suspended"]) {
    assert.throws(() => app.invoice.requireAvailableCredit({ approvalStatus, availableCents: 38000 }, 2249), /approved|suspended/);
  }
  app.invoice.requireAvailableCredit({ approvalStatus: "approved", availableCents: 1500 }, 1500);
  assert.throws(() => app.invoice.requireAvailableCredit({ approvalStatus: "approved", availableCents: 1500 }, 1501), /exceeds/);
});
test("[credit] statements exclude drafts/voids and apply credit notes and payments once", () => {
  const docs = [
    { id: "invoice", type: "invoice", status: "sent", total: "100", dueDate: "2026-10-01" },
    { id: "credit", type: "credit_note", status: "issued", total: "10" },
    { id: "draft", type: "invoice", status: "draft", total: "900" },
    { id: "void", type: "invoice", status: "voided", total: "900" },
  ];
  assert.deepEqual(app.invoice.creditBalance({ openingBalance: "120" }, docs,
    [{ invoiceId: "invoice", amount: "20" }], "2026-10-12"),
  // The €10 credit covers opening debt first: opening 110 + invoice 80.
  // Opening debt has no due date here; only the invoice's €80 is overdue.
  { balanceCents: 19000, overdueCents: 8000, hasOverdue: true });
});
test("[credit] terms and Cyprus date boundary deterministic in summer and winter", () => {
  assert.equal(app.invoice.dueDate("2026-12-15", "credit_30"), "2027-01-14");
  assert.equal(app.invoice.localDate(new Date("2026-06-01T21:00:00Z")), "2026-06-02");
  assert.equal(app.invoice.localDate(new Date("2026-12-01T22:00:00Z")), "2026-12-02");
  assert.equal(new Date().toISOString(), now);
});
test("[stock] packs convert to base pieces; variant price and quantity are preserved", () => {
  const pack = price({ line: { quantity: 2, saleUnit: "pack" } });
  assert.equal(pack.stockQuantity, 12);
  const variant = price({ variant: { id: "blue", price1: "4", option1Value: "Blue" } });
  assert.equal(variant.variantId, "blue");
  assert.equal(variant.totalCents + variant.vatCents, 400);
  assert.equal(app.stock.calculateAvailableStock(10, 3), 7);
  assert.equal(app.stock.calculateAvailableStock(1, 3), 0);
});
const input = {
  itemId: "sample-item", variantId: null, locationId: "sample-location",
  terminalId: "sample-terminal", cashierId: "sample-cashier",
  idempotencyKey: "test-receiving-001", quantity: 4,
};
test("[stock] actual receiving service posts once, retries return same result, altered key reuse refused", async () => {
  const pool = stockPool();
  const first = await app.stock.receivePosStock(input, pool);
  const retry = await app.stock.receivePosStock(input, pool);
  assert.deepEqual(retry, first);
  assert.equal(pool.state.global, 14);
  assert.equal(pool.state.location, 14);
  assert.equal(pool.state.audits.size, 1);
  await assert.rejects(app.stock.receivePosStock({ ...input, quantity: 5 }, pool), /idempotency|different/i);
  assert.equal(pool.state.global, 14);
});
test("[stock] audit failure rolls back both global and location receiving", async () => {
  const pool = stockPool({ failAudit: true });
  await assert.rejects(app.stock.receivePosStock(input, pool), /fixture audit failure/);
  assert.equal(pool.state.global, 10);
  assert.equal(pool.state.location, 10);
  assert.equal(pool.state.audits.size, 0);
});
test("[stock] invalid receiving quantities rejected before connection", async () => {
  for (const quantity of [0, -1, 1.24, Infinity]) {
    await assert.rejects(app.stock.receivePosStock({ ...input, quantity }, {
      connect() { assert.fail("Invalid quantity reached persistence"); },
    }), /whole number/);
  }
});
test("[isolation] network and default database connections are forbidden", async () => {
  assert.throws(() => fetch("https://money.invalid"), /Network forbidden/);
  await assert.rejects(app.stock.receivePosStock(input), /Real database forbidden/);
});
test("[sync] canonical server bill rejects replay with changed money, line, customer or tender", () => {
  const saved = app.bills.validateTerminalBill(bill());
  assert.equal(app.bills.terminalBillMatchesExisting(saved, saved), true);
  for (const mutation of [
    { total: 8 }, { customerId: "other" }, { amountTendered: 11 },
    { lines: [{ ...saved.lines[0], quantity: 4 }] },
  ]) assert.equal(app.bills.terminalBillMatchesExisting({ ...saved, ...mutation }, saved), false);
  assert.throws(() => app.bills.validateTerminalBill(bill({ amountTendered: 8 })), /tender/);
  assert.throws(() => app.bills.validateTerminalBill(bill({ total: 8 })), /total/);
});
