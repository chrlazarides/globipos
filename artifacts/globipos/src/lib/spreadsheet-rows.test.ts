import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { excelSheetToJson } from "./spreadsheet-rows";

test("mapping displays the second-row column names after a repeated report title", () => {
  const sheet = new ExcelJS.Workbook().addWorksheet("Print");
  sheet.addRow(["Items ", "Items ", "Items "]);
  sheet.addRow(["Code", "Description", "Retail Price"]);
  sheet.addRow(["008421374113", "Toy", 5.99]);
  assert.deepEqual(excelSheetToJson(sheet), [{
    Code: "008421374113", Description: "Toy", "Retail Price": 5.99,
  }]);
});