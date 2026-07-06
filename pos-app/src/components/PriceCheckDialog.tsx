import { useEffect, useRef, useState } from "react";
import { SearchIcon, XIcon, BarcodeIcon } from "lucide-react";
import type { Product } from "../types";
import { formatCurrency } from "../lib/pricing";
import type { PosUiTheme } from "../hooks/usePosTheme";

interface PriceCheckDialogProps {
  priceLevel: number;
  theme?: PosUiTheme;
  onSearch: (query: string) => Promise<Product[]>;
  onLookupBarcode: (barcode: string) => Promise<Product | null>;
  onClose: () => void;
}

function priceForLevel(p: Product, level: number): number {
  if (p.timed_price != null) return p.timed_price;
  const prices = [p.price1, p.price2, p.price3, p.price4, p.price5];
  return prices[level - 1] || p.price1;
}

export function PriceCheckDialog({ priceLevel, theme = "light", onSearch, onLookupBarcode, onClose }: PriceCheckDialogProps) {
  const isLight = theme === "light";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
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
            <div key={p.server_id} className={`flex items-center justify-between px-3 py-2.5 ${rowClass}`} data-testid={`price-check-result-${p.server_id}`}>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium truncate ${rowNameClass}`}>{p.name}</div>
                {p.barcode && <div className={`text-xs ${rowSubClass}`}>{p.barcode}</div>}
              </div>
              <div className="text-emerald-500 font-bold text-sm flex-shrink-0 ml-3">
                {formatCurrency(priceForLevel(p, priceLevel))}
              </div>
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
