import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { getToken } from "@/lib/auth";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Camera, ScanLine, CheckCircle2, AlertTriangle, X, Loader2, PackageCheck, WifiOff } from "lucide-react";

function draftKey(grvId: string) {
  return `pda_grv_scan_draft_${grvId}`;
}

function loadScanDraft(grvId: string): string[] {
  try {
    const raw = localStorage.getItem(draftKey(grvId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveScanDraft(grvId: string, codes: string[]) {
  localStorage.setItem(draftKey(grvId), JSON.stringify(codes));
}

function clearScanDraft(grvId: string) {
  localStorage.removeItem(draftKey(grvId));
}

interface SupplierLite { id: string; name: string; }

interface OcrLineItem {
  descriptionRaw: string;
  itemId: string | null;
  itemName: string | null;
  sku: string | null;
  barcode: string | null;
  expectedQuantity: number;
  receivedQuantity: number;
  unitCost: string;
  vatRate: string;
}

interface OcrResult {
  supplierName: string | null;
  supplierId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  rawText: string;
  lineItems: OcrLineItem[];
}

interface GrvLine {
  id: string;
  descriptionRaw: string;
  itemId: string | null;
  itemName: string | null;
  sku: string | null;
  barcode: string | null;
  expectedQuantity: number;
  receivedQuantity: number;
  unitCost: string;
  vatRate: string;
}

interface Grv {
  id: string;
  grvNumber: string;
  supplierId: string | null;
  invoiceNumberRaw: string | null;
  status: string;
  hasDiscrepancies: boolean;
  purchaseInvoiceId: string | null;
  createdAt: string;
  items: GrvLine[];
}

async function uploadInvoiceImage(file: File): Promise<OcrResult> {
  const token = getToken();
  const form = new FormData();
  form.append("image", file);
  const res = await fetch("/api/pda/invoice-ocr", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "OCR extraction failed");
  }
  return res.json();
}

export default function InvoiceImport() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingScans, setPendingScans] = useState<string[]>([]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (activeId) setPendingScans(loadScanDraft(activeId));
    else setPendingScans([]);
  }, [activeId]);

  const suppliersQuery = useQuery<SupplierLite[]>({ queryKey: ["/api/suppliers"] });
  const grvsQuery = useQuery<Grv[]>({ queryKey: ["/api/pda/grv"] });
  const activeGrvQuery = useQuery<Grv>({
    queryKey: [`/api/pda/grv/${activeId}`],
    enabled: !!activeId,
    refetchInterval: activeId ? 3000 : false,
  });

  const ocrMutation = useMutation({
    mutationFn: uploadInvoiceImage,
    onSuccess: (result) => {
      setOcrResult(result);
      setSelectedSupplierId(result.supplierId || "");
    },
    onError: (e: any) => alert(e.message || "Could not read invoice photo. Try again with better lighting."),
  });

  const createGrv = useMutation({
    mutationFn: async () => {
      if (!ocrResult) throw new Error("No invoice data");
      return apiFetch<Grv>("/api/pda/grv", {
        method: "POST",
        body: JSON.stringify({
          supplierId: selectedSupplierId || null,
          invoiceNumberRaw: ocrResult.invoiceNumber,
          invoiceDateRaw: ocrResult.invoiceDate,
          ocrRawText: ocrResult.rawText,
          items: ocrResult.lineItems,
        }),
      });
    },
    onSuccess: (grv) => {
      qc.invalidateQueries({ queryKey: ["/api/pda/grv"] });
      setOcrResult(null);
      setActiveId(grv.id);
    },
    onError: (e: any) => alert(e.message || "Could not create GRV"),
  });

  // Pushes a scanned code to the backend; if the request fails (e.g. offline),
  // the code stays buffered in localStorage (keyed by GRV) and is retried
  // automatically once connectivity returns, so an in-progress receipt is never lost.
  const scanLine = useMutation({
    mutationFn: async (code: string) => apiFetch(`/api/pda/grv/${activeId}/scan`, {
      method: "POST",
      body: JSON.stringify({ code, incrementBy: 1 }),
    }),
    onSuccess: (_data, code) => {
      qc.invalidateQueries({ queryKey: [`/api/pda/grv/${activeId}`] });
      if (!activeId) return;
      setPendingScans((prev) => {
        const idx = prev.indexOf(code);
        if (idx === -1) return prev;
        const next = [...prev.slice(0, idx), ...prev.slice(idx + 1)];
        saveScanDraft(activeId, next);
        return next;
      });
    },
    onError: (e: any, code) => {
      if (!isOnline && activeId) return;
      alert(e.message || "No matching item found for that code");
    },
  });

  function handleScan(code: string) {
    if (!activeId) return;
    if (!isOnline) {
      setPendingScans((prev) => {
        const next = [...prev, code];
        saveScanDraft(activeId, next);
        return next;
      });
      return;
    }
    scanLine.mutate(code);
  }

  // Retry any buffered scans once we're back online.
  useEffect(() => {
    if (isOnline && activeId && pendingScans.length > 0) {
      pendingScans.forEach((code) => scanLine.mutate(code));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, activeId]);

  const finalizeGrv = useMutation({
    mutationFn: async () => apiFetch(`/api/pda/grv/${activeId}/finalize`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pda/grv"] });
      qc.invalidateQueries({ queryKey: [`/api/pda/grv/${activeId}`] });
      if (activeId) clearScanDraft(activeId);
    },
    onError: (e: any) => alert(e.message || "Could not finalize GRV"),
  });

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) ocrMutation.mutate(file);
    e.target.value = "";
  }

  // ── Active GRV: receiving verification screen ──────────────────────────
  if (activeId) {
    const grv = activeGrvQuery.data;
    const allMatched = grv?.items.every((i) => i.itemId) ?? false;
    const allReceived = grv?.items.every((i) => i.receivedQuantity > 0) ?? false;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">{grv?.grvNumber || "Goods Received"}</h1>
            <p className="text-sm text-muted-foreground">Invoice {grv?.invoiceNumberRaw || "—"}</p>
          </div>
          <button onClick={() => setActiveId(null)} className="text-muted-foreground" data-testid="button-close-grv">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!isOnline && (
          <div className="flex items-center gap-2 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-lg p-2.5" data-testid="text-offline-banner">
            <WifiOff className="w-4 h-4 shrink-0" />
            You're offline — scans are being saved and will sync automatically once you're back online.
          </div>
        )}
        {isOnline && pendingScans.length > 0 && (
          <div className="flex items-center gap-2 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-lg p-2.5" data-testid="text-pending-sync-banner">
            <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
            Syncing {pendingScans.length} offline scan(s)…
          </div>
        )}

        {grv?.status === "completed" ? (
          <div className={`flex items-center gap-2 rounded-lg p-3 text-sm ${grv.hasDiscrepancies ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`} data-testid="banner-grv-status">
            {grv.hasDiscrepancies ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            {grv.hasDiscrepancies ? "Received with discrepancies — purchase invoice created." : "Fully matched — purchase invoice created."}
          </div>
        ) : (
          <>
            <div className="bg-card border border-border rounded-lg p-3 space-y-1 text-sm">
              <p className="text-muted-foreground">Scan each item as it's physically received to verify against the invoice.</p>
            </div>
            <BarcodeScanner onScan={handleScan} />
            {!allMatched && (
              <div className="flex items-center gap-2 text-warning bg-warning/10 rounded-lg p-3 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Some lines were not matched to a catalog item — match them in the back office before finalizing.
              </div>
            )}
            <button
              onClick={() => finalizeGrv.mutate()}
              disabled={finalizeGrv.isPending || !allMatched || !grv?.supplierId || pendingScans.length > 0}
              className="w-full bg-success text-success-foreground rounded-lg py-3 font-medium flex items-center justify-center gap-2 disabled:opacity-40"
              data-testid="button-finalize-grv"
            >
              {finalizeGrv.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
              Finalize & Create Purchase Invoice
            </button>
            {!grv?.supplierId && <p className="text-xs text-destructive text-center">Select a supplier before finalizing (back office).</p>}
            {pendingScans.length > 0 && <p className="text-xs text-destructive text-center">Finish syncing offline scans before finalizing.</p>}
            {!allReceived && <p className="text-xs text-muted-foreground text-center">Tip: you can finalize with partial receipts — discrepancies will be noted.</p>}
          </>
        )}

        <div className="space-y-2">
          {grv?.items.map((i) => (
            <div key={i.id} className="bg-card border border-border rounded-lg p-3" data-testid={`row-grv-line-${i.id}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{i.itemName || i.descriptionRaw}</p>
                  {!i.itemId && <p className="text-xs text-destructive">Not matched to catalog</p>}
                  {i.sku && <p className="text-xs text-muted-foreground">SKU {i.sku}</p>}
                </div>
                <div className="text-right">
                  <span className={`font-semibold text-sm ${i.receivedQuantity !== i.expectedQuantity ? "text-warning" : "text-success"}`}>
                    {i.receivedQuantity} / {i.expectedQuantity}
                  </span>
                  <p className="text-xs text-muted-foreground">@ €{i.unitCost}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── OCR review screen (after photo captured, before GRV created) ───────
  if (ocrResult) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold flex items-center gap-2"><ScanLine className="w-5 h-5" /> Review Extracted Invoice</h1>
          <button onClick={() => setOcrResult(null)} className="text-muted-foreground" data-testid="button-discard-ocr">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Supplier</label>
            <select
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
              className="w-full mt-1 rounded-lg border border-border bg-background py-2.5 px-3 text-sm"
              data-testid="select-grv-supplier"
            >
              <option value="">
                {ocrResult.supplierName ? `Select supplier (OCR read: "${ocrResult.supplierName}")` : "Select supplier"}
              </option>
              {suppliersQuery.data?.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {!selectedSupplierId && <p className="text-xs text-warning mt-1">No confident supplier match — please select one.</p>}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Invoice #</p>
              <p className="font-medium">{ocrResult.invoiceNumber || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="font-medium">{ocrResult.invoiceDate || "—"}</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Line Items ({ocrResult.lineItems.length})</h2>
          {ocrResult.lineItems.map((li, idx) => (
            <div key={idx} className="bg-card border border-border rounded-lg p-3" data-testid={`row-ocr-line-${idx}`}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{li.itemName || li.descriptionRaw}</p>
                <span className="text-sm">×{li.expectedQuantity}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                {!li.itemId ? (
                  <span className="text-xs text-destructive">No catalog match</span>
                ) : (
                  <span className="text-xs text-muted-foreground">SKU {li.sku}</span>
                )}
                <span className="text-xs text-muted-foreground">€{li.unitCost} + {li.vatRate}% VAT</span>
              </div>
            </div>
          ))}
          {ocrResult.lineItems.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No line items detected — check the photo quality and try again.</p>
          )}
        </div>

        <button
          onClick={() => createGrv.mutate()}
          disabled={createGrv.isPending || !ocrResult.lineItems.length}
          className="w-full bg-primary text-primary-foreground rounded-lg py-3 font-medium flex items-center justify-center gap-2 disabled:opacity-40"
          data-testid="button-create-grv"
        >
          {createGrv.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
          Start Receiving
        </button>
      </div>
    );
  }

  // ── Home screen: capture + recent GRVs ──────────────────────────────────
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><ScanLine className="w-5 h-5" /> Invoice Import</h1>
        <p className="text-sm text-muted-foreground">Photograph a supplier invoice to auto-extract items</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelected}
        className="hidden"
        data-testid="input-invoice-photo"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={ocrMutation.isPending}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg py-4 text-base font-medium disabled:opacity-60"
        data-testid="button-capture-invoice"
      >
        {ocrMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
        {ocrMutation.isPending ? "Reading invoice…" : "Photograph Invoice"}
      </button>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Recent Goods Received</h2>
        {grvsQuery.data?.map((g) => (
          <button
            key={g.id}
            onClick={() => setActiveId(g.id)}
            className="w-full text-left bg-card border border-border rounded-lg p-3 flex items-center justify-between"
            data-testid={`card-grv-${g.id}`}
          >
            <div>
              <p className="text-sm font-medium">{g.grvNumber}</p>
              <p className="text-xs text-muted-foreground">Invoice {g.invoiceNumberRaw || "—"}</p>
            </div>
            <span className={`text-xs rounded-full px-2 py-0.5 ${
              g.status === "completed"
                ? g.hasDiscrepancies ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
                : "bg-muted text-muted-foreground"
            }`}>
              {g.status === "completed" ? (g.hasDiscrepancies ? "Discrepancy" : "Completed") : "Receiving"}
            </span>
          </button>
        ))}
        {grvsQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No goods received vouchers yet</p>
        )}
      </div>
    </div>
  );
}
