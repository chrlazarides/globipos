import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { worksheetHeaderRowNumber, worksheetToJson } from "./spreadsheet-rows";

test("supplier title row does not hide real headers or product codes", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Print");
  sheet.addRow(Array(12).fill("Items "));
  sheet.addRow(["A/A", "Code", "Factory code", "Description", "Qty1 Bal.", "Retail Price", "Web Price", "VAT", "Brand", "Inserted Date", "Date Update", "Commercial category"]);
  sheet.addRow([1, "008421374113", "1607-37411", "Toy", 11, 5.99, 5.99, "19% VAT", "TY", null, null, "Soft Toys"]);
  assert.equal(worksheetHeaderRowNumber(sheet), 2);
  const rows = worksheetToJson(sheet);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Code, "008421374113");
  assert.equal(rows[0].Description, "Toy");
  assert.equal(rows[0]["Retail Price"], 5.99);
});

test("normal spreadsheets still use their first row as headers", () => {
  const sheet = new ExcelJS.Workbook().addWorksheet("Items");
  sheet.addRow(["name", "sku"]);
  sheet.addRow(["Toy", "123"]);
  assert.equal(worksheetHeaderRowNumber(sheet), 1);
  assert.deepEqual(worksheetToJson(sheet), [{ name: "Toy", sku: "123" }]);
});