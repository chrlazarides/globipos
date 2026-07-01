import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/queryClient";
import { queryClient } from "../lib/queryClient";
import { type CustomerSession } from "../lib/auth";
import { cn } from "../lib/cn";
import { ShoppingCart, Plus, Minus, X, Truck, Store, WifiOff, RefreshCw, Wallet } from "lucide-react";

export interface BasketItem {
  item: {
    id: string;
    name: string;
    sku: string;
    customerPrice: number;
    unitType: string;
    packSize: number;
  };
  quantity: number;
}

interface BasketProps {
  customer: CustomerSession;
  basket: BasketItem[];
  setBasket: React.Dispatch<React.SetStateAction<BasketItem[]>>;
}

const OFFLINE_QUEUE_KEY = "globi_offline_orders";

export function getOfflineQueueCount(): number {
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
    return Array.isArray(queue) ? queue.length : 0;
  } catch { return 0; }
}

function enqueueOffline(payload: object) {
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
    queue.push({ payload, queuedAt: new Date().toISOString() });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

export async function flushOfflineQueue(): Promise<number> {
  try {
    const queue: any[] = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
    if (!queue.length) return 0;
    const remaining: any[] = [];
    for (const item of queue) {
      try {
        await apiFetch("/api/customer/orders", { method: "POST", body: JSON.stringify(item.payload) });
      } catch {
        remaining.push(item);
      }
    }
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    const synced = queue.length - remaining.length;
    if (synced > 0) {
      queryClient.invalidateQueries({ queryKey: ["/api/customer/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer/loyalty"] });
    }
    return synced;
  } catch { return 0; }
}

// Register a Background Sync tag so the SW triggers flush when connectivity returns,
// even if the user has closed the tab.
async function registerBackgroundSync() {
  try {
    if ("serviceWorker" in navigator && "SyncManager" in window) {
      const reg = await navigator.serviceWorker.ready;
      await (reg as any).sync.register("globi-order-sync");
    }
  } catch {}
}

export default function Basket({ customer, basket, setBasket }: BasketProps) {
  const [, navigate] = useLocation();
  const [notes, setNotes] = useState("");
  const [deliveryType, setDeliveryType] = useState<"delivery" | "collection">("delivery");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(getOfflineQueueCount);
  const [syncing, setSyncing] = useState(false);
  const [useCashback, setUseCashback] = useState(false);

  // Fetch loyalty/cashback data
  const { data: loyaltyData } = useQuery<any>({
    queryKey: ["/api/customer/loyalty"],
    staleTime: 0,
  });
  const availableCashback = parseFloat(String(loyaltyData?.cashbackBalance || "0"));

  // Track online/offline status and refresh pending count
  useEffect(() => {
    const goOnline = async () => {
      setIsOnline(true);
      if (getOfflineQueueCount() > 0) {
        setSyncing(true);
        await flushOfflineQueue();
        setPendingCount(getOfflineQueueCount());
        setSyncing(false);
      }
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Listen for SW background sync message — the SW pings us when its sync event fires
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = async (event: MessageEvent) => {
      if (event.data?.type === "SYNC_OFFLINE_ORDERS") {
        setSyncing(true);
        await flushOfflineQueue();
        setPendingCount(getOfflineQueueCount());
        setSyncing(false);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  const VAT = 0.19;
  const subtotal = basket.reduce((s, b) => s + b.item.customerPrice * b.quantity, 0);
  const vatAmount = subtotal * VAT;
  const grossTotal = subtotal + vatAmount;
  const cashbackDeduction = useCashback ? Math.min(availableCashback, grossTotal) : 0;
  const total = Math.max(0, grossTotal - cashbackDeduction);

  const fmt = (v: number) => `€${v.toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;

  function add(id: string) {
    setBasket((prev) => prev.map((b) => b.item.id === id ? { ...b, quantity: b.quantity + 1 } : b));
  }
  function dec(id: string) {
    setBasket((prev) => prev.map((b) => b.item.id === id ? { ...b, quantity: b.quantity - 1 } : b).filter((b) => b.quantity > 0));
  }
  function remove(id: string) {
    setBasket((prev) => prev.filter((b) => b.item.id !== id));
  }

  async function handleManualSync() {
    setSyncing(true);
    await flushOfflineQueue();
    setPendingCount(getOfflineQueueCount());
    setSyncing(false);
  }

  async function handleSubmit() {
    if (!basket.length) return;
    setSubmitting(true);
    const orderPayload = {
      items: basket.map((b) => ({ itemId: b.item.id, quantity: b.quantity })),
      notes,
      deliveryType,
      deliveryAddress: deliveryType === "delivery" ? deliveryAddress : undefined,
      useCashback: useCashback && availableCashback > 0,
    };
    try {
      if (!navigator.onLine) {
        enqueueOffline(orderPayload);
        await registerBackgroundSync();
        setPendingCount(getOfflineQueueCount());
        setBasket([]);
        setNotes("");
        setUseCashback(false);
        setSuccess(true);
        setTimeout(() => { setSuccess(false); navigate("/orders"); }, 2500);
        return;
      }
      // Flush previously queued orders first
      await flushOfflineQueue();
      setPendingCount(getOfflineQueueCount());
      await apiFetch("/api/customer/orders", { method: "POST", body: JSON.stringify(orderPayload) });
      queryClient.invalidateQueries({ queryKey: ["/api/customer/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer/loyalty"] });
      setBasket([]);
      setNotes("");
      setUseCashback(false);
      setSuccess(true);
      setTimeout(() => { setSuccess(false); navigate("/orders"); }, 2000);
    } catch (err: any) {
      alert(err.message || "Failed to place order");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <span className="text-3xl">✓</span>
        </div>
        <h2 className="text-lg font-semibold">
          {isOnline ? "Order Placed!" : "Order Saved — Will sync when online"}
        </h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Redirecting to your orders…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Basket</h1>
        <div className="flex items-center gap-2">
          {!isOnline && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
              <WifiOff className="w-3.5 h-3.5" /> Offline
            </span>
          )}
          {pendingCount > 0 && (
            <button
              onClick={handleManualSync}
              disabled={syncing || !isOnline}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] disabled:opacity-50"
              data-testid="button-sync-queue"
            >
              <RefreshCw className={cn("w-3 h-3", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : `${pendingCount} queued`}
            </button>
          )}
        </div>
      </div>

      {!basket.length ? (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-[hsl(var(--muted-foreground))]">
          <ShoppingCart className="w-12 h-12 opacity-30" />
          <p className="text-sm font-medium">Your basket is empty</p>
          <p className="text-xs">Browse the shop and add items</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {basket.map((b) => (
              <div key={b.item.id} className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-3 flex items-center gap-3" data-testid={`basket-item-${b.item.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{b.item.name}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    {fmt(b.item.customerPrice)} × {b.quantity} = {fmt(b.item.customerPrice * b.quantity)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => dec(b.item.id)} className="w-7 h-7 rounded-full border border-[hsl(var(--border))] flex items-center justify-center text-sm" data-testid={`button-dec-${b.item.id}`}>−</button>
                  <span className="w-5 text-center text-sm font-bold tabular-nums">{b.quantity}</span>
                  <button onClick={() => add(b.item.id)} className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm" style={{ background: "hsl(var(--primary))" }} data-testid={`button-inc-${b.item.id}`}>+</button>
                  <button onClick={() => remove(b.item.id)} className="w-7 h-7 rounded-full flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]" data-testid={`button-remove-${b.item.id}`}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Cashback wallet */}
          {availableCashback >= 0.01 && (
            <button
              onClick={() => setUseCashback((v) => !v)}
              className={cn(
                "w-full flex items-center justify-between gap-3 p-3 rounded-xl border text-sm transition-colors",
                useCashback
                  ? "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                  : "border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted))]"
              )}
              data-testid="button-use-cashback"
            >
              <div className="flex items-center gap-2">
                <Wallet className={cn("w-4 h-4", useCashback ? "text-green-600" : "text-[hsl(var(--muted-foreground))]")} />
                <div className="text-left">
                  <p className="font-medium text-xs">Cashback Wallet</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{fmt(availableCashback)} available</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {useCashback && cashbackDeduction > 0 && (
                  <span className="text-xs font-semibold text-green-600">−{fmt(cashbackDeduction)}</span>
                )}
                <div className={cn(
                  "w-9 h-5 rounded-full transition-colors flex items-center px-0.5",
                  useCashback ? "bg-green-500" : "bg-[hsl(var(--muted))]"
                )}>
                  <div className={cn("w-4 h-4 rounded-full bg-white shadow transition-transform", useCashback ? "translate-x-4" : "translate-x-0")} />
                </div>
              </div>
            </button>
          )}

          {/* Delivery type */}
          <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold">Delivery Method</p>
            <div className="grid grid-cols-2 gap-2">
              {(["delivery", "collection"] as const).map((dt) => (
                <button
                  key={dt}
                  onClick={() => setDeliveryType(dt)}
                  className={cn(
                    "flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors",
                    deliveryType === dt
                      ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 text-[hsl(var(--primary))]"
                      : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                  )}
                  data-testid={`button-delivery-${dt}`}
                >
                  {dt === "delivery" ? <Truck className="w-4 h-4" /> : <Store className="w-4 h-4" />}
                  {dt === "delivery" ? "Delivery" : "Collection"}
                </button>
              ))}
            </div>
            {deliveryType === "delivery" && (
              <textarea
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="Delivery address…"
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] resize-none"
                data-testid="input-delivery-address"
              />
            )}
          </div>

          {/* Notes */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Order notes (optional)…"
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] resize-none"
            data-testid="input-order-notes"
          />

          {/* Summary */}
          <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm text-[hsl(var(--muted-foreground))]">
              <span>Subtotal</span><span>{fmt(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-[hsl(var(--muted-foreground))]">
              <span>VAT (19%)</span><span>{fmt(vatAmount)}</span>
            </div>
            {cashbackDeduction > 0 && (
              <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                <span>Cashback credit</span><span>−{fmt(cashbackDeduction)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold border-t border-[hsl(var(--border))] pt-2">
              <span>Total</span><span data-testid="text-basket-total">{fmt(total)}</span>
            </div>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
              You'll earn ~{Math.floor(subtotal)} loyalty pts + cashback on this order
            </p>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-60"
            style={{ background: "hsl(var(--primary))" }}
            data-testid="button-place-order"
          >
            {submitting
              ? "Placing Order…"
              : !isOnline
              ? `Save for Later · ${fmt(total)}`
              : `Place Order · ${fmt(total)}`}
          </button>
        </>
      )}
    </div>
  );
}
