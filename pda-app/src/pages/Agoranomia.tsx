import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Tags, AlertTriangle, CheckCircle2, Printer } from "lucide-react";

interface AuditRow {
  itemId: string;
  itemName: string;
  sku: string;
  barcode: string | null;
  currentPrice: number;
  lastPrintedPrice: number | null;
  lastPrintedAt: string | null;
  needsReprint: boolean;
}

export default function Agoranomia() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const auditQuery = useQuery<AuditRow[]>({ queryKey: ["/api/pda/agoranomia/audit"] });

  const printBatch = useMutation({
    mutationFn: async (itemIds: string[]) => apiFetch("/api/pda/agoranomia/print-batch", { method: "POST", body: JSON.stringify({ itemIds }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pda/agoranomia/audit"] });
      setSelected(new Set());
    },
  });

  const scanLookup = useMutation({
    mutationFn: async (code: string) => {
      const rows = auditQuery.data || [];
      const row = rows.find((r) => r.barcode === code || r.sku === code);
      if (!row) throw new Error("not found");
      return row;
    },
    onSuccess: (row) => {
      setScanMessage(row.needsReprint
        ? `${row.itemName}: shelf price is OUTDATED (last printed €${row.lastPrintedPrice?.toFixed(2) ?? "—"}, now €${row.currentPrice.toFixed(2)})`
        : `${row.itemName}: shelf price label is up to date (€${row.currentPrice.toFixed(2)})`);
    },
    onError: () => setScanMessage("No item found for that scan."),
  });

  const needsReprint = (auditQuery.data || []).filter((r) => r.needsReprint);
  const compliant = (auditQuery.data || []).filter((r) => !r.needsReprint);

  function toggle(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><Tags className="w-5 h-5" /> Agoranomia — Shelf Labels</h1>
        <p className="text-sm text-muted-foreground">Scan a shelf item to verify its unit-price label, or batch-print outdated ones</p>
      </div>

      <BarcodeScanner onScan={(code) => scanLookup.mutate(code)} />

      {scanMessage && (
        <div className="text-sm bg-muted rounded-lg p-3" data-testid="text-scan-message">{scanMessage}</div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-1.5 text-destructive">
          <AlertTriangle className="w-4 h-4" /> Needs Reprint ({needsReprint.length})
        </h2>
        {selected.size > 0 && (
          <button
            onClick={() => printBatch.mutate(Array.from(selected))}
            disabled={printBatch.isPending}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs rounded-lg px-3 py-1.5"
            data-testid="button-print-batch"
          >
            <Printer className="w-3.5 h-3.5" /> Print {selected.size} Label{selected.size !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {needsReprint.map((row) => (
          <label
            key={row.itemId}
            className="flex items-center gap-3 bg-card border border-border rounded-lg p-3"
            data-testid={`row-audit-${row.itemId}`}
          >
            <input
              type="checkbox"
              checked={selected.has(row.itemId)}
              onChange={() => toggle(row.itemId)}
              className="w-4 h-4"
              data-testid={`checkbox-audit-${row.itemId}`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{row.itemName}</p>
              <p className="text-xs text-muted-foreground">
                SKU {row.sku} · Label: {row.lastPrintedPrice !== null ? `€${row.lastPrintedPrice.toFixed(2)}` : "never printed"} → Now: €{row.currentPrice.toFixed(2)}
              </p>
            </div>
          </label>
        ))}
        {needsReprint.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-3">All shelf labels are up to date.</p>
        )}
      </div>

      <h2 className="text-sm font-semibold flex items-center gap-1.5 text-success pt-2">
        <CheckCircle2 className="w-4 h-4" /> Compliant ({compliant.length})
      </h2>
    </div>
  );
}
