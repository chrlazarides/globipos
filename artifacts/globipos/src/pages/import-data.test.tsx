import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { autoMapColumns, smartSheetParse, worksheetTo2DArray } from "./import-data";

test("repeated Items title does not replace the actual spreadsheet headers", () => {
  const sheet = new ExcelJS.Workbook().addWorksheet("Print");
  sheet.addRow(Array(12).fill("Items "));
  sheet.addRow(["A/A", "Code", "Factory code", "Description", "Qty1 Bal.", "Retail Price",
    "Web Price", "VAT", "Brand", "Inserted Date", "Date Update", "Commercial category"]);
  sheet.addRow([1, "008421374113", "1607-37411", "Toy", 11, 5.99, 5.99,
    "19% VAT", "TY", "2026-08-11", "2026-08-11", "Soft Toys"]);

  const parsed = smartSheetParse(worksheetTo2DArray(sheet));
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]["Description"], "Toy");
  assert.equal(parsed.rows[0]["Code"], "008421374113");

  const mapping = autoMapColumns(parsed.headers, [
    { key: "name", label: "Name", required: true },
    { key: "sku", label: "SKU", required: true },
  ]);
  assert.deepEqual(mapping, { name: "Description", sku: "Code" });
});