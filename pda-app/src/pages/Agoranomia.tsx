import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Tags, AlertTriangle, CheckCircle2, Printer } from "lucide-react";

interface AuditRow {
  itemId: string;
  itemName: string;
  sku: string;
  barcode: string | null;
  volume: string | null;
  currentPrice: number;
  lastPrintedPrice: number | null;
  lastPrintedAt: string | null;
  needsReprint: boolean;
}

interface PrintedLabel {
  itemId: string;
  itemName: string;
  sku: string | null;
  printedPrice: string;
  printedUnitPrice: string | null;
  unitLabel: string | null;
}

type UnitType = "kg" | "L" | "pc" | "g" | "ml";

interface UnitConfig {
  unitType: UnitType;
  unitSize: string; // raw text input, e.g. "0.75"
}

const UNIT_OPTIONS: UnitType[] = ["pc", "kg", "g", "L", "ml"];

// Parses common shelf volume/weight strings ("750ml", "1L", "500g", "1.5 kg") into
// a best-guess unit config so staff don't have to re-enter it for every item.
function guessUnitConfig(volume: string | null | undefined): UnitConfig {
  if (!volume) return { unitType: "pc", unitSize: "1" };
  const match = volume.match(/([\d.]+)\s*(ml|l|kg|g|pc)/i);
  if (!match) return { unitType: "pc", unitSize: "1" };
  const [, size, unitRaw] = match;
  const unit = unitRaw.toLowerCase();
  if (unit === "l") return { unitType: "L", unitSize: size };
  if (unit === "ml") return { unitType: "ml", unitSize: size };
  if (unit === "kg") return { unitType: "kg", unitSize: size };
  if (unit === "g") return { unitType: "g", unitSize: size };
  return { unitType: "pc", unitSize: "1" };
}

function computeUnitPrice(currentPrice: number, config: UnitConfig): number | null {
  const size = parseFloat(config.unitSize);
  if (!size || size <= 0) return null;
  return currentPrice / size;
}

function openPrintableLabels(labels: PrintedLabel[]) {
  const win = window.open("", "_blank", "width=800,height=600");
  if (!win) return;
  const html = `<!doctype html><html><head><title>Shelf Labels</title><style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 16px; }
    .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .label { border: 1px dashed #999; border-radius: 8px; padding: 12px; text-align: center; }
    .name { font-weight: 700; font-size: 14px; margin-bottom: 6px; min-height: 34px; }
    .sku { font-size: 10px; color: #666; margin-bottom: 8px; }
    .price { font-size: 26px; font-weight: 800; }
    .unit { font-size: 12px; color: #444; margin-top: 4px; }
    @media print { .label { break-inside: avoid; } }
  </style></head><body>
  <div class="sheet">
    ${labels.map((l) => `
      <div class="label">
        <div class="name">${l.itemName}</div>
        <div class="sku">SKU ${l.sku || "—"}</div>
        <div class="price">&euro;${parseFloat(l.printedPrice).toFixed(2)}</div>
        ${l.printedUnitPrice && l.unitLabel && l.unitLabel !== "€/unit" ? `<div class="unit">&euro;${parseFloat(l.printedUnitPrice).toFixed(2)} ${l.unitLabel}</div>` : ""}
      </div>
    `).join("")}
  </div>
  <script>window.onload = () => window.print();</script>
  </body></html>`;
  win.document.write(html);
  win.document.close();
}

export default function Agoranomia() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [unitConfigs, setUnitConfigs] = useState<Record<string, UnitConfig>>({});

  const auditQuery = useQuery<AuditRow[]>({ queryKey: ["/api/pda/agoranomia/audit"] });

  const configFor = (row: AuditRow): UnitConfig =>
    unitConfigs[row.itemId] || guessUnitConfig((row as any).volume);

  function updateConfig(itemId: string, patch: Partial<UnitConfig>, row: AuditRow) {
    setUnitConfigs((prev) => ({
      ...prev,
      [itemId]: { ...configFor(row), ...prev[itemId], ...patch },
    }));
  }

  const printBatch = useMutation({
    mutationFn: async (itemIds: string[]) => {
      const overrides: Record<string, { unitType: string; unitSize: number }> = {};
      itemIds.forEach((id) => {
        const row = (auditQuery.data || []).find((r) => r.itemId === id);
        if (!row) return;
        const cfg = configFor(row);
        overrides[id] = { unitType: cfg.unitType, unitSize: parseFloat(cfg.unitSize) || 0 };
      });
      return apiFetch<PrintedLabel[]>("/api/pda/agoranomia/print-batch", {
        method: "POST",
        body: JSON.stringify({ itemIds, overrides }),
      });
    },
    onSuccess: (labels) => {
      qc.invalidateQueries({ queryKey: ["/api/pda/agoranomia/audit"] });
      setSelected(new Set());
      openPrintableLabels(labels);
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
        <p className="text-sm text-muted-foreground">Scan a shelf item to verify its unit-price label, or batch-print outdated ones with computed unit pricing</p>
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
        {needsReprint.map((row) => {
          const cfg = configFor(row);
          const unitPrice = computeUnitPrice(row.currentPrice, cfg);
          return (
            <div
              key={row.itemId}
              className="bg-card border border-border rounded-lg p-3 space-y-2"
              data-testid={`row-audit-${row.itemId}`}
            >
              <label className="flex items-center gap-3">
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
              <div className="flex items-center gap-2 pl-7 text-xs">
                <span className="text-muted-foreground">Unit size</span>
                <input
                  value={cfg.unitSize}
                  onChange={(e) => updateConfig(row.itemId, { unitSize: e.target.value.replace(/[^0-9.]/g, "") }, row)}
                  className="w-16 rounded border border-border bg-background px-2 py-1"
                  data-testid={`input-unit-size-${row.itemId}`}
                />
                <select
                  value={cfg.unitType}
                  onChange={(e) => updateConfig(row.itemId, { unitType: e.target.value as UnitType }, row)}
                  className="rounded border border-border bg-background px-2 py-1"
                  data-testid={`select-unit-type-${row.itemId}`}
                >
                  {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                {unitPrice !== null && cfg.unitType !== "pc" && (
                  <span className="text-muted-foreground" data-testid={`text-unit-price-${row.itemId}`}>
                    = €{unitPrice.toFixed(2)} / {cfg.unitType}
                  </span>
                )}
              </div>
            </div>
          );
        })}
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
