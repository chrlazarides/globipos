import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getPortalQueryFn, portalApiRequest, queryClient } from "@/lib/queryClient";
import { Search, ShoppingCart, Plus, Minus, X, Package, ScanBarcode, CheckCircle2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { Customer, Item, Category } from "@shared/schema";

interface PortalShopProps {
  customer: Customer;
}

interface CartItem {
  item: Item;
  quantity: number;
}

export default function PortalShop({ customer }: PortalShopProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [useCashback, setUseCashback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [scanError, setScanError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const checkoutAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const { toast } = useToast();

  const { data: catalog, isLoading: catalogLoading } = useQuery<{ items: Item[]; categories: Category[] }>({
    queryKey: ["/api/portal/catalog"],
  });

  const { data: loyaltyData, isLoading: loyaltyLoading } = useQuery<any>({
    queryKey: ["/api/portal/customer", customer.id, "loyalty"],
    queryFn: getPortalQueryFn(`/api/portal/customer/${customer.id}/loyalty`),
  });

  const items = catalog?.items || [];
  const categories = catalog?.categories || [];
  const cashbackBalance = loyaltyData?.cashbackBalance || 0;
  const cashbackEnabled = loyaltyData?.cashbackEnabled ?? false;
  const maxCashbackOrderPercent = loyaltyData?.maxCashbackOrderPercent || 1.0;

  const filtered = items.filter((item) => {
    const matchesSearch = !search || item.name.toLowerCase().includes(search.toLowerCase()) || item.sku?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || item.categoryId === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const getPrice = (item: Item) => {
    const key = `price${customer.priceLevel}` as keyof Item;
    return parseFloat(String(item[key] || item.price1));
  };

  const fmt = (v: number) => `€${v.toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;

  const addToCart = (item: Item) => {
    setCart((prev) => {
      const existing = prev.find((ci) => ci.item.id === item.id);
      if (existing) {
        return prev.map((ci) => ci.item.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci);
      }
      return [...prev, { item, quantity: 1 }];
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev.map((ci) => ci.item.id === itemId ? { ...ci, quantity: Math.max(0, ci.quantity + delta) } : ci).filter((ci) => ci.quantity > 0)
    );
  };

  const removeFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((ci) => ci.item.id !== itemId));
  };

  const cartTotal = cart.reduce((sum, ci) => sum + getPrice(ci.item) * ci.quantity, 0);
  const vatAmount = cartTotal * 0.19;
  const grandTotal = cartTotal + vatAmount;

  const maxApplicableCashback = grandTotal * maxCashbackOrderPercent;
  const appliedCashback = useCashback ? Math.min(cashbackBalance, maxApplicableCashback) : 0;
  const finalTotal = Math.max(0, grandTotal - appliedCashback);

  const startScan = useCallback(async () => {
    setScanError("");
    setScanMode(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }

      if ("BarcodeDetector" in window) {
        const BarcodeDetectorAPI = (window as any).BarcodeDetector;
        const detector = new BarcodeDetectorAPI({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"] });
        scanningRef.current = true;
        const tick = async () => {
          if (!scanningRef.current || !videoRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              const bc: string = barcodes[0].rawValue;
              stopScan();
              const found = items.find((i: Item) => i.barcode === bc);
              if (found) {
                addToCart(found);
                toast({ title: "Item scanned", description: found.name });
              } else {
                setScanError(`Barcode "${bc}" not found in catalog`);
              }
              return;
            }
          } catch { /* frame not ready yet */ }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } else {
        setScanError("Your browser doesn't support native barcode detection. Enter the barcode manually in search.");
      }
    } catch {
      setScanError("Camera access denied.");
      setScanMode(false);
    }
  }, [items]);

  const stopScan = () => {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanMode(false);
  };

  const handleSubmit = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      const fingerprint = JSON.stringify({
        items: cart.map((ci) => ({ itemId: ci.item.id, quantity: ci.quantity }))
          .sort((a, b) => a.itemId.localeCompare(b.itemId)),
        notes: notes.trim(),
        useCashback,
      });
      if (!checkoutAttemptRef.current || checkoutAttemptRef.current.fingerprint !== fingerprint) {
        checkoutAttemptRef.current = { fingerprint, key: crypto.randomUUID() };
      }
      await portalApiRequest("POST", "/api/portal/orders", {
        items: cart.map((ci) => ({ itemId: ci.item.id, quantity: ci.quantity })),
        notes,
        checkoutKey: checkoutAttemptRef.current.key,
        useCashback,
      });
      toast({ title: "Order placed", description: "Your order has been submitted successfully." });
      setCart([]);
      setNotes("");
      setUseCashback(false);
      checkoutAttemptRef.current = null;
      queryClient.invalidateQueries({ queryKey: ["/api/portal/customer", customer.id, "orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/customer", customer.id, "loyalty"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/catalog"] });
    } catch (err: any) {
      toast({ title: "Order failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const getCartQuantity = (itemId: string) => cart.find((ci) => ci.item.id === itemId)?.quantity || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground" data-testid="text-portal-shop-title">Shop</h1>
        <p className="text-sm text-muted-foreground mt-1">Browse our catalog and place your order</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-portal-search"
              />
            </div>
            <Button
              variant={scanMode ? "default" : "outline"}
              size="icon"
              onClick={scanMode ? stopScan : startScan}
              title="Scan barcode"
              data-testid="button-scan-barcode"
            >
              <ScanBarcode className="w-4 h-4" />
            </Button>
          </div>
          {scanMode && (
            <div className="relative rounded-xl overflow-hidden border bg-black aspect-video max-h-48">
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-40 h-28 border-2 border-white rounded-lg opacity-60" />
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-1 right-1 bg-black/50 text-white hover:bg-black/70 h-7 w-7"
                onClick={stopScan}
              >
                <X className="w-3 h-3" />
              </Button>
              <p className="absolute bottom-1 left-0 right-0 text-center text-xs text-white/80">Point camera at barcode</p>
            </div>
          )}
          {scanError && (
            <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{scanError}</p>
          )}

          <div className="flex flex-wrap gap-1">
            <Button
              variant={categoryFilter === "" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setCategoryFilter("")}
              data-testid="button-filter-all"
            >
              All
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat.id}
                variant={categoryFilter === cat.id ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setCategoryFilter(cat.id)}
                data-testid={`button-filter-${cat.id}`}
              >
                {cat.name}
              </Button>
            ))}
          </div>

          {catalogLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border rounded-lg border-dashed bg-muted/10">
              <Package className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm font-medium">No products found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filtered.map((item) => {
                const qty = getCartQuantity(item.id);
                return (
                  <Card key={item.id} className="shadow-sm hover:border-primary/50 transition-colors" data-testid={`card-product-${item.id}`}>
                    <CardContent className="p-4">
                      <div className="flex justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate" data-testid={`text-product-name-${item.id}`}>{item.name}</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            <Badge variant="outline" className="text-[10px] py-0">{item.sku}</Badge>
                            <Badge variant="secondary" className="text-[10px] py-0">{item.packSize}</Badge>
                          </div>
                          {item.vintage && <p className="text-xs text-muted-foreground mt-1">Vintage: {item.vintage}</p>}
                          <p className="text-base font-bold mt-2 text-foreground" data-testid={`text-product-price-${item.id}`}>{fmt(getPrice(item))}</p>
                        </div>
                        <div className="flex flex-col items-end justify-between">
                          {qty > 0 ? (
                            <div className="flex items-center gap-2 bg-muted p-1 rounded-md">
                              <Button size="icon" variant="ghost" className="h-6 w-6 rounded hover:bg-background" onClick={() => updateQuantity(item.id, -1)} data-testid={`button-decrease-${item.id}`}>
                                <Minus className="w-3 h-3" />
                              </Button>
                              <span className="w-6 text-center text-sm font-medium" data-testid={`text-qty-${item.id}`}>{qty}</span>
                              <Button size="icon" variant="ghost" className="h-6 w-6 rounded hover:bg-background" onClick={() => updateQuantity(item.id, 1)} data-testid={`button-increase-${item.id}`}>
                                <Plus className="w-3 h-3" />
                              </Button>
                            </div>
                          ) : (
                            <Button size="sm" onClick={() => addToCart(item)} data-testid={`button-add-${item.id}`}>
                              <Plus className="w-4 h-4 mr-1.5" /> Add
                            </Button>
                          )}
                          <p className="text-[10px] text-muted-foreground mt-2">Stock: {item.stockQuantity}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div className="w-full lg:w-96 lg:sticky lg:top-16 space-y-4">
          <Card className="shadow-md border-primary/10">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b">
                <ShoppingCart className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-base">Your Order ({cart.length})</h3>
              </div>

              {cart.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">Your cart is empty</p>
                </div>
              ) : (
                <>
                  <div className="space-y-3 max-h-64 overflow-y-auto pr-2 scrollbar-thin">
                    {cart.map((ci) => (
                      <div key={ci.item.id} className="flex items-start justify-between gap-3 text-sm group">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium leading-tight">{ci.item.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{ci.quantity} x {fmt(getPrice(ci.item))}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{fmt(getPrice(ci.item) * ci.quantity)}</span>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeFromCart(ci.item.id)} data-testid={`button-remove-${ci.item.id}`}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-3 space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{fmt(cartTotal)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">VAT (19%)</span>
                      <span>{fmt(vatAmount)}</span>
                    </div>

                    {cashbackEnabled && cashbackBalance > 0 && grandTotal > 0 && (
                      <div className="py-3 mt-1 border-y border-dashed bg-emerald-50/50 dark:bg-emerald-950/20 -mx-5 px-5">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <Label htmlFor="use-cashback" className="flex items-center gap-2 cursor-pointer">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span className="font-medium text-emerald-800 dark:text-emerald-200">Use Cash Back</span>
                          </Label>
                          <Switch
                            id="use-cashback"
                            checked={useCashback}
                            onCheckedChange={setUseCashback}
                            data-testid="switch-use-cashback"
                          />
                        </div>
                        <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80 pl-6">
                          Available: {fmt(cashbackBalance)}
                          {maxCashbackOrderPercent < 1 && ` (Max ${(maxCashbackOrderPercent * 100).toFixed(0)}% of order)`}
                        </p>
                        {useCashback && appliedCashback > 0 && (
                          <div className="flex justify-between gap-2 mt-2 pl-6 font-medium text-emerald-700 dark:text-emerald-400">
                            <span>Applied Discount</span>
                            <span>-{fmt(appliedCashback)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex justify-between gap-2 font-bold text-lg pt-1">
                      <span>Total Estimate</span>
                      <span data-testid="text-cart-total">{fmt(finalTotal)}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center">Final price confirmed at processing</p>
                  </div>

                  <div className="pt-2">
                    <Input
                      placeholder="Add a note to your order..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="text-sm bg-muted/50"
                      data-testid="input-order-notes"
                    />
                  </div>

                  <Button
                    size="lg"
                    className="w-full font-bold text-base"
                    disabled={submitting || cart.length === 0}
                    onClick={handleSubmit}
                    data-testid="button-place-order"
                  >
                    {submitting ? "Processing..." : "Submit Order"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
