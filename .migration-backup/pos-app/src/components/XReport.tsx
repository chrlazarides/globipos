/**
 * XReport / ZReport — shift summary display.
 *
 * X-report: mid-shift read (non-resetting)
 * Z-report: end-of-shift (shown after closeShift)
 *
 * Props control whether this is an X or Z report and provide
 * the data. Has a print button that formats and sends to printer.
 */

import { Printer, TrendingUp, Wallet, CreditCard, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { XReport as XReportData, ZReport } from "../hooks/useShift";
import type { PrintReceiptLine } from "../hooks/useHardware";

interface XReportProps {
  report: XReportData | ZReport;
  type: "x" | "z";
  onPrint?: (lines: PrintReceiptLine[]) => void;
  onClose?: () => void;
  terminalName?: string;
  cashierName?: string;
}

function isZReport(r: XReportData | ZReport): r is ZReport {
  return "variance" in r;
}

function StatRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 ${highlight ? "font-semibold text-primary" : "text-sm"}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-mono">{value}</span>
    </div>
  );
}

export default function XReport({ report, type, onPrint, onClose, terminalName, cashierName }: XReportProps) {
  const isZ = isZReport(report);
  const shift = report.shift;
  const label = type === "x" ? "X-REPORT" : "Z-REPORT";

  const expectedCash = isZ ? report.expected_cash : (report as any).expected_cash ?? 0;
  const openedAt = new Date(shift.opened_at).toLocaleString();
  const closedAt = isZ && shift.closed_at ? new Date(shift.closed_at).toLocaleString() : null;

  function buildPrintLines(): PrintReceiptLine[] {
    const lines: PrintReceiptLine[] = [
      { text: terminalName ?? "Terminal", align: "center", bold: true },
      { text: `${label}`, align: "center", bold: true, size: "big" },
      { divider: true },
      { text: `Opened: ${openedAt}` },
      closedAt ? { text: `Closed: ${closedAt}` } : null,
      { text: `Cashier: ${cashierName ?? shift.cashier_name}` },
      { divider: true },
      { text: `Total Sales`, bold: true },
      { text: `Cash      ${formatCurrency(shift.total_cash_sales)}` },
      { text: `Card      ${formatCurrency(shift.total_card_sales)}` },
      { text: `TOTAL     ${formatCurrency(shift.total_sales)}`, bold: true },
      { divider: true },
      { text: `Transactions: ${shift.order_count}` },
      { text: `Voids: ${formatCurrency(shift.total_voids)}` },
      { text: `Avg basket: ${formatCurrency(report.avg_basket)}` },
      { divider: true },
      { text: `Opening float: ${formatCurrency(shift.opening_float)}` },
      { text: `Cash in/out: ${formatCurrency(expectedCash - shift.opening_float - shift.total_cash_sales)}` },
      { text: `Expected cash: ${formatCurrency(expectedCash)}` },
      isZ ? { text: `Counted cash: ${formatCurrency((report as ZReport).closing_cash)}` } : null,
      isZ ? {
        text: `Variance: ${formatCurrency((report as ZReport).variance)}`,
        bold: true
      } : null,
      { divider: true },
      { text: `Printed: ${new Date().toLocaleString()}`, align: "center" },
    ].filter(Boolean) as PrintReceiptLine[];
    return lines;
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border p-6 w-full max-w-sm mx-auto space-y-4" data-testid="x-report">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest">{label}</p>
          <p className="text-lg font-bold">{terminalName}</p>
        </div>
        <div className="flex gap-2">
          {onPrint && (
            <Button size="sm" variant="outline" data-testid="btn-print-report" onClick={() => onPrint(buildPrintLines())}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
          )}
          {onClose && (
            <Button size="sm" variant="ghost" data-testid="btn-close-report" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Time */}
      <div className="text-xs text-muted-foreground space-y-0.5">
        <p>Opened: {openedAt}</p>
        {closedAt && <p>Closed: {closedAt}</p>}
        <p>Cashier: {cashierName ?? shift.cashier_name}</p>
      </div>

      {/* Sales */}
      <div className="space-y-0">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
          <TrendingUp className="h-3.5 w-3.5" /> Sales
        </div>
        <StatRow label="Cash sales" value={formatCurrency(shift.total_cash_sales)} />
        <StatRow label="Card sales" value={formatCurrency(shift.total_card_sales)} />
        <StatRow label="Total sales" value={formatCurrency(shift.total_sales)} highlight />
        <StatRow label="Voids" value={formatCurrency(shift.total_voids)} />
        <StatRow label="Transactions" value={shift.order_count.toString()} />
        <StatRow label="Avg basket" value={formatCurrency(report.avg_basket)} />
      </div>

      {/* Cash */}
      <div className="space-y-0">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
          <Wallet className="h-3.5 w-3.5" /> Cash
        </div>
        <StatRow label="Opening float" value={formatCurrency(shift.opening_float)} />
        <StatRow label="Expected in drawer" value={formatCurrency(expectedCash)} />
        {isZ && (
          <>
            <StatRow label="Counted cash" value={formatCurrency((report as ZReport).closing_cash)} />
            <StatRow
              label="Variance"
              value={
                ((report as ZReport).variance >= 0 ? "+" : "") +
                formatCurrency((report as ZReport).variance)
              }
              highlight
            />
            <div className={`text-xs text-center py-1 rounded ${
              (report as ZReport).is_balanced
                ? "text-green-600 bg-green-50 dark:bg-green-950"
                : "text-red-600 bg-red-50 dark:bg-red-950"
            }`}>
              {(report as ZReport).is_balanced ? "✓ Balanced" : "⚠ Out of balance"}
            </div>
          </>
        )}
      </div>

      {/* Top payment */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CreditCard className="h-3.5 w-3.5" />
        Primary payment: <span className="font-medium capitalize">{report.top_payment}</span>
      </div>
    </div>
  );
}

function formatCurrency(v: number): string {
  return `€${(v ?? 0).toFixed(2)}`;
}
