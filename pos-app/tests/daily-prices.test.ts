import assert from "node:assert/strict";
import test from "node:test";
import { dailyPriceChanges, dailyPriceReceipt, dailyPriceStepMatches, parseDailyPrice, type GroceryPriceList } from "../src/lib/groceryPrices";
import { createLine } from "../src/lib/pricing";
import { scaleQuantity } from "../src/lib/departmentEntry";
import type { Product } from "../src/types";
const list: GroceryPriceList = {
  categoryId: "fruit", categoryName: "Fruit", priceLevel: 2, locationId: "shop", scope: "Shared",
  items: [
    { itemId: "banana", name: "Bananas", sku: "4011", unit: "kg", price: 2.99, effectivePrice: 2.99 },
    { itemId: "apple", name: "Apples", sku: "4012", unit: "kg", price: 0, effectivePrice: 1.80 },
  ],
};
test("blank rows are unchanged; only necessary edits are saved, including fallback-price lists", () => {
  assert.deepEqual(dailyPriceChanges(list, { banana: "", apple: " " }), []);
  assert.deepEqual(dailyPriceChanges(list, { banana: "3,49", apple: "" }), [{ itemId: "banana", price: 3.49, previousPrice: 2.99 }]);
  assert.deepEqual(dailyPriceChanges(list, { banana: "2.99", apple: "1.80" }), []);
  for (const input of ["0", "-1", "1.999", "abc", "Infinity", "100001"]) assert.throws(() => parseDailyPrice(input));
});
test("category printout uses correct item units and Cyprus time", () => {
  const printed = dailyPriceReceipt({ ...list, categoryName: "Bakery", items: [{ ...list.items[0], unit: "pc", name: "Baguette" }] },
    "Shop", new Date("2026-10-04T06:00:00Z"));
  assert.ok(printed.some(l => l.text === "Bakery"));
  assert.ok(printed.some(l => l.text?.includes("09:00:00")));
  assert.ok(printed.some(l => l.text === "EUR 2.99 / pc"));
});
test("saved Bananas price uses the live checkout-scale quantity, never a one-sale override", () => {
  const banana = { id: "local", server_id: "banana", name: "Bananas", sku: "4011", price1: 2.99, price2: 3.49,
    price3: 0, price4: 0, price5: 0, unit_type: "kg", pack_size: 1, vat_rate: 5, active: true } as Product;
  const line = createLine(banana, 2, scaleQuantity(banana, { stable: true, grams: 750, kg: .750 }), new Map());
  assert.equal(line.unit_price, 3.49);
  assert.equal(line.qty, .750);
  assert.equal(line.override_price, undefined);
});
test("price-change macro steps respect receipt-sign and transaction conditions", () => {
  const step = { code: "GROCERY_DAILY_PRICES", conditions: [{ receiptSign: "zero", transactionType: "sale" }] };
  assert.equal(dailyPriceStepMatches(step, 0, false), true);
  assert.equal(dailyPriceStepMatches(step, 1, false), false);
  assert.equal(dailyPriceStepMatches(step, 0, true), false);
});