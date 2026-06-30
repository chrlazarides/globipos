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

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col select-none">
      {/* Header */}
      <div className="bg-[#7c1d3f] px-8 py-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-wide">{state.store_name}</h1>
        <div className="text-sm opacity-70">{new Date().toLocaleTimeString()}</div>
      </div>

      <div className="flex-1 flex">
        {/* Left: basket */}
        <div className="flex-1 px-8 py-6 overflow-hidden">
          {state.mode === "idle" && (
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
            <div className="space-y-2">
              <h2 className="text-sm uppercase tracking-widest text-gray-400 mb-4">Your items</h2>
              <div className="space-y-1 max-h-96 overflow-y-hidden">
                {state.items.map((item, i) => (
                  <div
                    key={i}
                    className="flex justify-between items-baseline py-1 border-b border-gray-800"
                  >
                    <span className="text-base text-gray-200 truncate mr-4">{item.description}</span>
                    <span className="text-sm text-gray-400 shrink-0">
                      {item.qty} × €{item.unit_price.toFixed(2)}
                    </span>
                    <span className="text-base font-medium tabular-nums shrink-0 ml-4">
                      €{item.line_total.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state.mode === "complete" && (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="text-7xl">✅</div>
              <p className="text-3xl font-semibold text-green-400">Thank You!</p>
              {state.loyalty_points_earned != null && state.loyalty_points_earned > 0 && (
                <p className="text-xl text-amber-400">
                  +{state.loyalty_points_earned} loyalty points earned
                </p>
              )}
              <p className="text-lg text-gray-400">Please take your receipt</p>
            </div>
          )}
        </div>

        {/* Right: totals */}
        {state.mode !== "idle" && (
          <div className="w-72 bg-gray-900 border-l border-gray-800 px-6 py-8 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex justify-between text-gray-400">
                <span>Subtotal</span>
                <span className="tabular-nums">€{state.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>VAT</span>
                <span className="tabular-nums">€{state.vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-2xl font-bold text-white border-t border-gray-700 pt-4">
                <span>TOTAL</span>
                <span className="tabular-nums">€{state.total.toFixed(2)}</span>
              </div>

              {state.mode === "payment" && state.payment_method && (
                <div className="mt-6 space-y-2">
                  <p className="text-sm text-gray-400 uppercase tracking-wide">Payment</p>
                  <p className="text-lg font-medium text-green-400 capitalize">
                    {state.payment_method.replace(/_/g, " ")}
                  </p>
                  {state.change_due != null && state.change_due > 0 && (
                    <div className="flex justify-between text-lg">
                      <span className="text-gray-300">Change</span>
                      <span className="tabular-nums text-yellow-400">
                        €{state.change_due.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
