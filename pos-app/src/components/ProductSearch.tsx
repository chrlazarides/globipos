import { useState, useEffect, useRef, useCallback } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import type { Product } from "../types";
import { getProducts } from "../lib/db";
import { formatCurrency } from "../lib/pricing";

interface ProductSearchProps {
  priceLevel: number;
  onSelect: (product: Product) => void;
}

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

export function ProductSearch({ priceLevel, onSelect }: ProductSearchProps) {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<Product[]>([]);
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(
    debounce(async (q: string) => {
      if (q.trim().length < 1) { setResults([]); return; }
      setLoading(true);
      try {
        const res = await getProducts(undefined, q.trim());
        setResults(res);
        setOpen(res.length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250) as (q: string) => void,
    []
  );

  useEffect(() => { search(query); }, [query, search]);

  function handleSelect(p: Product) {
    onSelect(p);
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  }

  function priceForLevel(p: Product): number {
    if (p.timed_price != null) return p.timed_price;
    const prices = [p.price1, p.price2, p.price3, p.price4, p.price5];
    return prices[priceLevel - 1] || p.price1;
  }

  return (
    <div className="relative">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search product, SKU or barcode…"
          className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-burgundy-500 placeholder:text-gray-600"
          data-testid="input-product-search"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); setOpen(false); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-h-72 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-3 text-gray-500 text-sm">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-gray-500 text-sm">No products found</div>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelect(p)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800 transition-colors text-left border-b border-gray-800 last:border-0"
                data-testid={`search-result-${p.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium truncate">{p.name}</div>
                  <div className="text-gray-500 text-xs">{p.sku}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-burgundy-400 font-semibold text-sm">
                    {formatCurrency(priceForLevel(p))}
                  </div>
                  {p.timed_price != null && (
                    <div className="text-amber-400 text-xs">Promo</div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
