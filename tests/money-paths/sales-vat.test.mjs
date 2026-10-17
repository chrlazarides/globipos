import assert from "node:assert/strict";
import test from "node:test";
import { app, known } from "./bootstrap.mjs";
import { line, golden, product, price } from "./fixtures.mjs";

test("[sales] golden shelf basket: 22.77 less 0.28 = 22.49; VAT 0.93 / 0.48", () => {
  const lines = golden();
  const amounts = lines.map(app.pricing.computeLineAmounts);
  const totals = app.pricing.computeOrderTotals(lines, 0, 0);
  assert.equal(Math.round(amounts.reduce((s, l) => s + l.lineSubtotal, 0) * 100), 2277);
  assert.equal(totals.discountAmount, 0.28);
  assert.equal(totals.total, 22.49);
  for (const [rate, cents] of [[5, 93], [19, 48]]) {
    assert.equal(Math.round(lines.filter(l => l.vat_rate === rate).reduce((s, l) => s + l.vat_amount, 0) * 100), cents);
  }
});
for (const [name, input, expected] of [
  ["quantity", { qty: 3 }, 9.6],
  ["weighed tomatoes", { qty: 1.24, unit_price: 2.49 }, 3.09],
  ["weighed cucumbers", { qty: 0.85, unit_price: 1.99 }, 1.69],
  ["percentage then fixed discount", { qty: 2, line_discount_pct: 10, line_discount_fixed: 0.5 }, 5.26],
  ["over-discount clamps positive line", { line_discount_fixed: 20 }, 0],
  ["override is used instead of original price", { override_price: 2 }, 2],
]) test(`[sales] ${name}`, () => assert.equal(app.pricing.computeLineAmounts(line(input)).lineTotal, expected));

test("[sales] void line excluded; return/negative adjustment reverses original gross and VAT", () => {
  const totals = app.pricing.computeOrderTotals([line(), line({ id: "return", unit_price: -3.2 })], 0, 0);
  assert.equal(totals.total, 0);
  assert.equal(totals.vatAmount, 0);
  assert.equal(app.pricing.computeOrderTotals([line({ voided: true })], 0, 0).total, 0);
});
test("[sales] bill discount apportions VAT, and cannot produce negative sale", () => {
  assert.equal(app.pricing.computeOrderTotals([line({ unit_price: 10.5 })], 10, 0).total, 9.45);
  assert.equal(app.pricing.computeOrderTotals([line({ unit_price: 10.5 })], 0, 1).total, 9.45);
  assert.equal(app.pricing.computeOrderTotals([line()], 0, 100).total, 0);
});
for (const [rate, vat] of [[0, 0], [3, 0.09], [5, 0.15], [9, 0.26], [19, 0.51]]) {
  test(`[vat] Cyprus ${rate}% included: native line, PWA receipt and inclusive invoice agree`, () => {
    const native = app.pricing.computeLineAmounts(line({ vat_rate: rate }));
    const pwa = app.terminal.createOrderLine(product({ vat_rate: rate }), 1, "sample");
    const invoice = price({ item: { ...product(), id: "sample-item", name: "Sample", price1: "3.20", vatRate: String(rate) } });
    assert.equal(native.lineTotal, 3.2);
    assert.equal(native.vatAmount, vat);
    assert.equal(pwa.line_total, 3.2);
    assert.equal(pwa.vat_amount, vat);
    assert.equal(invoice.totalCents + invoice.vatCents, 320);
    assert.equal(invoice.vatCents, Math.round(vat * 100));
  });
}
test("[vat] 1,000 deterministic integer-cent cases conserve gross, net and included VAT", () => {
  let seed = 17;
  for (let i = 0; i < 1000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const cents = seed % 9999 + 1, qty = seed % 20 + 1;
    const rate = [0, 3, 5, 9, 19][i % 5];
    const amount = app.pricing.computeLineAmounts(line({ unit_price: cents / 100, qty, vat_rate: rate }));
    const gross = cents * qty;
    const expectedVat = Number((BigInt(gross * rate) * 2n + BigInt(100 + rate)) / BigInt(2 * (100 + rate)));
    assert.equal(Math.round(amount.lineTotal * 100), gross, `gross case ${i}`);
    assert.equal(Math.round(amount.vatAmount * 100), expectedVat, `VAT case ${i}`);
    assert.equal(Math.round((amount.lineNet + amount.vatAmount) * 100), gross);
  }
});
test("[vat] two €0.99 lines retain per-line 5% VAT (€0.10), not rate-net rounding", () => {
  const lines = [line({ unit_price: 0.99 }), line({ id: "two", unit_price: 0.99 })];
  assert.equal(app.pricing.computeOrderTotals(lines, 0, 0).vatAmount, 0.1);
  assert.equal(lines.reduce((sum, l) => sum + price({ item: {
    id: l.id, name: l.description, price1: "0.99", vatRate: "5",
  } }).vatCents, 0), 10);
});
known("[vat] native catalogue createLine preserves inclusive shelf prices at levels 1–5",
  "Engineering base has the pre-hotfix native createLine: no inclusive flag, €3.20 becomes €3.36 at 5%; separate VAT hotfix requires review", () => {
    for (let level = 1; level <= 5; level++) {
      const l = app.pricing.createLine(product({ price1: 3.2, price2: 3.2, price3: 3.2, price4: 3.2, price5: 3.2 }), level);
      assert.equal(l.line_total, 3.2, `level ${level}`);
      assert.equal(l.vat_amount, 0.15, `level ${level}`);
    }
  });
known("[vat] POS invoice accepts 1.240 kg at €2.49 with included VAT",
  "Engineering base invoice pricer rejects fractional stock quantity; weighed invoice work exists on a separate branch and is not imported here", () => {
    const result = price({
      item: { id: "sample-weighed", name: "Sample Tomatoes", price1: "2.49", vatRate: "5", unit: "kg" },
      line: { quantity: 1.24, saleUnit: "kg" },
    });
    assert.equal(result.totalCents + result.vatCents, 309);
    assert.equal(result.vatCents, 15);
  });
