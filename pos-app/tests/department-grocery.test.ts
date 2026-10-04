import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryBranchIds, departmentButtonAction, inheritedDepartmentVat, isWeighedProduct, parseMoneyDigits, scaleQuantity } from "../src/lib/departmentEntry";
import { computeLineAmounts, computeOrderTotals, createDepartmentLine, getPriceForLevel } from "../src/lib/pricing";
import type { Category, Product } from "../src/types";

const root: Category = { id: "local-fruit", server_id: "fruit", name: "Fruits", active: true, vat_rate: 5 };
const child: Category = { id: "local-citrus", server_id: "citrus", name: "Citrus", parent_id: "fruit", active: true, vat_rate: null as unknown as number };
const categories = [root, child];

test("monetary digits represent cents, including leading zeros and deletion", () => {
  for (const [digits, amount] of [["2", .02], ["23", .23], ["230", 2.30], ["2300", 23], ["000230", 2.30]] as const) {
    assert.equal(parseMoneyDigits(digits), amount);
  }
  for (const bad of ["", "-230", "2.30", "abc", "999999999", "Infinity"]) assert.equal(parseMoneyDigits(bad), null);
});

test("category press navigates without an amount and sells with an amount", () => {
  assert.equal(departmentButtonAction("fruit", "", categories).type, "navigate");
  const action = departmentButtonAction("local-citrus", "230", categories);
  assert.equal(action.type, "sale");
  if (action.type === "sale") {
    assert.equal(action.amount, 2.30);
    assert.equal(action.category.vat_rate, 5);
  }
  assert.throws(() => departmentButtonAction("fruit", "0", categories));
  assert.throws(() => departmentButtonAction("missing", "230", categories));
  assert.throws(() => departmentButtonAction("fruit", "230", [{ ...root, active: false }]));
});

test("VAT inheritance keeps explicit zero, rejects invalid ancestry and survives cycles", () => {
  assert.equal(inheritedDepartmentVat(child, categories), 5);
  assert.equal(inheritedDepartmentVat({ ...child, vat_rate: 0 }, categories), 0);
  const a = { ...root, parent_id: "citrus", vat_rate: NaN };
  assert.equal(inheritedDepartmentVat(child, [a, child]), null);
  assert.ok(categoryBranchIds([a, child], "fruit").has("local-citrus"));
});

test("entered department gross amount is unchanged by VAT, including penny rounding", () => {
  for (const rate of [0, 5, 9, 19, 100]) {
    for (let cents = 1; cents <= 500; cents++) {
      const line = createDepartmentLine({ ...root, vat_rate: rate }, cents / 100, "sale", "line");
      assert.equal(line.line_total, cents / 100);
      assert.equal(line.category_id, "fruit");
      const totals = computeOrderTotals([line], 0, 0);
      assert.equal(totals.total, cents / 100, `rate ${rate}, cents ${cents}`);
      assert.equal(totals.vatAmount, line.vat_amount);
    }
  }
});

test("VAT is counted once for ordinary, mixed and discounted lines", () => {
  const dept = createDepartmentLine({ ...root, vat_rate: 19 }, 2.30, "sale", "dept");
  const regular = { ...dept, id: "regular", price_includes_vat: false, unit_price: 10, vat_rate: 19 };
  const amounts = computeLineAmounts(regular);
  regular.line_total = amounts.lineTotal;
  regular.vat_amount = amounts.vatAmount;
  assert.equal(computeOrderTotals([regular], 0, 0).total, 11.90);
  assert.equal(computeOrderTotals([regular, dept], 0, 0).total, 14.20);
  assert.equal(computeOrderTotals([regular], 10, 0).total, 10.71);
  assert.equal(computeOrderTotals([regular], 0, 0, 10).total, 13.09);
  assert.equal(computeOrderTotals([{ ...dept, voided: true }], 0, 0).total, 0);
  const restored = JSON.parse(JSON.stringify(dept));
  assert.equal(computeOrderTotals([restored], 0, 0).total, 2.30);
});

test("scale entry preserves kg and gram units and rejects unusable readings", () => {
  const reading = { kg: .750, grams: 750, stable: true };
  assert.equal(scaleQuantity({ unit_type: "Kg" }, reading), .750);
  assert.equal(scaleQuantity({ unit_type: "g" }, reading), 750);
  for (const invalid of [null, { ...reading, stable: false }, { ...reading, kg: 0 }, { ...reading, kg: -1 }, { ...reading, kg: NaN }]) {
    assert.throws(() => scaleQuantity({ unit_type: "kg" }, invalid));
  }
  assert.equal(isWeighedProduct({ unit_type: "KG" }), true);
  assert.equal(isWeighedProduct({ unit_type: "pcs" }), false);
});

test("unit pricing respects the current price level and timed overrides", () => {
  const product = { price1: 2.99, price2: 3.49, price3: 0, price4: 4, price5: 5 } as Product;
  assert.equal(getPriceForLevel(product, 2), 3.49);
  assert.equal(getPriceForLevel(product, 3), 2.99);
  assert.equal(getPriceForLevel({ ...product, timed_price: 0 }, 2), 0);
});