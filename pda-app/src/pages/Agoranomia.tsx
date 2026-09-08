import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Tags, AlertTriangle, CheckCircle2, Printer, CalendarDays } from "lucide-react";

interface AuditRow {
  itemId: string;
  itemName: string;
  sku: string;
  barcode: string | null;
  volume: string | null;
  shelfLabelUomEnabled: boolean;
  shelfLabelQuantity: string | null;
  shelfLabelUnit: UnitType | null;
  shelfLabelDiscountEnabled: boolean;
  shelfLabelPreviousPrice: number | null;
  shelfLabelPreviousPriceVerifiedAt: string | null;
  shelfLabelPreviousPriceProvenance: string | null;
  currentPrice: number;
  lastPrintedPrice: number | null;
  lastPrintedAt: string | null;
  needsReprint: boolean;
}

interface PrintedLabel {
  itemId: string;
  itemName: string;
  sku: string | null;
  barcode: string | null;
  volume: string | null;
  printedPrice: string;
  printedUnitPrice: string | null;
  printedPreviousPrice: string | null;
  printedPreviousUnitPrice: string | null;
  discountPercentage: string | null;
  discountVerifiedAt: string | null;
  discountProvenance: string | null;
  unitLabel: string | null;
  expirationDate: string | null;
}

type UnitType = "kg" | "L" | "pc" | "g" | "ml" | "m" | "m2" | "m3";

interface UnitConfig {
  unitType: UnitType;
  unitSize: string;
}

const UNIT_OPTIONS: UnitType[] = ["pc", "kg", "g", "L", "ml", "m", "m2", "m3"];
const UNIT_LABELS: Record<UnitType, string> = {
  pc: "Piece / item (€/item)",
  kg: "Kilogram (€/kg)",
  g: "Gram pack (€/kg)",
  L: "Litre (€/L)",
  ml: "Millilitre pack (€/L)",
  m: "Metre (€/m)",
  m2: "Square metre (€/m²)",
  m3: "Cubic metre (€/m³)",
};

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

/**
 * EU-style reference unit pricing:
 *   g  → per kg      (price ÷ size × 1000)
 *   ml → per L
 *   kg → per kg      (price ÷ size)
 *   L  → per L
 *   pc → per item
 *   m/m²/m³ → per standard unit
 */
function computeUnitPrice(currentPrice: number, config: UnitConfig): { unitPrice: number | null; unitLabel: string } {
  const size = parseFloat(config.unitSize);
  if (!size || size <= 0) return { unitPrice: null, unitLabel: "" };
  if (config.unitType === "g")  return { unitPrice: (currentPrice / size) * 1000, unitLabel: "/ kg" };
  if (config.unitType === "ml") return { unitPrice: (currentPrice / size) * 1000, unitLabel: "/ L" };
  if (config.unitType === "kg") return { unitPrice: currentPrice / size, unitLabel: "/ kg" };
  if (config.unitType === "L")  return { unitPrice: currentPrice / size, unitLabel: "/ L" };
  if (config.unitType === "pc") return { unitPrice: currentPrice / size, unitLabel: "/ item" };
  if (config.unitType === "m2") return { unitPrice: currentPrice / size, unitLabel: "/ m²" };
  if (config.unitType === "m3") return { unitPrice: currentPrice / size, unitLabel: "/ m³" };
  return { unitPrice: currentPrice / size, unitLabel: "/ m" };
}

/** Format ISO date string (YYYY-MM-DD) → DD/MM/YYYY for display */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function openPrintableLabels(labels: PrintedLabel[]) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  const html = `<!doctype html><html><head><title>Shelf Labels</title><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #f5f5f5; padding: 16px; }
    .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .label {
      background: #fff;
      border: 1.5px solid #ccc;
      border-radius: 8px;
      padding: 14px 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      break-inside: avoid;
    }
    .product-name {
      font-weight: 700;
      font-size: 13px;
      line-height: 1.3;
      color: #111;
      border-bottom: 1px solid #eee;
      padding-bottom: 6px;
      margin-bottom: 2px;
    }
    .product-name .vol { font-weight: 400; color: #555; }
    .row { display: flex; justify-content: space-between; align-items: baseline; gap: 4px; }
    .row-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.03em; flex-shrink: 0; }
    .row-value { font-size: 12px; font-weight: 600; color: #111; text-align: right; }
    .price-row .row-value { font-size: 22px; font-weight: 800; color: #111; }
    .offer-row { background: #fff1e6; border: 1px solid #fdba74; border-radius: 4px; padding: 4px 6px; }
    .offer-row .row-label, .offer-row .row-value { color: #9a3412; font-weight: 800; }
    .prior-row .row-value, .prior-unit-row .row-value { text-decoration: line-through; }
    .unit-price-row { background: #f8f8f8; border-radius: 4px; padding: 4px 6px; }
    .unit-price-row .row-label { color: #444; }
    .unit-price-row .row-value { font-size: 13px; color: #222; }
    .exp-row { background: #fff8e1; border: 1px solid #ffe082; border-radius: 4px; padding: 4px 6px; }
    .exp-row .row-label { color: #7a5c00; }
    .exp-row .row-value { color: #5c3d00; font-size: 13px; }
    .plu-row { border-top: 1px solid #eee; margin-top: 3px; padding-top: 4px; }
    .plu-row .row-value { font-family: monospace; font-size: 11px; letter-spacing: 0.05em; }
    @media print {
      body { background: none; padding: 0; }
      .label { border-color: #bbb; break-inside: avoid; }
    }
  </style></head><body>
  <div class="sheet">
    ${labels.map((l) => {
      const plu = l.barcode || l.sku || "—";
      const vol = l.volume || null;
      const expDisplay = l.expirationDate ? formatDate(l.expirationDate) : null;
      const provenance = l.discountProvenance === "recorded_30_day_low"
        ? "Recorded 30-day price history"
        : l.discountProvenance === "staff_attested_legacy_period"
          ? "Staff-attested legacy period"
          : null;
      return `
      <div class="label">
        <div class="product-name">${l.itemName}${vol ? ` <span class="vol">${vol}</span>` : ""}</div>
        ${l.printedPreviousPrice
          ? `<div class="row offer-row">
               <span class="row-label">ΠΡΟΣΦΟΡΑ / OFFER</span>
               <span class="row-value">-${parseFloat(l.discountPercentage || "0").toFixed(0)}%</span>
             </div>
             <div class="row prior-row">
               <span class="row-label">Προγενέστερη Τιμή / Prior Price</span>
               <span class="row-value">&euro;${parseFloat(l.printedPreviousPrice).toFixed(2)}</span>
             </div>`
          : ""}
        <div class="row price-row">
          <span class="row-label">${l.printedPreviousPrice ? "Τιμή Προσφοράς / Sale Price" : "Price"}</span>
          <span class="row-value">&euro;${parseFloat(l.printedPrice).toFixed(2)}</span>
        </div>
        ${l.printedUnitPrice && l.unitLabel && l.unitLabel !== "€/unit"
          ? `<div class="row unit-price-row">
               <span class="row-label">Μοναδιαία Τιμή / Unit Price</span>
               <span class="row-value">&euro;${parseFloat(l.printedUnitPrice).toFixed(2)} ${l.unitLabel}</span>
             </div>`
          : ""}
        ${l.printedPreviousUnitPrice && l.unitLabel
          ? `<div class="row prior-unit-row">
               <span class="row-label">Προγενέστερη Μοναδιαία Τιμή / Prior Unit Price</span>
               <span class="row-value">&euro;${parseFloat(l.printedPreviousUnitPrice).toFixed(2)} ${l.unitLabel}</span>
             </div>`
          : ""}
        ${provenance
          ? `<div class="row provenance-row">
               <span class="row-label">Έλεγχος / Verification</span>
               <span class="row-value">${provenance}</span>
             </div>`
          : ""}
        ${vol
          ? `<div class="row">
               <span class="row-label">Unit</span>
               <span class="row-value">${vol}</span>
             </div>`
          : ""}
        ${expDisplay
          ? `<div class="row exp-row">
               <span class="row-label">Best Before</span>
               <span class="row-value">${expDisplay}</span>
             </div>`
          : ""}
        <div class="row plu-row">
          <span class="row-label">PLU</span>
          <span class="row-value">${plu}</span>
        </div>
      </div>
    `}).join("")}
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
  const [expirationDates, setExpirationDates] = useState<Record<string, string>>({});

  const auditQuery = useQuery<AuditRow[]>({ queryKey: ["/api/pda/agoranomia/audit"] });

  const configFor = (row: AuditRow): UnitConfig =>
    row.shelfLabelUomEnabled && row.shelfLabelUnit && Number(row.shelfLabelQuantity) > 0
      ? { unitType: row.shelfLabelUnit, unitSize: String(row.shelfLabelQuantity) }
      : { unitType: "pc", unitSize: "1" };

  const printBatch = useMutation({
    mutationFn: async (itemIds: string[]) => {
      const overrides: Record<string, { expirationDate?: string }> = {};
      itemIds.forEach((id) => {
        const row = (auditQuery.data || []).find((r) => r.itemId === id);
        if (!row) return;
        overrides[id] = {
          expirationDate: expirationDates[id] || undefined,
        };
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
          const { unitPrice, unitLabel } = computeUnitPrice(row.currentPrice, cfg);
          const previousUnitPrice = row.shelfLabelDiscountEnabled && row.shelfLabelPreviousPrice !== null
            ? computeUnitPrice(row.shelfLabelPreviousPrice, cfg).unitPrice
            : null;
          const provenance = row.shelfLabelPreviousPriceProvenance === "recorded_30_day_low"
            ? "Recorded 30-day history"
            : row.shelfLabelPreviousPriceProvenance === "staff_attested_legacy_period"
              ? "Staff-attested legacy period"
              : null;
          const expDate = expirationDates[row.itemId] || "";
          const expDisplay = formatDate(expDate);

          return (
            <div
              key={row.itemId}
              className="bg-card border border-border rounded-lg p-3 space-y-2"
              data-testid={`row-audit-${row.itemId}`}
            >
              {/* Item header + checkbox */}
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(row.itemId)}
                  onChange={() => toggle(row.itemId)}
                  className="w-4 h-4"
                  data-testid={`checkbox-audit-${row.itemId}`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {row.itemName}
                    {row.volume && <span className="font-normal text-muted-foreground"> {row.volume}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    SKU {row.sku} · Label: {row.lastPrintedPrice !== null ? `€${row.lastPrintedPrice.toFixed(2)}` : "never printed"} → Now: €{row.currentPrice.toFixed(2)}
                  </p>
                </div>
              </label>

              {/* Unit pricing is authoritative from Item Details */}
              <div className="flex items-center gap-2 pl-7 text-xs flex-wrap">
                <span className="text-muted-foreground">Item Details UOM: {cfg.unitSize} {UNIT_LABELS[cfg.unitType]}</span>
                {unitPrice !== null && (
                  <span className="text-muted-foreground font-medium" data-testid={`text-unit-price-${row.itemId}`}>
                    = €{unitPrice.toFixed(2)} {unitLabel}
                  </span>
                )}
              </div>

              {/* Expiration date */}
              <div className="flex items-center gap-2 pl-7 text-xs">
                <CalendarDays className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                <span className="text-muted-foreground">Best Before</span>
                <input
                  type="date"
                  value={expDate}
                  onChange={(e) => setExpirationDates(prev => ({ ...prev, [row.itemId]: e.target.value }))}
                  className="rounded border border-border bg-background px-2 py-1 text-xs"
                  data-testid={`input-expiry-${row.itemId}`}
                />
                {expDate && (
                  <span className="text-amber-700 font-medium">{expDisplay}</span>
                )}
              </div>

              {/* Live label preview */}
              <div className="pl-7">
                <div className="inline-block border border-dashed border-border rounded-md px-3 py-2 text-[11px] leading-relaxed bg-muted/30 min-w-[190px]">
                  <div className="font-bold text-[12px]">
                    {row.itemName}
                    {row.volume ? <span className="font-normal text-muted-foreground"> {row.volume}</span> : null}
                  </div>
                  <div className="flex justify-between gap-4 mt-1">
                    <span className="text-muted-foreground text-[9px] tracking-wide">{row.shelfLabelDiscountEnabled ? "Τιμή Προσφοράς / Sale Price" : "Price"}</span>
                    <span className="font-extrabold text-base">€{row.currentPrice.toFixed(2)}</span>
                  </div>
                  {row.shelfLabelDiscountEnabled && row.shelfLabelPreviousPrice !== null && (
                    <>
                      <div className="flex justify-between gap-4 rounded bg-orange-100 px-1 py-0.5 text-orange-800">
                        <span className="font-bold text-[9px]">ΠΡΟΣΦΟΡΑ / OFFER</span>
                        <span className="font-bold">-{(((row.shelfLabelPreviousPrice - row.currentPrice) / row.shelfLabelPreviousPrice) * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground text-[9px]">Προγενέστερη Τιμή / Prior Price</span>
                        <span className="line-through">€{row.shelfLabelPreviousPrice.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                  {unitPrice !== null && (
                    <div className="flex justify-between gap-4 bg-muted rounded px-1 py-0.5 mt-0.5">
                       <span className="text-muted-foreground text-[9px] tracking-wide">Μοναδιαία Τιμή / Unit Price</span>
                      <span className="font-semibold">€{unitPrice.toFixed(2)} {unitLabel}</span>
                    </div>
                  )}
                  {previousUnitPrice !== null && (
                    <div className="flex justify-between gap-4 px-1 py-0.5">
                      <span className="text-muted-foreground text-[9px]">Προγενέστερη Μοναδιαία Τιμή / Prior Unit Price</span>
                      <span className="line-through">€{previousUnitPrice.toFixed(2)} {unitLabel}</span>
                    </div>
                  )}
                  {row.shelfLabelDiscountEnabled && provenance && (
                    <div className="flex justify-between gap-4 rounded bg-slate-100 px-1 py-0.5">
                      <span className="text-muted-foreground text-[9px]">Έλεγχος / Verification</span>
                      <span className="font-medium text-[9px]">{provenance}</span>
                    </div>
                  )}
                  {row.volume && (
                    <div className="flex justify-between gap-4 mt-0.5">
                      <span className="text-muted-foreground uppercase text-[9px] tracking-wide">Unit</span>
                      <span>{row.volume}</span>
                    </div>
                  )}
                  {expDate && (
                    <div className="flex justify-between gap-4 mt-0.5 bg-amber-50 rounded px-1 py-0.5 border border-amber-200">
                      <span className="text-amber-800 uppercase text-[9px] tracking-wide">Best Before</span>
                      <span className="font-semibold text-amber-900">{expDisplay}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-4 border-t border-border mt-1 pt-1">
                    <span className="text-muted-foreground uppercase text-[9px] tracking-wide">PLU</span>
                    <span className="font-mono">{row.barcode || row.sku || "—"}</span>
                  </div>
                </div>
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
