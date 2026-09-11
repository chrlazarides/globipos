/**
 * CustomerDisplay — second-screen content for the customer-facing display.
 *
 * This component is rendered in a second Tauri window (or on a secondary
 * monitor) and shows basket contents, running total, loyalty points,
 * payment status, and promotional media between transactions.
 *
 * The main POS writes the display state to a shared store (via Tauri store
 * plugin) which this window reads. The content cycles through:
 *   idle → showing promotions / logo / welcome
 *   scanning → shows each item as added
 *   payment → shows total and payment method
 *   complete → thank-you screen with loyalty points earned
 */

import { useEffect, useState } from "react";
import { load as loadStore } from "@tauri-apps/plugin-store";

interface DisplayItem {
  description: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

interface SignageItem {
  id: string;
  contentType: "image" | "video";
  resolvedMedia?: { url: string };
  resolvedItem?: { imageUrl: string; name: string; price: number };
  resolvedOffer?: { imageUrl: string; name: string };
  durationSeconds: number;
}

interface DisplayState {
  mode: "idle" | "scanning" | "payment" | "complete";
  items: DisplayItem[];
  subtotal: number;
  vat: number;
  total: number;
  payment_method?: string;
  change_due?: number;
  loyalty_points_earned?: number;
  store_name: string;
  promo_message?: string;
  signage?: SignageItem[];
}

const DEFAULT_STATE: DisplayState = {
  mode: "idle",
  items: [],
  subtotal: 0,
  vat: 0,
  total: 0,
  store_name: "GlobiPOS",
};

export default function CustomerDisplay() {
  const [state, setState] = useState<DisplayState>(DEFAULT_STATE);
  const [signageIndex, setSignageIndex] = useState(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    async function poll() {
      try {
        const store = await loadStore("customer_display.json");
        const raw = await store.get<DisplayState>("state");
        if (raw) setState(raw);
      } catch {
        // ignore — main window may not have written yet
      }
    }

    poll();
    interval = setInterval(poll, 500);
    return () => clearInterval(interval);
  }, []);

  // Signage rotation
  useEffect(() => {
    if (state.mode !== "idle" || !state.signage || state.signage.length === 0) return;

    const currentItem = state.signage[signageIndex % state.signage.length];
    const duration = (currentItem.durationSeconds || 10) * 1000;

    const timer = setTimeout(() => {
      setSignageIndex((prev) => (prev + 1) % state.signage!.length);
    }, duration);

    return () => clearTimeout(timer);
  }, [state.mode, state.signage, signageIndex]);

  const activeSignage = state.mode === "idle" && state.signage && state.signage.length > 0
    ? state.signage[signageIndex % state.signage.length]
    : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col select-none relative overflow-hidden">
      {/* Background Signage (Idle Mode) */}
      {state.mode === "idle" && activeSignage && (
        <div className="absolute inset-0 z-0">
          {activeSignage.contentType === "video" ? (
            <video
              src={activeSignage.resolvedMedia?.url}
              autoPlay
              muted
              onEnded={() => setSignageIndex((prev) => (prev + 1) % state.signage!.length)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full relative">
              <img
                src={activeSignage.resolvedMedia?.url || activeSignage.resolvedItem?.imageUrl || activeSignage.resolvedOffer?.imageUrl}
                className="w-full h-full object-cover"
              />
              {(activeSignage.resolvedItem || activeSignage.resolvedOffer) && (
                <div className="absolute bottom-20 left-10 right-10 bg-black/60 backdrop-blur-md p-8 rounded-2xl border border-white/10">
                  <h2 className="text-4xl font-bold text-white mb-2">
                    {activeSignage.resolvedItem?.name || activeSignage.resolvedOffer?.name}
                  </h2>
                  {activeSignage.resolvedItem && (
                    <p className="text-5xl font-black text-amber-400">
                      €{activeSignage.resolvedItem.price.toFixed(2)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main UI */}
      <div className={`relative z-10 flex-1 flex flex-col ${state.mode === "idle" && activeSignage ? "bg-black/30" : ""}`}>
        {/* Header */}
        <div className="bg-[#7c1d3f]/90 backdrop-blur-sm px-8 py-4 flex items-center justify-between border-b border-white/10">
          <h1 className="text-2xl font-bold tracking-wide">{state.store_name}</h1>
          <div className="text-sm opacity-70">{new Date().toLocaleTimeString()}</div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left: Content */}
          <div className="flex-1 px-8 py-6 flex flex-col">
            {state.mode === "idle" && !activeSignage && (
              <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
                <div className="text-7xl">🛒</div>
                <p className="text-3xl font-light text-gray-300">Welcome!</p>
                {state.promo_message && (
                  <p className="text-xl text-amber-400 font-medium animate-pulse max-w-md">
                    {state.promo_message}
                  </p>
                )}
              </div>
            )}

            {(state.mode === "scanning" || state.mode === "payment") && (
              <div className="flex-1 flex flex-col min-h-0 bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 p-6">
                <h2 className="text-sm uppercase tracking-widest text-gray-400 mb-4">Your items</h2>
                <div className="flex-1 overflow-y-auto pr-2 space-y-1">
                  {state.items.map((item, i) => (
                    <div
                      key={i}
                      className={`flex justify-between items-baseline py-2 border-b border-white/5 ${i === state.items.length - 1 ? "bg-green-500/10 -mx-2 px-2 rounded-lg" : ""}`}
                    >
                      <div className="flex flex-col">
                        <span className="text-lg text-white font-medium">{item.description}</span>
                        <span className="text-sm text-gray-400">
                          {item.qty} × €{item.unit_price.toFixed(2)}
                        </span>
                      </div>
                      <span className="text-xl font-bold tabular-nums text-white">
                        €{item.line_total.toFixed(2)}
                      </span>
                    </div>
                  ))}
                  {/* Digital VFD Emulation (Line 1: Last Item, Line 2: Total) */}
                  <div className="mt-8 pt-8 border-t-2 border-green-500/30">
                    <div className="bg-black border-2 border-green-900 p-4 rounded-lg font-mono text-green-500 shadow-[0_0_15px_rgba(34,197,94,0.2)]">
                      <div className="text-2xl uppercase tracking-tighter truncate opacity-90">
                        {state.items.length > 0 ? state.items[state.items.length - 1].description : "WELCOME"}
                      </div>
                      <div className="text-4xl font-bold flex justify-between items-end">
                        <span className="text-xl opacity-60">TOTAL</span>
                        <span>€{state.total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {state.mode === "complete" && (
              <div className="flex flex-col items-center justify-center h-full gap-6 text-center bg-black/40 backdrop-blur-md rounded-3xl border border-green-500/20 m-12">
                <div className="text-8xl animate-bounce">✅</div>
                <p className="text-4xl font-bold text-green-400">Thank You!</p>
                {state.loyalty_points_earned != null && state.loyalty_points_earned > 0 && (
                  <div className="bg-amber-500/20 px-6 py-2 rounded-full border border-amber-500/30">
                    <p className="text-2xl text-amber-400 font-bold">
                      +{state.loyalty_points_earned} loyalty points
                    </p>
                  </div>
                )}
                <p className="text-xl text-gray-400">Please take your receipt</p>
                <div className="mt-8 text-2xl font-mono text-green-500">
                  CHANGE DUE: €{(state.change_due || 0).toFixed(2)}
                </div>
              </div>
            )}
          </div>

          {/* Right: Totals Sidebar */}
          {state.mode !== "idle" && (
            <div className="w-80 bg-black/60 backdrop-blur-xl border-l border-white/10 p-8 flex flex-col justify-between shadow-2xl">
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-gray-400">
                    <span>Subtotal</span>
                    <span className="tabular-nums font-medium">€{state.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>VAT</span>
                    <span className="tabular-nums font-medium">€{state.vat.toFixed(2)}</span>
                  </div>
                </div>

                <div className="bg-white/5 p-6 rounded-2xl border border-white/10">
                  <span className="text-xs uppercase tracking-widest text-gray-500 block mb-1">Grand Total</span>
                  <div className="text-5xl font-black text-white tabular-nums tracking-tighter">
                    €{state.total.toFixed(2)}
                  </div>
                </div>

                {state.mode === "payment" && state.payment_method && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                    <div className="h-px bg-white/10" />
                    <p className="text-xs text-gray-500 uppercase tracking-widest">Payment Method</p>
                    <div className="flex items-center gap-3 text-green-400">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <p className="text-xl font-bold capitalize">
                        {state.payment_method.replace(/_/g, " ")}
                      </p>
                    </div>
                    {state.change_due != null && state.change_due > 0 && (
                      <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-xl">
                        <span className="text-xs text-green-500/70 uppercase font-bold">Change Due</span>
                        <div className="text-3xl font-black text-green-400 tabular-nums">
                          €{state.change_due.toFixed(2)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <div className="text-center opacity-30 text-xs font-mono uppercase tracking-[0.2em]">
                {state.store_name} Terminal
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
