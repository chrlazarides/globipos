import assert from "node:assert/strict";
import test from "node:test";
import { app, known } from "./bootstrap.mjs";
import { product, line, price, item, promo, tender } from "./fixtures.mjs";

for (const [level, expected] of [[1, 3.2], [2, 2.9], [3, 3], [4, 2.8], [5, 2.7]]) {
  test(`[pricing] stored level ${level} selected in native and PWA`, () => {
    assert.equal(app.pricing.getPriceForLevel(product(), level), expected);
    const pwa = app.terminal.createOrderLine(product(), level, "sample");
    assert.equal(pwa.line_total, expected);
  });
}
test("[pricing] native empty level falls back to Retail", () => {
  assert.equal(app.pricing.getPriceForLevel(product({ price2: 0 }), 2), 3.2);
});
test("[pricing] fixed contract wins; unrelated contract cannot leak into customer price", () => {
  const args = { contracts: [{ id: "allowed" }], fixed: [
    { contractId: "other", itemId: item.id, specialPrice: "0.01" },
    { contractId: "allowed", itemId: item.id, specialPrice: "2.50" },
  ] };
  const result = price(args);
  assert.equal(result.totalCents + result.vatCents, 250);
  assert.equal(price({ ...args, inclusive: false }).totalCents, 250);
});
test("[pricing] contract discount keeps cheaper existing level and respects category/minimum qty", () => {
  const contract = { id: "contract", categoryId: "dairy", discountType: "percentage", discountValue: 20, minQuantity: 2 };
  assert.equal(price({ level: 2, contracts: [contract] }).totalCents + price({ level: 2, contracts: [contract] }).vatCents, 290);
  const two = price({ level: 2, line: { quantity: 2 }, contracts: [contract] });
  assert.equal(two.totalCents + two.vatCents, 512);
  const wrongCategory = price({ contracts: [{ ...contract, categoryId: "other", minQuantity: 0 }] });
  assert.equal(wrongCategory.totalCents + wrongCategory.vatCents, 320);
});
test("[pricing] net basis keeps €3.21 × 100 = €321.00 + €16.05", () => {
  const result = price({ item: { ...item, price2: "3.21" }, level: 2, inclusive: false, line: { quantity: 100 } });
  assert.equal(result.totalCents, 32100);
  assert.equal(result.vatCents, 1605);
});
test("[vat] accepted net-level receipt rounding differs by five cents at quantity 100", () => {
  const invoice = price({ item: { ...item, price2: "3.21" }, level: 2, inclusive: false, line: { quantity: 100 } });
  const receipt = app.terminal.calculateLine(app.terminal.createOrderLine(product({ price1: 3.37 }), 1, "sample"), 100);
  assert.equal(invoice.totalCents + invoice.vatCents, 33705);
  assert.equal(receipt.line_total, 337);
});
test("[pricing] exact bundle set and cheapest-free rule", () => {
  const basket = [line({ qty: 2 }), line({ id: "bread", unit_price: 1.85 })];
  assert.equal(app.evalMixMatch(promo(), basket).discount_amount, 2.25);
  assert.equal(app.evalMealDeal(promo(), basket).discount_amount, 2.25);
  assert.equal(app.evalBuyNGetM(promo({ type: "buy_n_get_m", threshold_qty: 2 }), basket).discount_amount, 1.85);
  assert.equal(app.evalMixMatch(promo({ bundle_price: 99 }), basket), null);
});
test("[pricing] quantity threshold applies only when reached and never increases price", () => {
  const basket = [line({ qty: 3 })];
  assert.equal(app.evalQtyThreshold(promo({ type: "qty_threshold", threshold_price: 2 }), basket).discount_amount, 3.6);
  assert.equal(app.evalQtyThreshold(promo({ threshold_qty: 4 }), basket), null);
  assert.equal(app.evalQtyThreshold(promo({ threshold_price: 99 }), basket), null);
});
test("[pricing] cached coupon accepted within dates and refused after expiry", async () => {
  globalThis.__moneyPromotions = [promo({
    type: "coupon", coupon_code: "TEST10", discount_pct: 10,
    valid_until: "2026-10-13T00:00:00.000Z",
  })];
  const accepted = await app.useMultiBuy().validateCoupon("TEST10");
  assert.equal(accepted.valid, true);
  assert.equal(accepted.promo.discount_pct, 10);
  globalThis.__moneyPromotions = [promo({
    type: "coupon", coupon_code: "TEST10", valid_until: "2026-10-11T00:00:00.000Z",
  })];
  assert.equal((await app.useMultiBuy().validateCoupon("TEST10")).valid, false);
});
test("[pricing] inactive and expired offers do not apply at fixed date", () => {
  for (const p of [promo({ active: false }), promo({ valid_until: "2026-10-11T00:00:00.000Z" })]) {
    globalThis.__moneyPromotions = [p];
    assert.deepEqual(app.useMultiBuy().evaluate([line({ qty: 3 })]), []);
  }
});
for (const [name, evaluator] of [["mix-match", "evalMixMatch"], ["meal-deal", "evalMealDeal"]]) {
  known(`[pricing] ${name} leaves units outside complete sets charged normally`,
    "Existing bundle evaluator discounts every eligible unit: dairy €10.83 gives €4.83 instead of €2.25; queued promotion hotfix", () => {
      const basket = [line({ qty: 2 }), line({ id: "bread", unit_price: 1.85 }), line({ id: "milk", unit_price: 1.29, qty: 2 })];
      assert.equal(app[evaluator](promo(), basket).discount_amount, 2.25);
    });
}
known("[pricing] a promotion cannot run before valid_from",
  "Existing useMultiBuy evaluate filters valid_until but not valid_from; queued promotion hotfix", () => {
    globalThis.__moneyPromotions = [promo({ valid_from: "2026-12-01T00:00:00.000Z" })];
    assert.deepEqual(app.useMultiBuy().evaluate([line({ qty: 3 })]), []);
  });

for (const [name, result, kind] of [
  ["approved with reference", { approved: true, reference: "TEST-AUTH" }, "complete"],
  ["declined", { approved: false, error: "Declined" }, "declined"],
  ["cancelled", { approved: false, error: "Cancelled" }, "declined"],
  ["timeout", { approved: false, error: "Timeout" }, "verification_required"],
  ["no response", null, "verification_required"],
  ["missing reference", { approved: true }, "verification_required"],
  ["malformed approved", { approved: "true" }, "verification_required"],
]) test(`[payments] ${name} outcome cannot silently complete or retry an uncertain charge`, () => {
  const outcome = app.cards.resolveCardPaymentOutcome(result);
  assert.equal(outcome.kind, kind);
  assert.equal(outcome.canRetry, kind === "declined");
});
test("[payments] partial card, split cash and exact cent change", () => {
  const card = tender("card_jcc", 10, { reference: "TEST-AUTH", approved: true });
  assert.equal(app.tenders.tenderTotals([card], 22.49).balance, 12.49);
  assert.equal(app.tenders.tenderTotals([card], 22.49).isComplete, false);
  assert.equal(app.tenders.validateTenders([card, tender("cash", 20)], 22.49).changeDue, 7.51);
  assert.equal(app.tenders.validateTenders([tender("cash", 50)], 22.49).changeDue, 27.51);
});
for (const [name, tenders] of [
  ["no tenders", []],
  ["underpayment", [tender("cash", 1)]],
  ["unapproved card", [tender("card_jcc", 22.49, { reference: "TEST-AUTH", approved: false })]],
  ["missing card reference", [tender("card_jcc", 22.49, { approved: true })]],
  ["duplicate tender ID", [tender("cash", 10), tender("cash", 12.49)]],
  ["negative tender", [tender("cash", -1)]],
  ["cashless overpayment cannot give cash change", [tender("voucher", 30)]],
]) test(`[payments] rejects ${name}`, () => assert.throws(() => app.tenders.validateTenders(tenders, 22.49)));
test("[payments] invoice card reference AND confirmation required; cash must cover", () => {
  const quote = { totalCents: 2249 };
  const card = { method: "card", tender: "", cardReference: "", cardConfirmed: false };
  assert.match(app.credit.paymentBlockReason(quote, card, "retail"), /reference/i);
  assert.match(app.credit.paymentBlockReason(quote, { ...card, cardReference: "TEST-AUTH" }, "retail"), /confirm/i);
  assert.equal(app.credit.paymentBlockReason(quote, { ...card, cardReference: "TEST-AUTH", cardConfirmed: true }, "retail"), null);
  assert.match(app.credit.paymentBlockReason(quote, { method: "cash", tender: "20" }, "retail"), /cover/i);
});
test("[payments] verification lock cannot be released through generic SCO attendant action", () => {
  assert.equal(app.cards.canStartSelfCheckoutPayment("payment_verification"), false);
  assert.equal(app.cards.canGenericAttendantRelease("payment_verification"), false);
  assert.equal(app.cards.canStartSelfCheckoutPayment("scanning"), true);
});
test("[payments] non-finite amounts and zero tenders cannot complete a sale", () => {
  for (const amount of [NaN, Infinity, -Infinity, 0]) {
    assert.throws(() => app.tenders.validateTenders([tender("cash", amount)], 22.49));
  }
});
test("[payments] invoice reply must match original order, amount, method and document identity", () => {
  const reply = {
    invoiceNumber: "TEST-INV-184", invoiceId: "sample-invoice",
    orderNumber: "POS-TEST-001", orderId: "sample-order", totalCents: 2249,
    paymentMethod: "cash", changeDueCents: 2751,
  };
  assert.equal(app.credit.validateCheckout(reply, "sample-order", 2249, "cash").changeDueCents, 2751);
  for (const mutation of [
    { orderId: "other" }, { totalCents: 2248 }, { paymentMethod: "card" },
    { invoiceNumber: "" }, { changeDueCents: NaN },
  ]) assert.throws(() => app.credit.validateCheckout({ ...reply, ...mutation }, "sample-order", 2249, "cash"), /match/i);
});
