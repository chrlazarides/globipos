/**
 * ShiftManager — shift lifecycle UI.
 *
 * States:
 *  - No shift open → "Open Shift" form (enter opening float, cashier confirmed)
 *  - Shift open → dashboard with totals, cash in/out, X-report button
 *  - Close shift → enter counted cash, review variance, Z-report
 *
 * Accessible from the POS sidebar / main menu.
 */

import { useState, useCallback } from "react";
import {
  DollarSign, TrendingUp, LogOut, PlusCircle, MinusCircle,
  BarChart2, FileText, Loader2, ChevronRight, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useShift } from "../hooks/useShift";
import type { XReport as XReportData, ZReport } from "../hooks/useShift";
import XReport from "../components/XReport";
import type { PrintReceiptLine } from "../hooks/useHardware";

interface ShiftManagerProps {
  cashierId: string;
  cashierName: string;
  terminalName?: string;
  onPrint?: (lines: PrintReceiptLine[]) => void;
}

function fmt(n: number) {
  return `€${(n ?? 0).toFixed(2)}`;
}

export default function ShiftManager({ cashierId, cashierName, terminalName = "Terminal", onPrint }: ShiftManagerProps) {
  const shift = useShift();

  // Open shift state
  const [openingFloat, setOpeningFloat] = useState("0.00");
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  // Cash in/out state
  const [cashEventDialog, setCashEventDialog] = useState<"in" | "out" | null>(null);
  const [cashEventAmount, setCashEventAmount] = useState("");
  const [cashEventNote, setCashEventNote] = useState("");
  const [cashEventLoading, setCashEventLoading] = useState(false);

  // X-report state
  const [xReport, setXReport] = useState<XReportData | null>(null);
  const [xReportLoading, setXReportLoading] = useState(false);

  // Close shift state
  const [closeDialog, setCloseDialog] = useState(false);
  const [closingCash, setClosingCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [blindClose, setBlindClose] = useState(false);
  const [zReport, setZReport] = useState<ZReport | null>(null);
  const [closeLoading, setCloseLoading] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // ── Open shift ──────────────────────────────────────────────────────────────

  const handleOpenShift = useCallback(async () => {
    setOpenLoading(true);
    setOpenError(null);
    try {
      await shift.openShift(cashierId, cashierName, parseFloat(openingFloat) || 0);
    } catch (e: any) {
      setOpenError(e?.message ?? "Failed to open shift");
    } finally {
      setOpenLoading(false);
    }
  }, [shift, cashierId, cashierName, openingFloat]);

  // ── Cash in / out ───────────────────────────────────────────────────────────

  async function submitCashEvent() {
    if (!cashEventDialog) return;
    const amount = parseFloat(cashEventAmount);
    if (isNaN(amount) || amount <= 0) return;
    setCashEventLoading(true);
    try {
      if (cashEventDialog === "in") {
        await shift.addCashIn(amount, cashEventNote);
      } else {
        await shift.addCashOut(amount, cashEventNote);
      }
      setCashEventDialog(null);
      setCashEventAmount("");
      setCashEventNote("");
    } finally {
      setCashEventLoading(false);
    }
  }

  // ── X-report ────────────────────────────────────────────────────────────────

  async function handleXReport() {
    setXReportLoading(true);
    try {
      const report = await shift.getXReport();
      setXReport(report);
    } finally {
      setXReportLoading(false);
    }
  }

  // ── Close shift (Z-report) ──────────────────────────────────────────────────

  async function handleCloseShift() {
    setCloseLoading(true);
    setCloseError(null);
    try {
      const report = await shift.closeShift(
        blindClose ? 0 : parseFloat(closingCash) || 0,
        closeNotes,
        blindClose
      );
      setZReport(report);
      setCloseDialog(false);
    } catch (e: any) {
      setCloseError(e?.message ?? "Failed to close shift");
    } finally {
      setCloseLoading(false);
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  // State: Z-report shown after closing
  if (zReport) {
    return (
      <div className="flex flex-col items-center gap-6 p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold">Shift Closed</h2>
          <p className="text-muted-foreground">Z-Report printed below</p>
        </div>
        <XReport
          report={zReport}
          type="z"
          terminalName={terminalName}
          cashierName={cashierName}
          onPrint={onPrint}
          onClose={() => setZReport(null)}
        />
      </div>
    );
  }

  // State: X-report shown inline
  if (xReport) {
    return (
      <div className="flex flex-col items-center gap-6 p-6">
        <XReport
          report={xReport}
          type="x"
          terminalName={terminalName}
          cashierName={cashierName}
          onPrint={onPrint}
          onClose={() => setXReport(null)}
        />
      </div>
    );
  }

  // State: no shift open — open shift form
  if (!shift.isShiftOpen) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <TrendingUp className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Open Shift</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="opening-float">Opening float (cash in drawer)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                <Input
                  id="opening-float"
                  data-testid="input-opening-float"
                  className="pl-7 font-mono text-lg"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                />
              </div>
            </div>
            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              <p className="font-medium">{cashierName}</p>
              <p className="text-muted-foreground text-xs">{terminalName}</p>
            </div>
            {(openError || shift.error) && (
              <p className="text-sm text-red-500">{openError ?? shift.error}</p>
            )}
            <Button
              data-testid="btn-open-shift"
              className="w-full"
              onClick={handleOpenShift}
              disabled={openLoading}
            >
              {openLoading
                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                : <TrendingUp className="h-4 w-4 mr-2" />
              }
              Open Shift
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // State: shift is open — dashboard
  const s = shift.currentShift!;
  return (
    <div className="flex flex-col gap-6 p-6" data-testid="shift-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{terminalName} — Shift Open</h2>
          <p className="text-muted-foreground text-sm">
            Opened: {new Date(s.opened_at).toLocaleString()} · Cashier: {s.cashier_name}
          </p>
        </div>
        <Button
          variant="destructive"
          data-testid="btn-close-shift"
          onClick={() => setCloseDialog(true)}
        >
          <LogOut className="h-4 w-4 mr-1.5" /> Close Shift
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Cash Sales", value: fmt(s.total_cash_sales), icon: DollarSign, color: "text-green-600" },
          { label: "Card Sales", value: fmt(s.total_card_sales), icon: TrendingUp, color: "text-blue-600" },
          { label: "Total Sales", value: fmt(s.total_sales), icon: BarChart2, color: "text-primary", bold: true },
          { label: "Transactions", value: s.order_count.toString(), icon: FileText, color: "text-muted-foreground" },
        ].map(({ label, value, icon: Icon, color, bold }) => (
          <Card key={label} data-testid={`shift-stat-${label.toLowerCase().replace(" ", "-")}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <p className="text-xs text-muted-foreground">{label}</p>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <p className={`text-xl font-mono mt-1 ${bold ? "font-bold text-primary" : "font-semibold"}`}>
                {value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          data-testid="btn-cash-in"
          onClick={() => setCashEventDialog("in")}
        >
          <PlusCircle className="h-4 w-4 mr-1.5 text-green-600" /> Cash In
        </Button>
        <Button
          variant="outline"
          data-testid="btn-cash-out"
          onClick={() => setCashEventDialog("out")}
        >
          <MinusCircle className="h-4 w-4 mr-1.5 text-red-500" /> Cash Out
        </Button>
        <Button
          variant="outline"
          data-testid="btn-x-report"
          onClick={handleXReport}
          disabled={xReportLoading}
        >
          {xReportLoading
            ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            : <FileText className="h-4 w-4 mr-1.5" />
          }
          X-Report
        </Button>
      </div>

      {/* Voids */}
      {s.total_voids > 0 && (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 rounded-md px-3 py-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Voided transactions: {fmt(s.total_voids)}
        </div>
      )}

      {/* Cash in/out dialog */}
      <Dialog open={!!cashEventDialog} onOpenChange={() => setCashEventDialog(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>
              {cashEventDialog === "in" ? "Cash In (Add to drawer)" : "Cash Out (Remove from drawer)"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                <Input
                  data-testid="input-cash-event-amount"
                  className="pl-7 font-mono"
                  type="number"
                  min={0.01}
                  step={0.01}
                  placeholder="0.00"
                  value={cashEventAmount}
                  onChange={(e) => setCashEventAmount(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Note (optional)</Label>
              <Input
                data-testid="input-cash-event-note"
                placeholder="e.g. Safe drop"
                value={cashEventNote}
                onChange={(e) => setCashEventNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCashEventDialog(null)}>Cancel</Button>
            <Button
              data-testid="btn-submit-cash-event"
              onClick={submitCashEvent}
              disabled={cashEventLoading || !cashEventAmount}
            >
              {cashEventLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close shift dialog */}
      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="h-4 w-4" /> Close Shift & Z-Report
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="blind-close"
                data-testid="check-blind-close"
                checked={blindClose}
                onChange={(e) => setBlindClose(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="blind-close" className="cursor-pointer">
                Blind close (don't enter counted cash)
              </Label>
            </div>
            {!blindClose && (
              <div className="space-y-1">
                <Label>Counted cash in drawer</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                  <Input
                    data-testid="input-closing-cash"
                    className="pl-7 font-mono"
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={closingCash}
                    onChange={(e) => setClosingCash(e.target.value)}
                    autoFocus={!blindClose}
                  />
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input
                data-testid="input-close-notes"
                placeholder="Optional notes"
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
              />
            </div>
            {closeError && <p className="text-sm text-red-500">{closeError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCloseDialog(false)}>Cancel</Button>
            <Button
              data-testid="btn-confirm-close-shift"
              variant="destructive"
              onClick={handleCloseShift}
              disabled={closeLoading}
            >
              {closeLoading
                ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                : <LogOut className="h-4 w-4 mr-1.5" />
              }
              Close & Print Z-Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
