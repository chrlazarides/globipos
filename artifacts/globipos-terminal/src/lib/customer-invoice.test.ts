import test from "node:test";
import assert from "node:assert/strict";
import { parseCents, paymentBlockReason, accountBlockReason, isAmbiguousFailure, termsLabel, type Quote } from "./customer-invoice.ts";

const credit = { approvalStatus: "approved" as const, limitCents: 100000, balanceCents: 20000, availableCents: 80000, paymentTerms: "credit_30", overdueCents: 0, hasOverdue: false };
const quote: Quote = { customer: { id: "c", name: "N", code: "C1" }, credit, lines: [], subtotalCents: 8000, vatCents: 1520, totalCents: 9520, quoteHash: "h" };

test("parseCents", () => { assert.equal(parseCents("12.5"), 1250); assert.equal(parseCents("-1"), null); assert.equal(parseCents("1.234"), null); });
test("cash needs tender >= total", () => {
  assert.ok(paymentBlockReason(quote, { method: "cash", tender: "95.19", cardReference: "", cardConfirmed: false }, "wholesale"));
  assert.equal(paymentBlockReason(quote, { method: "cash", tender: "95.20", cardReference: "", cardConfirmed: false }, "wholesale"), null);
});
test("card needs reference and confirmation", () => {
  assert.ok(paymentBlockReason(quote, { method: "card", tender: "", cardReference: "", cardConfirmed: true }, "retail"));
  assert.ok(paymentBlockReason(quote, { method: "card", tender: "", cardReference: "A1", cardConfirmed: false }, "retail"));
  assert.equal(paymentBlockReason(quote, { method: "card", tender: "", cardReference: "A1", cardConfirmed: true }, "retail"), null);
});
test("account credit blocks", () => {
  assert.ok(accountBlockReason({ ...credit, approvalStatus: "pending" }, 1));
  assert.ok(accountBlockReason({ ...credit, approvalStatus: "suspended" }, 1));
  assert.ok(accountBlockReason(credit, 80001));
  assert.equal(accountBlockReason({ ...credit, hasOverdue: true, overdueCents: 500 }, 80000), null);
});
test("ambiguity and terms", () => {
  assert.equal(isAmbiguousFailure(null), true); assert.equal(isAmbiguousFailure(502), true); assert.equal(isAmbiguousFailure(409), false);
  assert.equal(termsLabel("credit_14"), "14 days");
});

import { mapCartLines, basketFingerprint, validateCheckout, validateQuote, failureText } from "./customer-invoice.ts";
test("cart mapping keeps variant and sale unit separate", () => {
  const lines = mapCartLines([
    { product_id: "a", qty: 2, variant_id: "v1", sale_unit: "pack" },
    { product_id: "a", qty: 1, variant_id: "v1", sale_unit: "pack" },
    { product_id: "a", qty: 4 }, { product_id: "b", qty: 1, voided: true },
  ]);
  assert.deepEqual(lines, [{ itemId: "a", variantId: "v1", quantity: 3, saleUnit: "pack" }, { itemId: "a", variantId: null, quantity: 4, saleUnit: "pc" }]);
  assert.notEqual(basketFingerprint(lines), basketFingerprint([{ ...lines[0], quantity: 4 }, lines[1]]));
});
test("response validation", () => {
  assert.throws(() => validateQuote({ quoteHash: "x" }));
  const r = { orderId: "k", orderNumber: "O1", invoiceId: "i", invoiceNumber: "INV1", totalCents: 100, changeDueCents: 0, paymentMethod: "cash", deduplicated: false };
  assert.equal(validateCheckout(r, "k", 100, "cash").invoiceNumber, "INV1");
  assert.throws(() => validateCheckout(r, "other", 100, "cash"));
  assert.throws(() => validateCheckout(r, "k", 101, "cash"));
});
test("http categories", () => {
  for (const s of [400, 401, 403, 404, 409, 422, 429, 500, 503]) assert.ok(failureText(s).length > 5);
  assert.equal(isAmbiguousFailure(429), false); assert.equal(isAmbiguousFailure(408), true);
});
