import type ExcelJS from "exceljs";

export function worksheetToJson(sheet: ExcelJS.Worksheet, defval: any = ""): any[] {
  const rows: any[] = [];
  let headers: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as any[]).slice(1);
    if (!values.some((v) => v !== null && v !== undefined && String(v).trim() !== "")) return;
    if (!headers.length) {
      headers = values.map((v) => (v !== null && v !== undefined ? String(v) : ""));
    } else {
      const obj: any = {};
      headers.forEach((h, i) => {
        const v = values[i];
        obj[h] = v !== undefined && v !== null ? v : defval;
      });
      rows.push(obj);
    }
  });
  return rows;
}