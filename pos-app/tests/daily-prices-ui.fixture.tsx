import React from "react";
import { createRoot } from "react-dom/client";
import { POS } from "../src/pages/POS";
import type { Category, Product, TerminalConfig } from "../src/types";

// Isolated native bridge / API fixture. No physical hardware or customer data.
const categories: Category[] = [
  { id: "fruit", server_id: "fruit", name: "Fruit", active: true, vat_rate: 5 },
  { id: "bakery", server_id: "bakery", name: "Bakery", active: true, vat_rate: 5 },
];
const initial: Product[] = [
  { id: "banana", server_id: "banana", name: "Bananas", sku: "4011", category_id: "fruit", price1: 2.99, price2: 3.49, price3: 0, price4: 0, price5: 0, cost_price: 1, vat_rate: 5, unit_type: "kg", pack_size: 1, stock_quantity: 10, active: true },
  { id: "apple", server_id: "apple", name: "Apples", sku: "4012", category_id: "fruit", price1: 2, price2: 2, price3: 0, price4: 0, price5: 0, cost_price: 1, vat_rate: 5, unit_type: "kg", pack_size: 1, stock_quantity: 10, active: true },
  { id: "bread", server_id: "bread", name: "Baguette", sku: "5011", category_id: "bakery", price1: 1.80, price2: 1.80, price3: 0, price4: 0, price5: 0, cost_price: 1, vat_rate: 5, unit_type: "pc", pack_size: 1, stock_quantity: 10, active: true },
];
function rows(key: string) { return JSON.parse(localStorage.getItem(key) || JSON.stringify(initial)) as Product[]; }
function store(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); }
const buttons = [
  { position: 0, label: "Fruit", button_type: "category", category_id: "fruit", color: "#15803d" },
  { position: 1, label: "Bakery", button_type: "category", category_id: "bakery", color: "#15803d" },
  { position: 2, label: "Price Change", button_type: "action", action_code: "GROCERY_DAILY_PRICES", color: "#b45309" },
  { position: 3, label: "Morning Macro", button_type: "action", action_code: "CUSTOM_MORNING", color: "#b45309" },
];
const state = {
  scaleReads: 0, printFail: false, syncFail: false, denied: false,
  saves: [] as any[], prints: [] as any[], printLogs: [] as any[],
  sync: () => store("daily-local", rows("daily-server")),
};
(window as any).dailyFixture = state;
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (command: string, args: any) => {
    switch (command) {
      case "plugin:store|load": return 1;
      case "plugin:store|get": return ["isolated-fixture-key", true];
      case "get_hardware_config": return {
        scale_enabled: true, scale_mode: "simulated", scale_protocol: "cas", scale_simulation: { value: .750, unit: "kg", state: "stable", tared: false },
        printer_enabled: true, printer_columns: 42, printer_port: "test", vfd_enabled: false,
      };
      case "check_printer_status": return true;
      case "get_products": return rows("daily-local");
      case "get_products_by_ids": return rows("daily-local").filter(p => args.itemIds.includes(p.server_id));
      case "get_categories": return categories;
      case "get_layout": return buttons;
      case "get_category_products_page": {
        const products = rows("daily-local").filter(p => args.categoryIds.includes(p.category_id));
        return { products, total: products.length };
      }
      case "get_current_shift": return { id: "fixture-shift", status: "open", opened_at: new Date().toISOString(), opening_float: 0 };
      case "get_promotions": return [];
      case "get_barcode_config": return null;
      case "get_receipt_config": return null;
      case "scale_read_weight": state.scaleReads++; return { grams: 750, kg: .750, stable: true, tared: false };
      case "sync_catalog":
        if (state.syncFail) throw new Error("Fixture sync unavailable");
        state.sync(); return rows("daily-local").length;
      case "print_receipt":
        state.prints.push(args.lines);
        if (state.printFail) throw new Error("Fixture printer disconnected");
        return;
      case "write_audit": return;
      default: throw new Error(`Unneeded fixture command: ${command}`);
    }
  },
};
window.fetch = async (url: RequestInfo | URL, options?: RequestInit) => {
  const path = String(url);
  function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
  if (path.endsWith("/api/pos/sync/layout-config")) return response({
    columns: 4, buttons: buttons.map(b => ({ ...b, buttonType: b.button_type, actionCode: b.action_code, categoryId: b.category_id })),
    groceryPricePlans: {
      GROCERY_DAILY_PRICES: [{ code: "GROCERY_DAILY_PRICES", conditions: [] }],
      CUSTOM_MORNING: [{ code: "TOGGLE_LANGUAGE", conditions: [] }, { code: "GROCERY_DAILY_PRICES", conditions: [{ receiptSign: "zero", transactionType: "sale" }] }],
    },
  });
  if (path.includes("/api/pos/grocery-prices/")) {
    if (state.denied) return response({ message: "You do not have access to price changes." }, 403);
    const body = JSON.parse(String(options?.body));
    if (body.cashierId !== "clerk" || body.pin !== "1234") return response({ message: "Invalid cashier credentials." }, 401);
    if (path.endsWith("/list")) return response({
      priceLevel: 2, locationId: "shop", categoryId: body.categoryId, categoryName: categories.find(c => c.id === body.categoryId)?.name,
      scope: "Shared price level — changes apply to all locations using this level.",
      items: rows("daily-server").filter(p => p.category_id === body.categoryId).map(p => ({
        itemId: p.server_id, name: p.name, sku: p.sku, unit: p.unit_type, price: p.price2, effectivePrice: p.price2 || p.price1,
      })),
    });
    if (path.endsWith("/save")) {
      state.saves.push(body);
      const products = rows("daily-server");
      for (const edit of body.prices) products.find(p => p.server_id === edit.itemId)!.price2 = edit.price;
      store("daily-server", products);
      return response({ saved: true, priceLevel: 2, locationId: "shop" });
    }
    if (path.endsWith("/print-status")) { state.printLogs.push(body); return response({ saved: true }); }
  }
  if (path.endsWith("/api/pos/signage/playlist")) return response({ items: [] });
  return response([]);
};
const config: TerminalConfig = { server_url: "https://isolated.test", terminal_code: "test", terminal_id: "test", terminal_name: "Fixture Till",
  location_id: "shop", location_name: "Test shop", price_level: 2 };
createRoot(document.getElementById("root")!).render(<POS config={config}
  session={{ cashier_id: "clerk", cashier_name: "Authorised Clerk", role: "cashier", permissions: ["sell"], pin_hash: "not-a-real-hash" }}
  sync={{ status: { online: true, syncing: false, outbox_pending: 0, outbox_failed: 0 },
    notifications: [], timedPriceOverrides: new Map(), telemetry: {} as any, syncNowBusy: false, peripheralHealth: null,
    triggerCatalogSync: async () => state.sync(), triggerInboxSync: async () => {}, triggerOutboxFlush: async () => {}, triggerSyncNow: async () => state.sync(),
  }} onLogout={() => {}} />);