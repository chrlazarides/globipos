import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { type BasketItem } from "./Basket";
import { type CustomerSession } from "../lib/auth";
import { cn } from "../lib/cn";
import { Search, ScanBarcode, Plus, Minus, X, Package, ChevronDown } from "lucide-react";

interface CatalogProps {
  customer: CustomerSession;
  basket: BasketItem[];
  setBasket: React.Dispatch<React.SetStateAction<BasketItem[]>>;
}

interface CatalogItem {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  brand: string | null;
  origin: string | null;
  volume: string | null;
  unitType: string;
  packSize: number;
  stockQuantity: number;
  customerPrice: number;
  vatRate: string;
}

interface Category { id: string; name: string; }

export default function Catalog({ customer, basket, setBasket }: CatalogProps) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const [scanMode, setScanMode] = useState(false);
  const [scanError, setScanError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const scanningRef = useRef(false);

  const params = new URLSearchParams({ page: String(page), limit: "48" });
  if (search) params.set("search", search);
  if (categoryId) params.set("categoryId", categoryId);

  const { data, isLoading } = useQuery<{ items: CatalogItem[]; total: number; categories: Category[] }>({
    queryKey: [`/api/customer/catalog?${params}`],
    staleTime: 1000 * 60 * 5,
  });

  const items = data?.items || [];
  const categories = data?.categories || [];
  const total = data?.total || 0;
  const pageCount = Math.ceil(total / 48);

  function getQty(id: string) { return basket.find((b) => b.item.id === id)?.quantity || 0; }

  function add(item: CatalogItem) {
    setBasket((prev) => {
      const ex = prev.find((b) => b.item.id === item.id);
      if (ex) return prev.map((b) => b.item.id === item.id ? { ...b, quantity: b.quantity + 1 } : b);
      return [...prev, { item, quantity: 1 }];
    });
  }

  function dec(id: string) {
    setBasket((prev) => prev.map((b) => b.item.id === id ? { ...b, quantity: b.quantity - 1 } : b).filter((b) => b.quantity > 0));
  }

  const startScan = useCallback(async () => {
    setScanError("");
    setScanMode(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      if ("BarcodeDetector" in window) {
        const BarcodeDetector = (window as any).BarcodeDetector;
        detectorRef.current = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"] });
        scanningRef.current = true;
        const tick = async () => {
          if (!scanningRef.current || !videoRef.current) return;
          try {
            const barcodes = await detectorRef.current.detect(videoRef.current);
            if (barcodes.length > 0) {
              const bc = barcodes[0].rawValue;
              stopScan();
              // Look up item by barcode
              try {
                const res = await fetch(`/api/customer/barcode/${encodeURIComponent(bc)}`, {
                  headers: { Authorization: `Bearer ${localStorage.getItem("globi_customer_token")}` },
                });
                if (res.ok) {
                  const found = await res.json();
                  add(found);
                  setSearch(found.name);
                } else {
                  setScanError(`Barcode ${bc} not found in catalog`);
                }
              } catch { setScanError("Failed to look up barcode"); }
              return;
            }
          } catch {}
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } else {
        setScanError("Your browser doesn't support native barcode scanning. Enter barcode manually.");
      }
    } catch {
      setScanError("Camera access denied. Please enter the barcode manually.");
      setScanMode(false);
    }
  }, []);

  function stopScan() {
    scanningRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanMode(false);
  }

  const fmt = (v: number) => `€${v.toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Shop</h1>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Browse our catalog and add items to your basket</p>
      </div>

      {/* Search + scan row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search products…"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            data-testid="input-catalog-search"
          />
        </div>
        <button
          onClick={scanMode ? stopScan : startScan}
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-lg border transition-colors",
            scanMode
              ? "bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white"
              : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
          )}
          title="Scan barcode"
          data-testid="button-scan-barcode"
        >
          <ScanBarcode className="w-4 h-4" />
        </button>
      </div>

      {/* Camera preview for barcode scan */}
      {scanMode && (
        <div className="relative rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-black aspect-video">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-32 border-2 border-white rounded-lg opacity-60" />
          </div>
          <button
            onClick={stopScan}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white"
          >
            <X className="w-4 h-4" />
          </button>
          <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-white/80">
            Point camera at barcode
          </p>
        </div>
      )}
      {scanError && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg">{scanError}</p>
      )}

      {/* Category chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => { setCategoryId(""); setPage(1); }}
          className={cn(
            "flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
            categoryId === ""
              ? "text-white border-transparent"
              : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
          )}
          style={categoryId === "" ? { background: "hsl(var(--primary))", borderColor: "hsl(var(--primary))" } : {}}
          data-testid="button-cat-all"
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => { setCategoryId(cat.id); setPage(1); }}
            className={cn(
              "flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              categoryId === cat.id
                ? "text-white border-transparent"
                : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
            )}
            style={categoryId === cat.id ? { background: "hsl(var(--primary))", borderColor: "hsl(var(--primary))" } : {}}
            data-testid={`button-cat-${cat.id}`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Product grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-36 rounded-xl bg-[hsl(var(--muted))] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-[hsl(var(--muted-foreground))]">
          <Package className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">No products found</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => {
            const qty = getQty(item.id);
            return (
              <div
                key={item.id}
                className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-3 flex flex-col gap-2"
                data-testid={`card-product-${item.id}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold leading-tight line-clamp-2" data-testid={`text-product-name-${item.id}`}>
                    {item.name}
                  </p>
                  {item.brand && (
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">{item.brand}</p>
                  )}
                  {item.volume && (
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{item.volume}</p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-bold" data-testid={`text-product-price-${item.id}`}>
                    {fmt(item.customerPrice)}
                  </span>
                  {qty === 0 ? (
                    <button
                      onClick={() => add(item)}
                      disabled={item.stockQuantity <= 0}
                      className="flex items-center justify-center w-7 h-7 rounded-full text-white disabled:opacity-40 transition-opacity"
                      style={{ background: "hsl(var(--primary))" }}
                      data-testid={`button-add-${item.id}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button onClick={() => dec(item.id)} className="w-6 h-6 rounded-full border border-[hsl(var(--border))] flex items-center justify-center">
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-bold w-4 text-center tabular-nums">{qty}</span>
                      <button onClick={() => add(item)} className="w-6 h-6 rounded-full flex items-center justify-center text-white" style={{ background: "hsl(var(--primary))" }}>
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                {item.stockQuantity <= 0 && (
                  <span className="text-[10px] text-red-500 font-medium">Out of stock</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-xs rounded-lg border border-[hsl(var(--border))] disabled:opacity-40 hover:bg-[hsl(var(--muted))] transition-colors"
          >
            Prev
          </button>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {page} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page === pageCount}
            className="px-3 py-1.5 text-xs rounded-lg border border-[hsl(var(--border))] disabled:opacity-40 hover:bg-[hsl(var(--muted))] transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
