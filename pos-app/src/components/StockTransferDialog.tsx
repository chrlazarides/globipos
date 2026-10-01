import { useEffect, useRef, useState } from "react";
import { SearchIcon, XIcon, ArrowLeftRightIcon, Trash2Icon, Loader2Icon, CheckCircle2Icon } from "lucide-react";
import type { Product } from "../types";
import type { PosLocationOption, StockTransferItemInput } from "../lib/db";
import type { PosUiTheme } from "../hooks/usePosTheme";

interface DraftLine extends StockTransferItemInput {
  key: string;
}

interface StockTransferDialogProps {
  theme?: PosUiTheme;
  cashierName?: string;
  onSearch: (query: string) => Promise<Product[]>;
  onLookupBarcode: (barcode: string) => Promise<Product | null>;
  onGetLocations: () => Promise<PosLocationOption[]>;
  onSubmit: (toLocationId: string, cashierName: string | undefined, items: StockTransferItemInput[]) => Promise<unknown>;
  onClose: () => void;
}

export function StockTransferDialog({
  theme = "light",
  cashierName,
  onSearch,
  onLookupBarcode,
  onGetLocations,
  onSubmit,
  onClose,
}: StockTransferDialogProps) {
  const isLight = theme === "light";
  const [locations, setLocations] = useState<PosLocationOption[]>([]);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [toLocationId, setToLocationId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    onGetLocations()
      .then(setLocations)
      .catch((e) => setLocationsError(e instanceof Error ? e.message : "Unable to load locations"));
  }, [onGetLocations]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const byBarcode = await onLookupBarcode(query.trim());
        if (cancelled) return;
        if (byBarcode) {
          setResults([byBarcode]);
        } else {
          const found = await onSearch(query.trim());
          if (!cancelled) setResults(found.slice(0, 20));
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, onSearch, onLookupBarcode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function addLine(p: Product) {
    const qty = parseInt(qtyDrafts[p.server_id] || "1", 10) || 1;
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === p.server_id);
      if (existing) {
        return prev.map((l) => l.itemId === p.server_id ? { ...l, quantity: l.quantity + qty } : l);
      }
      return [...prev, { key: p.server_id, itemId: p.server_id, itemName: p.name, sku: p.sku ?? null, quantity: qty }];
    });
    setQuery("");
    setResults([]);
    inputRef.current?.focus();
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  }

  async function handleSubmit() {
    if (!toLocationId || lines.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(toLocationId, cashierName, lines.map(({ key: _key, ...rest }) => rest));
      setSuccess(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setSubmitting(false);
    }
  }

  const panelClass = isLight ? "bg-white border border-slate-200" : "bg-gray-900 border border-gray-700";
  const headerTextClass = isLight ? "text-slate-700" : "text-gray-300";
  const closeBtnClass = isLight ? "text-slate-400 hover:text-slate-700" : "text-gray-600 hover:text-gray-300";
  const searchBgClass = isLight ? "bg-slate-100" : "bg-gray-800";
  const searchTextClass = isLight ? "text-slate-800 placeholder:text-slate-400" : "text-white placeholder:text-gray-500";
  const rowClass = isLight ? "border-b border-slate-100 hover:bg-slate-50" : "border-b border-gray-800 hover:bg-gray-800/60";
  const rowNameClass = isLight ? "text-slate-800" : "text-white";
  const rowSubClass = isLight ? "text-slate-400" : "text-gray-500";
  const emptyClass = isLight ? "text-slate-400" : "text-gray-600";
  const selectClass = isLight
    ? "bg-slate-100 text-slate-800 rounded-xl px-3 py-2.5 text-sm outline-none w-full"
    : "bg-gray-800 text-white rounded-xl px-3 py-2.5 text-sm outline-none w-full";

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm pt-16 sm:pt-0">
        <div className={`rounded-2xl w-full max-w-md shadow-2xl p-6 text-center ${panelClass}`} data-testid="dialog-stock-transfer-success">
          <CheckCircle2Icon className="w-10 h-10 mx-auto text-emerald-500 mb-3" />
          <p className={`text-sm font-medium mb-4 ${headerTextClass}`}>Transfer completed and stock updated.</p>
          <button
            onClick={onClose}
            className="w-full bg-emerald-600 text-white rounded-xl py-2.5 font-medium"
            data-testid="button-close-stock-transfer-success"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm pt-16 sm:pt-0">
      <div className={`rounded-2xl w-full max-w-md shadow-2xl p-4 ${panelClass}`} data-testid="dialog-stock-transfer">
        <div className="flex items-center justify-between mb-3">
          <span className={`font-semibold text-sm flex items-center gap-2 ${headerTextClass}`}>
            <ArrowLeftRightIcon className="w-4 h-4" />
            Stock Transfer
          </span>
          <button onClick={onClose} className={`transition-colors ${closeBtnClass}`} data-testid="button-close-stock-transfer">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-3">
          <label className={`text-xs mb-1 block ${rowSubClass}`}>Send stock to</label>
          {locationsError ? (
            <div className="text-xs text-rose-500">{locationsError}</div>
          ) : (
            <select
              value={toLocationId}
              onChange={(e) => setToLocationId(e.target.value)}
              className={selectClass}
              data-testid="select-transfer-destination"
            >
              <option value="">Select destination location…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 mb-3 ${searchBgClass}`}>
          <SearchIcon className={isLight ? "w-4 h-4 text-slate-400" : "w-4 h-4 text-gray-500"} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Scan barcode or type product name…"
            className={`flex-1 bg-transparent outline-none text-sm ${searchTextClass}`}
            data-testid="input-stock-transfer-search"
          />
        </div>

        <div className="max-h-40 overflow-y-auto rounded-xl mb-3">
          {searching && <div className={`text-center py-3 text-sm ${emptyClass}`}>Searching…</div>}
          {!searching && query.trim() && results.length === 0 && (
            <div className={`text-center py-3 text-sm ${emptyClass}`}>No matching products</div>
          )}
          {!searching && results.map((p) => (
            <div key={p.server_id} className={`flex items-center justify-between px-3 py-2 gap-2 ${rowClass}`} data-testid={`transfer-search-result-${p.server_id}`}>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium truncate ${rowNameClass}`}>{p.name}</div>
                {p.barcode && <div className={`text-xs ${rowSubClass}`}>{p.barcode}</div>}
              </div>
              <input
                value={qtyDrafts[p.server_id] ?? "1"}
                onChange={(e) => setQtyDrafts((prev) => ({ ...prev, [p.server_id]: e.target.value.replace(/\D/g, "") }))}
                inputMode="numeric"
                className={`w-12 text-center rounded-lg text-sm py-1 ${isLight ? "bg-slate-100" : "bg-gray-800 text-white"}`}
                data-testid={`input-transfer-qty-${p.server_id}`}
              />
              <button
                onClick={() => addLine(p)}
                className="bg-emerald-600 text-white text-xs font-medium rounded-lg px-2.5 py-1.5 flex-shrink-0"
                data-testid={`button-add-transfer-line-${p.server_id}`}
              >
                Add
              </button>
            </div>
          ))}
        </div>

        <div className="max-h-40 overflow-y-auto rounded-xl mb-3">
          {lines.length === 0 && (
            <div className={`text-center py-3 text-sm ${emptyClass}`}>No items added yet</div>
          )}
          {lines.map((l) => (
            <div key={l.key} className={`flex items-center justify-between px-3 py-2 ${rowClass}`} data-testid={`transfer-line-${l.itemId}`}>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium truncate ${rowNameClass}`}>{l.itemName}</div>
                {l.sku && <div className={`text-xs ${rowSubClass}`}>SKU {l.sku}</div>}
              </div>
              <span className={`text-sm font-semibold mr-2 ${headerTextClass}`}>×{l.quantity}</span>
              <button
                onClick={() => removeLine(l.itemId)}
                className="text-rose-500 flex-shrink-0"
                data-testid={`button-remove-transfer-line-${l.itemId}`}
              >
                <Trash2Icon className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {submitError && <div className="text-xs text-rose-500 mb-2" data-testid="text-transfer-error">{submitError}</div>}

        <button
          onClick={handleSubmit}
          disabled={submitting || !toLocationId || lines.length === 0}
          className="w-full bg-emerald-600 text-white rounded-xl py-2.5 font-medium flex items-center justify-center gap-2 disabled:opacity-40"
          data-testid="button-submit-stock-transfer"
        >
          {submitting && <Loader2Icon className="w-4 h-4 animate-spin" />}
          {submitting ? "Transferring…" : `Transfer ${lines.length} item${lines.length !== 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}
