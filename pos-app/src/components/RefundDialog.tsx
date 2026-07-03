/**
 * RefundDialog — return & refund flow.
 *
 * Supports:
 *  - Return by receipt number (look up original order)
 *  - Return without receipt (manual item entry)
 *  - Partial return (select lines)
 *  - Full return (all lines)
 *  - Refund method: cash, card (original method), store credit, exchange
 *
 * On confirm: saves a return order to SQLite outbox for server sync.
 * Triggers restock of returned items.
 */

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Loader2, AlertCircle, Check, Plus, Trash2 } from "lucide-react";
import { RefundIcon } from "./icons/PosIcons";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";

// ── Types ──────────────────────────────────────────────────────────────────────

interface OriginalLine {
  id: string;
  product_id?: string;
  description: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

interface OriginalOrder {
  id: string;
  order_number: string;
  total: number;
  payment_method: string;
  created_at: string;
  lines: OriginalLine[];
}

type RefundMethod = "cash" | "card" | "store_credit" | "exchange";
type Stage = "lookup" | "select_lines" | "confirm" | "done";

interface RefundDialogProps {
  open: boolean;
  cashierId: string;
  cashierName: string;
  onComplete: (refundTotal: number, method: RefundMethod) => void;
  onCancel: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function RefundDialog({
  open,
  cashierId,
  cashierName,
  onComplete,
  onCancel,
}: RefundDialogProps) {
  const [stage, setStage] = useState<Stage>("lookup");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalOrder, setOriginalOrder] = useState<OriginalOrder | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("cash");
  const [refundNotes, setRefundNotes] = useState("");

  function reset() {
    setStage("lookup");
    setReceiptNumber("");
    setOriginalOrder(null);
    setSelectedLineIds(new Set());
    setReturnQty({});
    setRefundMethod("cash");
    setRefundNotes("");
    setError(null);
  }

  // ── Lookup order ────────────────────────────────────────────────────────────

  const lookupOrder = useCallback(async () => {
    if (!receiptNumber.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const order = await invoke<OriginalOrder | null>("get_order_by_number", {
        orderNumber: receiptNumber.trim(),
      });
      if (!order) {
        setError(`Order "${receiptNumber}" not found`);
        return;
      }
      setOriginalOrder(order);
      // Pre-select all lines
      const allIds = new Set<string>(order.lines.map((l) => l.id));
      setSelectedLineIds(allIds);
      // Default qty = original qty
      const qtyMap: Record<string, number> = {};
      order.lines.forEach((l) => { qtyMap[l.id] = l.qty; });
      setReturnQty(qtyMap);
      setStage("select_lines");
    } catch (e: any) {
      setError(e?.message ?? "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [receiptNumber]);

  // ── Manual item entry (no-receipt) ─────────────────────────────────────────

  const [manualDesc, setManualDesc]   = useState("");
  const [manualQty, setManualQty]     = useState("1");
  const [manualPrice, setManualPrice] = useState("");

  function startWithoutReceipt() {
    setOriginalOrder({
      id: "",
      order_number: "NO-RECEIPT",
      total: 0,
      payment_method: "unknown",
      created_at: new Date().toISOString(),
      lines: [],
    });
    setStage("select_lines");
  }

  function addManualLine() {
    const qty   = parseFloat(manualQty)   || 1;
    const price = parseFloat(manualPrice) || 0;
    if (!manualDesc.trim() || price <= 0) return;
    const newLine: OriginalLine = {
      id:          `manual-${Date.now()}`,
      description: manualDesc.trim(),
      qty,
      unit_price:  price,
      line_total:  qty * price,
    };
    setOriginalOrder((prev) => prev
      ? { ...prev, lines: [...prev.lines, newLine] }
      : prev
    );
    // Auto-select the new line
    setSelectedLineIds((prev) => new Set([...prev, newLine.id]));
    setReturnQty((prev) => ({ ...prev, [newLine.id]: qty }));
    // Reset the entry fields
    setManualDesc("");
    setManualQty("1");
    setManualPrice("");
  }

  function removeManualLine(id: string) {
    setOriginalOrder((prev) =>
      prev ? { ...prev, lines: prev.lines.filter((l) => l.id !== id) } : prev
    );
    setSelectedLineIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setReturnQty((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }

  // ── Line selection ──────────────────────────────────────────────────────────

  function toggleLine(id: string) {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (!originalOrder) return;
    setSelectedLineIds(new Set(originalOrder.lines.map((l) => l.id)));
  }

  function selectNone() {
    setSelectedLineIds(new Set());
  }

  const selectedLines = originalOrder?.lines.filter((l) => selectedLineIds.has(l.id)) ?? [];
  const refundTotal = selectedLines.reduce(
    (s, l) => s + l.unit_price * (returnQty[l.id] ?? l.qty),
    0
  );

  // ── Confirm return ──────────────────────────────────────────────────────────

  const confirmReturn = useCallback(async () => {
    if (selectedLines.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const returnId = uuidv4();
      const returnLines = selectedLines.map((l) => ({
        id: uuidv4(),
        return_id: returnId,
        original_order_id: originalOrder?.id ?? "",
        original_line_id: l.id,
        product_id: l.product_id,
        description: l.description,
        qty: returnQty[l.id] ?? l.qty,
        unit_price: l.unit_price,
        line_total: l.unit_price * (returnQty[l.id] ?? l.qty),
      }));

      await invoke("save_return_order", {
        returnOrder: {
          id: returnId,
          original_order_id: originalOrder?.id ?? "",
          original_order_number: originalOrder?.order_number ?? "",
          cashier_id: cashierId,
          cashier_name: cashierName,
          refund_method: refundMethod,
          refund_total: refundTotal,
          notes: refundNotes,
          status: "completed",
        },
        lines: returnLines,
      });

      setStage("done");
      onComplete(refundTotal, refundMethod);
    } catch (e: any) {
      setError(e?.message ?? "Return failed");
    } finally {
      setLoading(false);
    }
  }, [selectedLines, originalOrder, cashierId, cashierName, refundMethod, refundTotal, refundNotes, returnQty, onComplete]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onCancel(); reset(); } }}>
      <DialogContent className="sm:max-w-lg" data-testid="refund-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefundIcon className="h-5 w-5 text-primary" />
            Return / Refund
          </DialogTitle>
        </DialogHeader>

        {/* Stage: lookup */}
        {stage === "lookup" && (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="receipt-no">Receipt / Order number</Label>
              <div className="flex gap-2">
                <Input
                  id="receipt-no"
                  data-testid="input-receipt-number"
                  placeholder="e.g. POS-0042"
                  value={receiptNumber}
                  onChange={(e) => setReceiptNumber(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && lookupOrder()}
                />
                <Button
                  data-testid="btn-lookup-order"
                  onClick={lookupOrder}
                  disabled={loading || !receiptNumber.trim()}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-500">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" size="sm" onClick={startWithoutReceipt} data-testid="btn-no-receipt">
                Return without receipt
              </Button>
              <Button variant="outline" onClick={() => { onCancel(); reset(); }}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Stage: select lines */}
        {stage === "select_lines" && originalOrder && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {originalOrder.order_number !== "NO-RECEIPT"
                  ? `Order ${originalOrder.order_number}`
                  : "No receipt — manual return"}
              </span>
              <div className="flex gap-2">
                <button className="text-primary hover:underline" onClick={selectAll}>All</button>
                <button className="text-muted-foreground hover:underline" onClick={selectNone}>None</button>
              </div>
            </div>

            <div className="space-y-1.5 max-h-44 overflow-y-auto">
              {originalOrder.lines.map((line) => (
                <div
                  key={line.id}
                  className="flex items-center gap-3 rounded border p-2 cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleLine(line.id)}
                  data-testid={`return-line-${line.id}`}
                >
                  <Checkbox
                    checked={selectedLineIds.has(line.id)}
                    onCheckedChange={() => toggleLine(line.id)}
                    data-testid={`check-return-line-${line.id}`}
                  />
                  <span className="flex-1 text-sm truncate">{line.description}</span>
                  <Input
                    type="number"
                    min={0.1}
                    max={line.qty}
                    step={0.1}
                    className="w-16 h-7 text-sm text-center"
                    value={returnQty[line.id] ?? line.qty}
                    onChange={(e) => setReturnQty((prev) => ({ ...prev, [line.id]: parseFloat(e.target.value) || 0 }))}
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`input-return-qty-${line.id}`}
                  />
                  <span className="text-sm font-mono w-16 text-right">
                    €{(line.unit_price * (returnQty[line.id] ?? line.qty)).toFixed(2)}
                  </span>
                  {originalOrder.order_number === "NO-RECEIPT" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeManualLine(line.id); }}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      data-testid={`btn-remove-manual-line-${line.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {originalOrder.lines.length === 0 && originalOrder.order_number === "NO-RECEIPT" && (
                <p className="text-sm text-muted-foreground text-center py-3">
                  Add items below to process the return.
                </p>
              )}
            </div>

            {/* Manual item entry — only shown for no-receipt returns */}
            {originalOrder.order_number === "NO-RECEIPT" && (
              <div className="rounded border border-dashed p-3 space-y-2 bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Add item manually
                </p>
                <div className="flex gap-2">
                  <Input
                    data-testid="input-manual-desc"
                    placeholder="Description"
                    value={manualDesc}
                    onChange={(e) => setManualDesc(e.target.value)}
                    className="flex-[3]"
                    onKeyDown={(e) => e.key === "Enter" && addManualLine()}
                  />
                  <Input
                    data-testid="input-manual-qty"
                    placeholder="Qty"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={manualQty}
                    onChange={(e) => setManualQty(e.target.value)}
                    className="w-16 text-center"
                  />
                  <div className="relative flex-[1.5]">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
                    <Input
                      data-testid="input-manual-price"
                      placeholder="0.00"
                      type="number"
                      min={0}
                      step={0.01}
                      value={manualPrice}
                      onChange={(e) => setManualPrice(e.target.value)}
                      className="pl-6"
                      onKeyDown={(e) => e.key === "Enter" && addManualLine()}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="btn-add-manual-line"
                    onClick={addManualLine}
                    disabled={!manualDesc.trim() || parseFloat(manualPrice) <= 0}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Refund method */}
            <div className="space-y-1">
              <Label>Refund method</Label>
              <Select value={refundMethod} onValueChange={(v) => setRefundMethod(v as RefundMethod)}>
                <SelectTrigger data-testid="select-refund-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card (original method)</SelectItem>
                  <SelectItem value="store_credit">Store Credit</SelectItem>
                  <SelectItem value="exchange">Exchange</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Notes</Label>
              <Input
                data-testid="input-refund-notes"
                placeholder="Reason for return (optional)"
                value={refundNotes}
                onChange={(e) => setRefundNotes(e.target.value)}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-500">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStage("lookup")}>Back</Button>
              <div className="flex-1" />
              <span className="text-sm font-semibold self-center">Refund: €{refundTotal.toFixed(2)}</span>
              <Button
                data-testid="btn-confirm-return"
                onClick={confirmReturn}
                disabled={loading || selectedLines.length === 0 || refundTotal <= 0}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefundIcon className="h-4 w-4 mr-1" />}
                Refund €{refundTotal.toFixed(2)}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Stage: done */}
        {stage === "done" && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="rounded-full bg-green-100 dark:bg-green-950 p-4">
              <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="font-semibold text-lg">Refund processed</p>
              <p className="text-muted-foreground text-sm">
                €{refundTotal.toFixed(2)} refunded via {refundMethod.replace("_", " ")}
              </p>
            </div>
            <Button
              data-testid="btn-refund-done"
              onClick={() => { onCancel(); reset(); }}
              className="mt-2"
            >
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
