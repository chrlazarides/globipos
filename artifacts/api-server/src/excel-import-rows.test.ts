import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { worksheetToJson } from "./excel-import-rows";

test("item import uses headers after a blank first row", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Print");
  sheet.getRow(1).getCell(1).value = null;
  sheet.addRow(["Code", "Factory code", "Description", "Retail Price", "Commercial category"]);
  sheet.addRow(["008421374113", "1607-37411", "Toy", 5.99, "Soft Toys"]);
  const rows = worksheetToJson(sheet);
  assert.deepEqual(rows, [{
    Code: "008421374113",
    "Factory code": "1607-37411",
    Description: "Toy",
    "Retail Price": 5.99,
    "Commercial category": "Soft Toys",
  }]);
});

test("item import retains conventional first-row headers", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Items");
  sheet.addRow(["sku", "name"]);
  sheet.addRow(["A1", "Toy"]);
  assert.deepEqual(worksheetToJson(sheet), [{ sku: "A1", name: "Toy" }]);
});