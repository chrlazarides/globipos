export type BarcodeIssueReason = "missing" | "invalid" | "duplicate" | "scale_pattern";

export interface BarcodeIssue {
  row: number;
  sku: string;
  sourceBarcode: string | null;
  assignedBarcode: string;
  reason: BarcodeIssueReason;
  message: string;
}

export const BARCODE_ISSUE_REASON_LABELS: Record<BarcodeIssueReason, string> = {
  missing: "Missing barcode",
  invalid: "Invalid barcode",
  duplicate: "Duplicate barcode",
  scale_pattern: "Scale-pattern barcode",
};

export function summarizeBarcodeIssues(issues: BarcodeIssue[]): Record<BarcodeIssueReason, number> {
  const summary: Record<BarcodeIssueReason, number> = {
    missing: 0,
    invalid: 0,
    duplicate: 0,
    scale_pattern: 0,
  };
  for (const issue of issues) summary[issue.reason]++;
  return summary;
}

function csvCell(value: string): string {
  const spreadsheetSafeValue = /^[\t ]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${spreadsheetSafeValue.replace(/"/g, '""')}"`;
}

export function barcodeIssuesToCsv(issues: BarcodeIssue[]): string {
  const header = ["Source barcode", "SKU", "Reason", "Assigned barcode"].map(csvCell).join(",");
  const rows = issues.map((issue) => [
    issue.sourceBarcode ?? "",
    issue.sku,
    BARCODE_ISSUE_REASON_LABELS[issue.reason],
    issue.assignedBarcode,
  ].map(csvCell).join(","));
  return [header, ...rows].join("\r\n");
}