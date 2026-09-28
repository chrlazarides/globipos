import type ExcelJS from "exceljs";

/** Some supplier exports repeat a report title across row 1 and put headers on row 2. */
export function worksheetHeaderRowNumber(sheet: ExcelJS.Worksheet): number {
  const first = (sheet.getRow(1).values as unknown[]).slice(1)
    .filter(value => value !== undefined && value !== null && String(value).trim() !== "")
    .map(value => String(value).trim().toLowerCase());
  const second = (sheet.getRow(2).values as unknown[]).slice(1)
    .filter(value => value !== undefined && value !== null && String(value).trim() !== "");
  return first.length >= 2 && new Set(first).size === 1 && second.length >= 2 ? 2 : 1;
}

export function worksheetToJson(sheet: ExcelJS.Worksheet, defval: unknown = ""): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const headerRow = worksheetHeaderRowNumber(sheet);
  const headers = (sheet.getRow(headerRow).values as unknown[]).slice(1)
    .map(value => value !== null && value !== undefined ? String(value) : "");
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const values = (row.values as unknown[]).slice(1);
    const result: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      result[header] = values[index] !== undefined && values[index] !== null ? values[index] : defval;
    });
    rows.push(result);
  });
  return rows;
}