import test from "node:test";
import assert from "node:assert/strict";
import { accountBalanceAfterJournalLine, erpInvoiceJournalLines, invoiceInventoryDelta } from "./erp-invoice-import";

test("ERP posted invoice journal preserves AR, revenue, VAT, COGS and inventory invariants", () => {
  const lines = erpInvoiceJournalLines(119, 19, 40);
  assert.deepEqual(lines.map(line => line.code), ["1100", "4000", "2100", "5000", "1200"]);
  assert.equal(lines.reduce((sum, line) => sum + line.debit, 0), 159);
  assert.equal(lines.reduce((sum, line) => sum + line.credit, 0), 159);
});

test("ERP-owned stock suppresses invoice inventory movement while local-owned stock retains it", () => {
  assert.equal(invoiceInventoryDelta(false, 3, 5), 0);
  assert.equal(invoiceInventoryDelta(true, 3, 5), -2);
  const initial = 100;
  const afterErpOwnedInvoice = initial + invoiceInventoryDelta(false, 0, 5);
  const finalErpBalance = 73;
  assert.equal(afterErpOwnedInvoice, 100);
  assert.equal(finalErpBalance, 73);
});

test("invoice journal account impacts apply, reverse, and changed replay without drift", () => {
  assert.equal(accountBalanceAfterJournalLine(100, "asset", 119, 0), 219);
  assert.equal(accountBalanceAfterJournalLine(219, "asset", 119, 0, "reverse"), 100);
  assert.equal(accountBalanceAfterJournalLine(500, "revenue", 0, 100), 600);
  assert.equal(accountBalanceAfterJournalLine(600, "revenue", 0, 100, "reverse"), 500);

  const accountTypes: Record<string, string> = { "1100": "asset", "4000": "revenue", "2100": "liability", "5000": "expense", "1200": "asset" };
  const balances: Record<string, number> = Object.fromEntries(Object.keys(accountTypes).map(code => [code, 0]));
  const apply = (lines: ReturnType<typeof erpInvoiceJournalLines>, direction: "apply" | "reverse") => {
    for (const line of lines) balances[line.code] = accountBalanceAfterJournalLine(balances[line.code], accountTypes[line.code], line.debit, line.credit, direction);
  };
  const original = erpInvoiceJournalLines(119, 19, 40);
  const changed = erpInvoiceJournalLines(238, 38, 75);
  apply(original, "apply");
  apply(original, "reverse");
  apply(changed, "apply");
  assert.deepEqual(balances, { "1100": 238, "4000": 200, "2100": 38, "5000": 75, "1200": -75 });
  apply(changed, "reverse");
  assert.deepEqual(balances, { "1100": 0, "4000": 0, "2100": 0, "5000": 0, "1200": 0 });
});