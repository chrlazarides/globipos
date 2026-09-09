import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { type BasketItem } from "./Basket";
import { type CustomerSession } from "../lib/auth";
import { cn } from "../lib/cn";
import { Search, ScanBarcode, Plus, Minus, X, Package, ChevronDown } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { type ScaleBarcode } from "../lib/scaleBarcode";
import { apiFetch } from "../lib/queryClient";
import type { BrandingConfig } from "../lib/branding";

interface CatalogProps {
  customer: CustomerSession;
  basket: BasketItem[];
  setBasket: React.Dispatch<React.SetStateAction<BasketItem[]>>;
  branding?: BrandingConfig;
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
  imageUrl?: string | null;
  imageThumbnailUrl?: string | null;
  imageCardUrl?: string | null;
  imageFullUrl?: string | null;
}

interface Category { id: string; name: string; }

export default function Catalog({ customer, basket, setBasket, branding }: CatalogProps) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const [scanMode, setScanMode] = useState(false);
  const [scanError, setScanError] = useState("");
  const [manualBarcode, setManualBarcode] = useState("");
  const [basketFeedback, setBasketFeedback] = useState("");
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

  function getQty(id: string) { return basket.filter((b) => b.item.id === id).reduce((sum, b) => sum + b.quantity, 0); }

  function add(item: CatalogItem, quantity = 1, barcode?: string) {
    setBasket((prev) => {
      // A scale label is one immutable scan occurrence. Keeping each occurrence
      // separate lets the server validate and total duplicate labels individually.
      if (barcode) return [...prev, { item, quantity, barcode }];
      const ex = prev.find((b) => b.item.id === item.id && b.barcode === barcode);
      if (ex) return prev.map((b) => b === ex ? { ...b, quantity: b.quantity + quantity } : b);
      return [...prev, { item, quantity, barcode }];
    });
    setBasketFeedback(`${item.name} added to basket`);
    window.setTimeout(() => setBasketFeedback(""), 1800);
  }

  function dec(id: string) {
    setBasket((prev) => prev.map((b) => b.item.id === id && !b.barcode ? { ...b, quantity: b.quantity - 1 } : b).filter((b) => b.quantity > 0));
  }

  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);

  async function lookupBarcode(bc: string) {
    try {
      const found = await apiFetch<CatalogItem & { scaleBarcode?: ScaleBarcode | null }>(`/api/customer/barcode/${encodeURIComponent(bc)}`);
      const scale = found.scaleBarcode || null;
      const item = scale?.type === "price" && scale.value > 0
        ? { ...found, customerPrice: Number(scale.value.toFixed(2)) }
        : found;
      add(item, scale?.type === "weight" && scale.value > 0 ? Number(scale.value.toFixed(3)) : 1, scale ? bc : undefined);
      setSearch(found.name);
      setManualBarcode("");
    } catch (error: any) {
      setScanError(error?.status === 404 ? `Barcode ${bc} not found in catalog` : (error?.message || "Failed to look up barcode"));
    }
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
        // Chrome / Android native BarcodeDetector
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
              await lookupBarcode(bc);
              return;
            }
          } catch {}
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } else {
        // iOS Safari fallback — use ZXing
        try {
          const reader = new BrowserMultiFormatReader();
          zxingReaderRef.current = reader;
          if (videoRef.current) {
            reader.decodeFromStream(stream, videoRef.current, async (result, err) => {
              if (result) {
                stopScan();
                await lookupBarcode(result.getText());
              }
              // err is continuously fired when no barcode in frame — ignore
              void err;
            });
          }
        } catch (zxErr) {
          setScanError("Barcode scanning unavailable on this browser. Please enter the barcode manually.");
        }
      }
    } catch {
      setScanError("Camera access denied. Please enter the barcode manually.");
      setScanMode(false);
    }
  }, []);

  function stopScan() {
    scanningRef.current = false;
    // Stop ZXing reader if active
    if (zxingReaderRef.current) {
      try { (zxingReaderRef.current as any).reset?.(); } catch {}
      zxingReaderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanMode(false);
  }

  useEffect(() => () => {
    scanningRef.current = false;
    try { (zxingReaderRef.current as any)?.reset?.(); } catch {}
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const fmt = (v: number) => `${branding?.currencySymbol || "€"}${v.toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {branding?.storefrontTemplate === "fresh-market" && (
        <section className="relative overflow-hidden rounded-[1.75rem] min-h-[250px] md:min-h-[310px] market-shadow bg-[#e8dfca]">
          <img src="/images/fresh-market-hero.jpg" alt="Fresh seasonal produce" className="absolute inset-0 w-full h-full object-cover object-right" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#f0e8d7] via-[#f0e8d7e8] to-transparent" />
          <div className="relative p-7 md:p-10 max-w-lg">
            <p className="text-[10px] uppercase tracking-[.22em] font-bold text-[hsl(var(--primary))] mb-3">From our market to your table</p>
            <h1 className="font-display text-4xl md:text-6xl leading-[.96] text-[hsl(var(--foreground))]">Good food,<br /><em className="text-[hsl(var(--primary))]">no fuss.</em></h1>
            <p className="mt-4 text-sm md:text-base max-w-xs text-[hsl(var(--muted-foreground))]">Fresh picks, fair prices, and a basket ready when you are.</p>
            <a href="#catalog" className="inline-flex mt-5 rounded-full px-5 py-2.5 text-sm font-bold text-white hover:translate-y-[-1px] transition-transform" style={{ background: "hsl(var(--primary))" }}>Shop the market</a>
          </div>
        </section>
      )}
      <div id="catalog" className="flex items-end justify-between">
        <div><p className="text-[10px] uppercase tracking-[.2em] font-bold text-[hsl(var(--primary))]">The daily shop</p><h2 className="text-3xl font-display">What are you cooking?</h2></div>
        <span className="hidden sm:block text-xs text-[hsl(var(--muted-foreground))]">{total ? `${total} market picks` : "Open today"}</span>
      </div>
      <div aria-live="polite" className={`fixed z-50 left-1/2 -translate-x-1/2 bottom-24 md:bottom-8 rounded-full bg-[hsl(var(--foreground))] text-[hsl(var(--background))] px-4 py-2 text-xs font-semibold shadow-xl transition-opacity ${basketFeedback ? "opacity-100" : "opacity-0 pointer-events-none"}`}>{basketFeedback}</div>

      {/* Search + scan row */}
      <div className="flex gap-2 max-w-2xl">
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
        <section className="rounded-xl overflow-hidden border border-[hsl(var(--border))]">
          <div className="p-3 bg-[hsl(var(--card))]">
            <h2 className="text-sm font-semibold">In-store scan mode</h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Scan an item barcode to add it to your basket. Review your basket and use the usual checkout flow when you are ready.</p>
          </div>
          <div className="relative bg-black aspect-video">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-48 h-32 border-2 border-white rounded-lg opacity-60" /></div>
            <button onClick={stopScan} aria-label="Close scanner" className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white"><X className="w-4 h-4" /></button>
            <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-white/80">Point camera at barcode</p>
          </div>
        </section>
      )}
      <form onSubmit={(e) => { e.preventDefault(); if (manualBarcode.trim()) lookupBarcode(manualBarcode.trim()); }} className="flex gap-2">
        <input value={manualBarcode} onChange={(e) => setManualBarcode(e.target.value)} inputMode="numeric" placeholder="Enter barcode manually" aria-label="Manual barcode" className="flex-1 px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm" />
        <button type="submit" disabled={!manualBarcode.trim()} className="px-3 py-2 rounded-lg border border-[hsl(var(--border))] text-xs font-medium disabled:opacity-40">Add code</button>
      </form>
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
       <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {items.map((item) => {
            const qty = getQty(item.id);
            return (
              <div
                key={item.id}
                className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-2xl p-3 flex flex-col gap-2 market-shadow hover:-translate-y-1 transition-transform"
                data-testid={`card-product-${item.id}`}
              >
                <div className="h-32 rounded-xl bg-[hsl(var(--muted))] overflow-hidden mb-1 flex items-center justify-center">
                  {item.imageUrl ? (
                    <img
                      src={item.imageCardUrl || item.imageUrl}
                      srcSet={[
                        item.imageThumbnailUrl && `${item.imageThumbnailUrl} 240w`,
                        (item.imageCardUrl || item.imageUrl) && `${item.imageCardUrl || item.imageUrl} 720w`,
                        item.imageFullUrl && `${item.imageFullUrl} 1600w`,
                      ].filter(Boolean).join(", ")}
                      sizes="(min-width: 1024px) 260px, (min-width: 768px) 33vw, 50vw"
                      alt={item.name}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : <div className="text-center opacity-60"><div className="mx-auto w-16 h-16 rounded-full bg-[#d6dfbb] relative"><span className="absolute inset-2 rounded-full border-4 border-[#a9bb84]" /></div><span className="text-[10px] uppercase tracking-widest">Market pick</span></div>}
                </div>
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
                   <span className="text-[10px] text-red-500 font-medium">Currently unavailable</span>
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
