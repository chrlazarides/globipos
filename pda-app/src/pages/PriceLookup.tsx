import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Search, Wine, AlertTriangle, Package } from "lucide-react";

interface ItemResult {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price1: string; price2: string; price3: string; price4: string; price5: string;
  costPrice: string;
  stockQuantity: number;
  packSize: number;
  unitType: string;
  volume: string | null;
  brand: string | null;
  vintage: string | null;
}

const PRICE_LABELS = ["Retail (1)", "Level 2", "Level 3", "Level 4", "Wholesale (5)"];

export default function PriceLookup() {
  const [manualQuery, setManualQuery] = useState("");
  const [item, setItem] = useState<ItemResult | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);

  const lookupMutation = useMutation({
    mutationFn: async (code: string) => apiFetch<ItemResult>(`/api/items/barcode/${encodeURIComponent(code)}`),
    onSuccess: (data) => { setItem(data); setNotFound(null); },
    onError: () => { setItem(null); setNotFound("No item found for that barcode."); },
  });

  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      const all = await apiFetch<ItemResult[]>("/api/items");
      const q = query.toLowerCase();
      const match = all.find(
        (i) => i.sku.toLowerCase() === q || i.name.toLowerCase().includes(q)
      );
      if (!match) throw new Error("not found");
      return match;
    },
    onSuccess: (data) => { setItem(data); setNotFound(null); },
    onError: () => { setItem(null); setNotFound("No item found matching that search."); },
  });

  function handleScan(code: string) {
    lookupMutation.mutate(code);
  }

  function handleNameSearch(query: string) {
    searchMutation.mutate(query);
  }

  const prices = item ? [item.price1, item.price2, item.price3, item.price4, item.price5] : [];
  const bottlesPerPack = item?.packSize || 1;
  const packs = item ? Math.floor(item.stockQuantity / bottlesPerPack) : 0;
  const loosePieces = item ? item.stockQuantity % bottlesPerPack : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><Search className="w-5 h-5" /> Price Look-Up</h1>
        <p className="text-sm text-muted-foreground">Scan or enter a barcode to see full price levels and stock</p>
      </div>

      <BarcodeScanner onScan={handleScan} />

      {lookupMutation.isPending && (
        <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-looking-up">Looking up item…</p>
      )}

      {notFound && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-lg p-3" data-testid="text-not-found">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {notFound}
        </div>
      )}

      {item && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-4" data-testid="card-item-result">
          <div className="flex items-start gap-3">
            <div className="bg-primary/10 rounded-lg p-2">
              <Wine className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-base leading-tight" data-testid="text-item-name">{item.name}</h2>
              <p className="text-xs text-muted-foreground">
                SKU {item.sku} {item.volume && `· ${item.volume}`} {item.vintage && `· ${item.vintage}`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            {prices.map((p, i) => (
              <div key={i} className="flex justify-between items-center py-1.5 px-3 rounded-lg bg-muted">
                <span className="text-sm text-muted-foreground">{PRICE_LABELS[i]}</span>
                <span className="font-semibold" data-testid={`text-price-${i + 1}`}>€{parseFloat(p).toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Package className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm" data-testid="text-stock">
              <strong>{item.stockQuantity}</strong> {item.unitType}(s) in stock
              {bottlesPerPack > 1 && ` · ${packs} pack(s) + ${loosePieces} loose`}
            </span>
          </div>
        </div>
      )}

      <div className="pt-2">
        <input
          value={manualQuery}
          onChange={(e) => setManualQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && manualQuery.trim()) {
              handleNameSearch(manualQuery.trim());
              setManualQuery("");
            }
          }}
          placeholder="Search by SKU or name instead"
          className="w-full rounded-lg border border-border bg-card py-3 px-3 text-sm"
          data-testid="input-search-name"
        />
      </div>
    </div>
  );
}
