export type BarcodeIssueReason = "missing" | "invalid" | "duplicate" | "scale_pattern";

export interface BarcodeIssue {
  row: number;
  sku: string;
  sourceBarcode: string | null;
  assignedBarcode: string;
  reason: BarcodeIssueReason;
  message: string;
}