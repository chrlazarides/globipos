import { useState } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "../lib/queryClient";
import { queryClient } from "../lib/queryClient";
import { type CustomerSession } from "../lib/auth";
import { cn } from "../lib/cn";
import { ShoppingCart, Plus, Minus, X, Truck, Store } from "lucide-react";

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

export default function Basket({ customer, basket, setBasket }: BasketProps) {
  const [, navigate] = useLocation();
  const [notes, setNotes] = useState("");
  const [deliveryType, setDeliveryType] = useState<"delivery" | "collection">("delivery");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const VAT = 0.19;
  const subtotal = basket.reduce((s, b) => s + b.item.customerPrice * b.quantity, 0);
  const vatAmount = subtotal * VAT;
  const total = subtotal + vatAmount;

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

  const OFFLINE_QUEUE_KEY = "globi_offline_orders";

  function enqueueOffline(payload: object) {
    try {
      const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
      queue.push({ payload, queuedAt: new Date().toISOString() });
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch {}
  }

  async function flushOfflineQueue() {
    try {
      const queue: any[] = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
      if (!queue.length) return;
      const remaining: any[] = [];
      for (const item of queue) {
        try {
          await apiFetch("/api/customer/orders", { method: "POST", body: JSON.stringify(item.payload) });
        } catch {
          remaining.push(item);
        }
      }
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
      if (remaining.length < queue.length) {
        queryClient.invalidateQueries({ queryKey: ["/api/customer/orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/customer/loyalty"] });
      }
    } catch {}
  }

  async function handleSubmit() {
    if (!basket.length) return;
    setSubmitting(true);
    const orderPayload = {
      items: basket.map((b) => ({ itemId: b.item.id, quantity: b.quantity })),
      notes,
      deliveryType,
      deliveryAddress: deliveryType === "delivery" ? deliveryAddress : undefined,
    };
    try {
      if (!navigator.onLine) {
        enqueueOffline(orderPayload);
        setBasket([]);
        setNotes("");
        setSuccess(true);
        // Register online listener to flush
        window.addEventListener("online", () => flushOfflineQueue(), { once: true });
        setTimeout(() => { setSuccess(false); navigate("/orders"); }, 2000);
        return;
      }
      // Try to flush any previously queued orders first
      await flushOfflineQueue();
      await apiFetch("/api/customer/orders", { method: "POST", body: JSON.stringify(orderPayload) });
      queryClient.invalidateQueries({ queryKey: ["/api/customer/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer/loyalty"] });
      setBasket([]);
      setNotes("");
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
        <h2 className="text-lg font-semibold">Order Placed!</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Redirecting to your orders…</p>
      </div>
    );
  }

  if (!basket.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-[hsl(var(--muted-foreground))]">
        <ShoppingCart className="w-12 h-12 opacity-30" />
        <p className="text-sm font-medium">Your basket is empty</p>
        <p className="text-xs">Browse the shop and add items</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Basket</h1>

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
        <div className="flex justify-between text-sm font-bold border-t border-[hsl(var(--border))] pt-2">
          <span>Total</span><span data-testid="text-basket-total">{fmt(total)}</span>
        </div>
        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
          You'll earn ~{Math.floor(subtotal)} loyalty points on this order
        </p>
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-3.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-60"
        style={{ background: "hsl(var(--primary))" }}
        data-testid="button-place-order"
      >
        {submitting ? "Placing Order…" : `Place Order · ${fmt(total)}`}
      </button>
    </div>
  );
}
