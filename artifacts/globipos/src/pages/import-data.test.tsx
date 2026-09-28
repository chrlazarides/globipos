import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { autoMapColumns, mapImportRows, smartSheetParse, worksheetTo2DArray } from "./import-data";

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

test("items import sends the reviewed rows with the selected field mapping", () => {
  const sheet = new ExcelJS.Workbook().addWorksheet("Print");
  sheet.addRow(Array(12).fill("Items "));
  sheet.addRow(["A/A", "Code", "Factory code", "Description", "Qty1 Bal.", "Retail Price",
    "Web Price", "VAT", "Brand", "Inserted Date", "Date Update", "Commercial category"]);
  sheet.addRow([1, "008421374113", "1607-37411", "Toy", 11, 5.99, 5.99,
    "19% VAT", "TY", "2026-08-11", "2026-08-11", "Soft Toys"]);
  const parsed = smartSheetParse(worksheetTo2DArray(sheet));
  const rows = mapImportRows(parsed.rows, {
    name: "Description", sku: "Code", category: "Commercial category",
    brand: "Brand", price1: "Retail Price", stockQuantity: "Qty1 Bal.",
  });
  assert.deepEqual(rows, [{
    name: "Toy", sku: "008421374113", category: "Soft Toys",
    brand: "TY", price1: "5.99", stockQuantity: "11",
  }]);
  assert.throws(() => mapImportRows(parsed.rows, { name: "Not a column", sku: "Code" }), /Map the Name column/);
});

test("barcode-only items do not need a mapped SKU column", () => {
  assert.deepEqual(
    mapImportRows([{ Product: "Toy", EAN: "008421374113" }], { name: "Product", barcode: "EAN" }),
    [{ name: "Toy", barcode: "008421374113" }],
  );
  assert.throws(
    () => mapImportRows([{ Product: "Toy" }], { name: "Product" }),
    /Map either SKU or Barcode/,
  );
});