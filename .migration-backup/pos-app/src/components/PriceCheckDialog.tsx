import { useEffect, useRef, useState } from "react";
import { SearchIcon, XIcon, BarcodeIcon, MapPinIcon, Loader2Icon } from "lucide-react";
import type { Product } from "../types";
import { formatCurrency } from "../lib/pricing";
import type { PosUiTheme } from "../hooks/usePosTheme";
import type { LocationStockRow } from "../lib/db";

interface PriceCheckDialogProps {
  priceLevel: number;
  theme?: PosUiTheme;
  onSearch: (query: string) => Promise<Product[]>;
  onLookupBarcode: (barcode: string) => Promise<Product | null>;
  onGetStockByLocation?: (itemId: string) => Promise<LocationStockRow[]>;
  onClose: () => void;
}

function priceForLevel(p: Product, level: number): number {
  if (p.timed_price != null) return p.timed_price;
  const prices = [p.price1, p.price2, p.price3, p.price4, p.price5];
  return prices[level - 1] || p.price1;
}

export function PriceCheckDialog({ priceLevel, theme = "light", onSearch, onLookupBarcode, onGetStockByLocation, onClose }: PriceCheckDialogProps) {
  const isLight = theme === "light";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockRows, setStockRows] = useState<LocationStockRow[]>([]);
  const [stockError, setStockError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    setExpandedId(null);
    setStockRows([]);
    setStockError(null);
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
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, onSearch, onLookupBarcode]);

  async function toggleStock(p: Product) {
    if (expandedId === p.server_id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(p.server_id);
    setStockRows([]);
    setStockError(null);
    if (!onGetStockByLocation) return;
    setStockLoading(true);
    try {
      const rows = await onGetStockByLocation(p.server_id);
      setStockRows(rows);
    } catch (e) {
      setStockError(e instanceof Error ? e.message : "Unable to load stock");
    } finally {
      setStockLoading(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const panelClass = isLight ? "bg-white border border-slate-200" : "bg-gray-900 border border-gray-700";
  const headerTextClass = isLight ? "text-slate-700" : "text-gray-300";
  const closeBtnClass = isLight ? "text-slate-400 hover:text-slate-700" : "text-gray-600 hover:text-gray-300";
  const searchBgClass = isLight ? "bg-slate-100" : "bg-gray-800";
  const searchTextClass = isLight ? "text-slate-800 placeholder:text-slate-400" : "text-white placeholder:text-gray-500";
  const rowClass = isLight ? "border-b border-slate-100 hover:bg-slate-50" : "border-b border-gray-800 hover:bg-gray-800/60";
  const rowNameClass = isLight ? "text-slate-800" : "text-white";
  const rowSubClass = isLight ? "text-slate-400" : "text-gray-500";
  const emptyClass = isLight ? "text-slate-400" : "text-gray-600";

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm pt-16 sm:pt-0">
      <div className={`rounded-2xl w-full max-w-md shadow-2xl p-4 ${panelClass}`} data-testid="dialog-price-check">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <span className={`font-semibold text-sm flex items-center gap-2 ${headerTextClass}`}>
            <BarcodeIcon className="w-4 h-4" />
            Price Check
          </span>
          <button onClick={onClose} className={`transition-colors ${closeBtnClass}`} data-testid="button-close-price-check">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 mb-3 ${searchBgClass}`}>
          <SearchIcon className={isLight ? "w-4 h-4 text-slate-400" : "w-4 h-4 text-gray-500"} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Scan barcode or type product name…"
            className={`flex-1 bg-transparent outline-none text-sm ${searchTextClass}`}
            data-testid="input-price-check-search"
          />
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto rounded-xl">
          {loading && <div className={`text-center py-6 text-sm ${emptyClass}`}>Searching…</div>}
          {!loading && query.trim() && results.length === 0 && (
            <div className={`text-center py-6 text-sm ${emptyClass}`}>No matching products</div>
          )}
          {!loading && results.map((p) => (
            <div key={p.server_id}>
              <button
                type="button"
                onClick={() => toggleStock(p)}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-left ${rowClass}`}
                data-testid={`price-check-result-${p.server_id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium truncate ${rowNameClass}`}>{p.name}</div>
                  {p.barcode && <div className={`text-xs ${rowSubClass}`}>{p.barcode}</div>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                  <div className="text-emerald-500 font-bold text-sm">
                    {formatCurrency(priceForLevel(p, priceLevel))}
                  </div>
                  <MapPinIcon className={isLight ? "w-3.5 h-3.5 text-slate-400" : "w-3.5 h-3.5 text-gray-500"} />
                </div>
              </button>
              {expandedId === p.server_id && (
                <div
                  className={`px-3 pb-2.5 ${isLight ? "bg-slate-50" : "bg-gray-800/40"}`}
                  data-testid={`price-check-stock-${p.server_id}`}
                >
                  {stockLoading && (
                    <div className={`flex items-center gap-2 text-xs py-1.5 ${emptyClass}`}>
                      <Loader2Icon className="w-3.5 h-3.5 animate-spin" /> Loading stock by location…
                    </div>
                  )}
                  {!stockLoading && stockError && (
                    <div className="text-xs text-rose-500 py-1.5">{stockError}</div>
                  )}
                  {!stockLoading && !stockError && !onGetStockByLocation && (
                    <div className={`text-xs py-1.5 ${emptyClass}`}>Stock lookup unavailable</div>
                  )}
                  {!stockLoading && !stockError && onGetStockByLocation && stockRows.length === 0 && (
                    <div className={`text-xs py-1.5 ${emptyClass}`}>No stock recorded at any location</div>
                  )}
                  {!stockLoading && stockRows.length > 0 && stockRows.map((r) => (
                    <div
                      key={r.locationId}
                      className={`flex items-center justify-between text-xs py-1 ${headerTextClass}`}
                      data-testid={`stock-row-${r.locationId}`}
                    >
                      <span>{r.locationName}</span>
                      <span className="font-semibold">{r.quantity}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!loading && !query.trim() && (
            <div className={`text-center py-6 text-sm ${emptyClass}`}>Scan a barcode or start typing to check a price</div>
          )}
        </div>
      </div>
    </div>
  );
}
