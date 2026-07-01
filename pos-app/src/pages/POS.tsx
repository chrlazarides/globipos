/**
 * Main POS selling screen.
 * Layout: [Category Nav + ScaleBar + Layout Grid] | [Order Ticket]
 * Bottom: Action Bar
 * Top: Sync Header
 *
 * Phase 3 components wired:
 *  - PaymentDialog  — full split-payment flow (cash/card/voucher/loyalty)
 *  - RefundDialog   — return by receipt or manual item entry
 *  - ShiftManager   — shift open/close, X-report, end-of-day Z-report
 *  - SelfCheckout   — dedicated self-service checkout mode
 *  - ScaleBar       — live weight display when scale is connected
 *  - CustomerDisplay — pole display overlay when enabled
 *  - useHardware    — receipt printing + cash drawer on payment complete
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { load as loadStore } from "@tauri-apps/plugin-store";
import type {
  Product, Category, LayoutButton, CashierSession, TerminalConfig,
  NumpadMode, Order as OrderType, OrderLine as OrderLineType,
} from "../types";
import { getProducts, getCategories, getLayout, getHeldOrders, getOrderLines } from "../lib/db";
import { formatCurrency } from "../lib/pricing";
import { useOrder } from "../hooks/useOrder";
import { useBarcode } from "../hooks/useBarcode";
import { usePermissions } from "../hooks/usePermissions";
import { useHardware } from "../hooks/useHardware";
import { useShift } from "../hooks/useShift";
import { SyncHeader } from "../components/SyncHeader";
import { CategoryNav } from "../components/CategoryNav";
import { LayoutGrid } from "../components/LayoutGrid";
import { OrderTicket } from "../components/OrderTicket";
import { Numpad } from "../components/Numpad";
import { ActionBar } from "../components/ActionBar";
import { PinPrompt } from "../components/PinPrompt";
import ScaleBar from "../components/ScaleBar";
import CustomerDisplay from "../components/CustomerDisplay";
import PaymentDialog from "../components/PaymentDialog";
import RefundDialog from "../components/RefundDialog";
import type { PaymentResult } from "../hooks/usePayment";
import { FallbackRules } from "./FallbackRules";
import ShiftManager from "./ShiftManager";
import SelfCheckout from "./SelfCheckout";
import type { UseSyncReturn } from "../hooks/useSync";

interface POSProps {
  config: TerminalConfig;
  session: CashierSession;
  sync: UseSyncReturn;
  onLogout: () => void;
}

// ── Note input dialog ─────────────────────────────────────────────────────────

function NoteDialog({
  title, initial, onConfirm, onClose,
}: { title: string; initial?: string; onConfirm: (note: string) => void; onClose: () => void; }) {
  const [note, setNote] = useState(initial ?? "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-white font-semibold mb-4">{title}</h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          autoFocus
          className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-burgundy-500 placeholder:text-gray-600"
          placeholder="Enter note…"
          data-testid="input-note"
        />
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={() => { onConfirm(note); onClose(); }}
            className="flex-1 py-2.5 bg-burgundy-700 hover:bg-burgundy-600 text-white rounded-lg text-sm font-semibold transition-colors"
            data-testid="button-save-note">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Promo code dialog ─────────────────────────────────────────────────────────

function PromoDialog({
  onApply, onClose,
}: { onApply: (code: string) => { success: boolean; message: string }; onClose: () => void; }) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  function handleApply() {
    const r = onApply(code.trim().toUpperCase());
    setResult(r);
    if (r.success) setTimeout(onClose, 1200);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-xs p-6 shadow-2xl">
        <h2 className="text-white font-semibold mb-4">Apply Promo Code</h2>
        <input
          type="text"
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setResult(null); }}
          placeholder="Enter promo code"
          className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 text-sm font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-burgundy-500 placeholder:text-gray-600"
          data-testid="input-promo-code"
          onKeyDown={(e) => e.key === "Enter" && handleApply()}
          autoFocus
        />
        {result && (
          <p className={`mt-2 text-sm ${result.success ? "text-green-400" : "text-red-400"}`}>{result.message}</p>
        )}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleApply} disabled={!code.trim()}
            className="flex-1 py-2.5 bg-burgundy-700 hover:bg-burgundy-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
            data-testid="button-apply-promo">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Recall dialog ─────────────────────────────────────────────────────────────

function RecallDialog({ onRecall, onClose }: {
  onRecall: (order: OrderType, lines: OrderLineType[]) => void;
  onClose: () => void;
}) {
  type HeldOrder = { id: string; order_number: string; total: number; created_at: string };
  const [held, setHeld] = useState<HeldOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHeldOrders().then((h) => { setHeld(h as HeldOrder[]); }).finally(() => setLoading(false));
  }, []);

  async function recall(heldOrder: HeldOrder) {
    const lines = await getOrderLines(heldOrder.id);
    onRecall(heldOrder as unknown as OrderType, lines);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-white font-semibold mb-4">Recall Held Order</h2>
        {loading ? (
          <div className="text-center text-gray-500 py-8">Loading…</div>
        ) : held.length === 0 ? (
          <div className="text-center text-gray-500 py-8">No held orders</div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {held.map((h) => (
              <button
                key={h.id}
                onClick={() => recall(h)}
                className="w-full flex items-center justify-between bg-gray-800 hover:bg-gray-700 rounded-xl px-4 py-3 transition-colors"
                data-testid={`recall-${h.id}`}
              >
                <div className="text-left">
                  <div className="text-white text-sm font-medium">#{h.order_number}</div>
                  <div className="text-gray-500 text-xs">{new Date(h.created_at).toLocaleTimeString()}</div>
                </div>
                <div className="text-burgundy-400 font-semibold">{formatCurrency(h.total)}</div>
              </button>
            ))}
          </div>
        )}
        <button onClick={onClose} className="mt-4 w-full py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Close</button>
      </div>
    </div>
  );
}

// ── Main POS Screen ───────────────────────────────────────────────────────────

type Dialog = "payment" | "numpad" | "refund" | "note_line" | "note_order" | "promo" | "recall" | "price_check" | null;
type GridLayout = { columns: number; rows: number };
type POSMode = "sell" | "sco" | "shift" | "fallback";

interface PaymentSuccessState {
  total: number;
  method: string;
  changeDue: number;
  tendered: number;
  orderNumber: string;
}

function PaymentSuccessOverlay({
  result,
  onNewOrder,
  onPrint,
}: {
  result: PaymentSuccessState;
  onNewOrder: () => void;
  onPrint: () => void;
}) {
  const methodLabel = result.method
    .replace("card_jcc", "Card — JCC")
    .replace("card_viva", "Card — Viva")
    .replace("card_worldpay", "Card — Worldpay")
    .replace("cash", "Cash")
    .replace("voucher", "Voucher")
    .replace("loyalty", "Loyalty Points")
    .replace("account_credit", "Account Credit")
    .replace("split", "Split Payment");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-sm p-8 shadow-2xl flex flex-col items-center gap-4 text-center">
        {/* Big checkmark */}
        <div className="w-20 h-20 rounded-full bg-green-700 flex items-center justify-center mb-2 shadow-lg shadow-green-900/60">
          <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h2 className="text-white text-2xl font-bold">Payment Success!</h2>
        <p className="text-green-400 text-3xl font-bold">{formatCurrency(result.total)}</p>

        <div className="w-full bg-gray-800 rounded-xl p-4 space-y-2 text-left mt-1">
          {result.orderNumber && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Order</span>
              <span className="text-gray-200 font-medium">#{result.orderNumber}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Payment</span>
            <span className="text-gray-200 font-medium">{methodLabel}</span>
          </div>
          {result.method === "cash" && result.tendered > 0 && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Tendered</span>
                <span className="text-gray-200">{formatCurrency(result.tendered)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-gray-700 pt-2 mt-1">
                <span className="text-gray-300 font-semibold">Change Due</span>
                <span className="text-green-400 font-bold text-base">{formatCurrency(result.changeDue)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Time</span>
            <span className="text-gray-400">{new Date().toLocaleTimeString()}</span>
          </div>
        </div>

        <div className="w-full flex flex-col gap-2.5 mt-2">
          <button
            onClick={onNewOrder}
            className="w-full py-3.5 bg-green-700 hover:bg-green-600 text-white font-bold rounded-xl text-base transition-colors active:scale-[0.98]"
            data-testid="button-new-order"
          >
            New Order
          </button>
          <button
            onClick={onPrint}
            className="w-full py-3 border border-gray-600 hover:border-gray-500 text-gray-300 hover:text-white font-medium rounded-xl text-sm transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
            data-testid="button-print-receipt"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
            </svg>
            Print Receipt
          </button>
        </div>
      </div>
    </div>
  );
}

export function POS({ config, session, sync, onLogout }: POSProps) {
  const engine  = useOrder(session.cashier_id, session.cashier_name, config.terminal_code);
  const perms   = usePermissions(session);
  const hw      = useHardware();
  const shift   = useShift();

  const [products, setProducts]           = useState<Product[]>([]);
  const [categories, setCategories]       = useState<Category[]>([]);
  const [layoutButtons, setLayoutButtons] = useState<LayoutButton[]>([]);
  const [gridLayout, setGridLayout]       = useState<GridLayout>({ columns: 4, rows: 5 });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [dialog, setDialog]               = useState<Dialog>(null);
  const [numpadMode, setNumpadModeState]  = useState<NumpadMode>("qty");
  const [mode, setMode]                   = useState<POSMode>(config.sco_mode ? "sco" : "sell");
  const [paymentSuccess, setPaymentSuccess] = useState<PaymentSuccessState | null>(null);
  const lastReceiptPrinterCallback = useRef<(() => Promise<void>) | null>(null);

  // Load local data on mount
  useEffect(() => {
    getProducts().then(setProducts).catch(() => {});
    getCategories().then(setCategories).catch(() => {});
    getLayout().then((btns) => {
      setLayoutButtons(btns);
      if (btns.length > 0) {
        const maxPos = Math.max(...btns.map((b) => b.position));
        const cols = 4;
        setGridLayout({ columns: cols, rows: Math.ceil((maxPos + 1) / cols) });
      }
    }).catch(() => {});
  }, []);

  // Apply timed prices whenever sync delivers new overrides
  useEffect(() => {
    if (sync.timedPriceOverrides.size > 0) {
      engine.applyTimedPrices(sync.timedPriceOverrides);
    }
  }, [sync.timedPriceOverrides]);

  // Reload products when category changes
  useEffect(() => {
    getProducts(selectedCategory ?? undefined).then(setProducts).catch(() => {});
  }, [selectedCategory]);

  // Customer display: publish order state to shared Tauri store on every change.
  // The CustomerDisplay component (in its own window or same window) polls this store.
  const cdStoreRef = useRef<Awaited<ReturnType<typeof loadStore>> | null>(null);
  useEffect(() => {
    if (!hw.config?.customer_display_enabled) return;

    async function publishDisplayState() {
      try {
        if (!cdStoreRef.current) {
          cdStoreRef.current = await loadStore("customer_display.json");
        }
        const store = cdStoreRef.current;
        const hasLines = engine.lines.length > 0;
        await store.set("state", {
          mode: hasLines ? "scanning" : "idle",
          items: engine.lines.map((l) => ({
            description: l.description,
            qty: l.qty,
            unit_price: l.unit_price,
            line_total: l.line_total,
          })),
          subtotal: engine.order.subtotal,
          vat:      engine.order.vat_amount,
          total:    engine.order.total,
          store_name: config.terminal_name,
        });
        await store.save();
      } catch {
        // Display store unavailable — non-critical
      }
    }

    publishDisplayState();
  }, [engine.lines, engine.order, hw.config?.customer_display_enabled, config.terminal_name]);

  // Start / stop scale weight polling based on config and mode
  useEffect(() => {
    if (hw.config?.scale_enabled && mode === "sell") {
      hw.startWeightPolling(500);
    } else {
      hw.stopWeightPolling();
    }
    return () => hw.stopWeightPolling();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hw.config?.scale_enabled, mode]);

  // Barcode scanner — active only in sell mode with no dialog open
  useBarcode({
    enabled: mode === "sell" && dialog === null,
    onScan: async (barcode) => {
      const { getProductByBarcode } = await import("../lib/db");
      const product = await getProductByBarcode(barcode);
      if (product) engine.addProduct(product);
    },
  });

  // ── Action dispatcher ──────────────────────────────────────────────────────
  const handleAction = useCallback((code: string) => {
    switch (code) {
      case "CLEAR_ORDER":         engine.clearOrder(); break;
      case "VOID_ORDER":          perms.requestAction("void_order", () => { engine.voidOrder(); }); break;
      case "HOLD_ORDER":          engine.holdOrder(); break;
      case "RECALL_ORDER":        setDialog("recall"); break;
      case "REPEAT_LAST":         engine.repeatLastItem(); break;
      case "ADD_LINE_NOTE":       setDialog("note_line"); break;
      case "ADD_NOTE":            setDialog("note_order"); break;
      case "PRICE_CHECK":         setDialog("price_check"); break;
      case "PROMO_CODE":          setDialog("promo"); break;
      case "PRICE_OVERRIDE":      perms.requestAction("price_override", () => { setNumpadModeState("price_override"); setDialog("numpad"); }); break;
      case "LINE_DISCOUNT_PCT":   perms.requestAction("discount", () => { setNumpadModeState("line_discount_pct"); setDialog("numpad"); }); break;
      case "LINE_DISCOUNT_FIXED": perms.requestAction("discount", () => { setNumpadModeState("line_discount_fixed"); setDialog("numpad"); }); break;
      case "ORDER_DISCOUNT_PCT":  perms.requestAction("discount", () => { setNumpadModeState("order_discount_pct"); setDialog("numpad"); }); break;
      case "ORDER_DISCOUNT_FIXED":perms.requestAction("discount", () => { setNumpadModeState("order_discount_fixed"); setDialog("numpad"); }); break;
      case "REMOVE_DISCOUNT":     engine.removeDiscount(); break;
      case "PRICE_LEVEL_1": engine.switchPriceLevel(1); break;
      case "PRICE_LEVEL_2": engine.switchPriceLevel(2); break;
      case "PRICE_LEVEL_3": engine.switchPriceLevel(3); break;
      case "PRICE_LEVEL_4": engine.switchPriceLevel(4); break;
      case "PRICE_LEVEL_5": engine.switchPriceLevel(5); break;
      case "FALLBACK_RULES": setMode("fallback"); break;
      case "PAY_CASH":
      case "PAY_CARD": setDialog("payment"); break;
    }
  }, [engine, perms]);

  // ── Numpad confirm ────────────────────────────────────────────────────────
  function handleNumpadConfirm(value: number) {
    switch (numpadMode) {
      case "qty":                  engine.setQty(value); break;
      case "price_override":       engine.setPriceOverride(value); break;
      case "line_discount_pct":    engine.setLinePct(value); break;
      case "line_discount_fixed":  engine.setLineFixed(value); break;
      case "order_discount_pct":   engine.setOrderPct(value); break;
      case "order_discount_fixed": engine.setOrderFixed(value); break;
    }
  }

  // ── Payment complete ──────────────────────────────────────────────────────
  async function handlePaymentComplete(result: PaymentResult) {
    try {
      // Capture lines before completeOrder clears the order
      const saleLines = [...engine.lines];
      const saleOrder = { ...engine.order };

      const method = result.tenders.length === 1
        ? result.tenders[0].method
        : "split";

      // Gateway auth code from the approved card tender (if any)
      const cardTender = result.tenders.find((t) =>
        t.method.startsWith("card_") && t.approved
      );
      const paymentRef = cardTender?.reference;

      // Publish "payment" mode to customer display before completing
      if (hw.config?.customer_display_enabled && cdStoreRef.current) {
        await cdStoreRef.current.set("state", {
          mode: "payment",
          items: saleLines.map((l) => ({ description: l.description, qty: l.qty, unit_price: l.unit_price, line_total: l.line_total })),
          subtotal: saleOrder.subtotal, vat: saleOrder.vat_amount,
          total: saleOrder.total, payment_method: method,
          amount_tendered: result.totalTendered,
          change_due: result.changeDue,
          store_name: config.terminal_name,
        }).catch(() => {});
        await cdStoreRef.current.save().catch(() => {});
      }

      const completedOrder = await engine.completeOrder(
        method, result.totalTendered,
        session.cashier_id, session.cashier_name,
        paymentRef
      );
      setDialog(null);
      sync.triggerOutboxFlush();

      // Publish "complete" mode to customer display after order finalised
      if (hw.config?.customer_display_enabled && cdStoreRef.current) {
        await cdStoreRef.current.set("state", {
          mode: "complete",
          items: [], subtotal: 0, vat: 0,
          total: completedOrder.total,
          payment_method: method,
          change_due: result.changeDue,
          store_name: config.terminal_name,
        }).catch(() => {});
        await cdStoreRef.current.save().catch(() => {});
      }

      // Record sale in the current shift (updates shift totals for X/Z reports)
      if (shift.isShiftOpen) {
        await shift.recordSale(completedOrder.total, method).catch(() => {});
      }

      // Build receipt lines (reused for both auto-print and manual re-print)
      const colW = (hw.config?.printer_columns ?? 42) as number;
      const pad = (left: string, right: string) => {
        const gap = Math.max(1, colW - left.length - right.length);
        return `${left}${" ".repeat(gap)}${right}`;
      };
      const receiptLines = [
        { text: config.terminal_code, align: "center" as const, bold: true, size: "big" as const },
        { divider: true },
        { text: `Terminal: ${config.terminal_code}  Cashier: ${session.cashier_name}` },
        { text: `Order: ${completedOrder.order_number}  ${new Date().toLocaleString()}` },
        { divider: true },
        ...saleLines.map((l) => ({
          text: pad(
            l.description.substring(0, colW - 10),
            `x${l.qty} ${formatCurrency(l.line_total)}`
          ),
        })),
        { divider: true },
        { text: pad("Subtotal", formatCurrency(saleOrder.subtotal)) },
        { text: pad("VAT", formatCurrency(saleOrder.vat_amount)) },
        { text: pad("TOTAL", formatCurrency(completedOrder.total)), bold: true, size: "big" as const, align: "right" as const },
        { divider: true },
        { text: `Payment: ${method.replace("card_", "Card ").replace("_", " ").toUpperCase()}` },
        ...(result.totalTendered > 0 ? [
          { text: pad("Tendered", formatCurrency(result.totalTendered)) },
          { text: pad("Change", formatCurrency(result.changeDue)) },
        ] : []),
        ...(paymentRef ? [{ text: `Auth: ${paymentRef}` }] : []),
        { divider: true },
        { text: "Thank you for your purchase!", align: "center" as const },
      ];

      // Store for re-print from success overlay
      lastReceiptPrinterCallback.current = () => hw.printReceipt(receiptLines);

      // Auto-print if printer available
      if (hw.printerStatus === "online" && hw.config?.printer_enabled) {
        await hw.printReceipt(receiptLines);
      }

      // Open cash drawer for cash payments
      const hasCash = result.tenders.some((t) => t.method === "cash");
      if (hasCash && hw.config?.drawer_enabled) {
        await hw.openDrawer();
      }

      // Show success overlay
      setPaymentSuccess({
        total: completedOrder.total,
        method,
        changeDue: result.changeDue,
        tendered: result.totalTendered,
        orderNumber: completedOrder.order_number ?? "",
      });
    } catch (e) {
      console.error("Payment complete failed:", e);
    }
  }

  // ── Special modes ─────────────────────────────────────────────────────────

  if (mode === "sco") {
    return (
      <SelfCheckout
        cashierId={session.cashier_id}
        cashierName={session.cashier_name}
        terminalPrefix={config.terminal_code}
        onExit={() => setMode("sell")}
      />
    );
  }

  if (mode === "shift") {
    return (
      <ShiftManager
        cashierId={session.cashier_id}
        cashierName={session.cashier_name}
        terminalName={config.terminal_name}
        onPrint={(lines) => hw.printReceipt(lines)}
        onClose={() => setMode("sell")}
      />
    );
  }

  if (mode === "fallback") {
    return <FallbackRules onClose={() => setMode("sell")} />;
  }

  const selectedLine = engine.lines.find((l) => l.id === engine.selectedLineId);
  const hasLines = engine.lines.length > 0;

  return (
    <div className="flex flex-col h-screen bg-gray-950 overflow-hidden">
      {/* Sync header */}
      <SyncHeader
        config={config}
        session={session}
        syncStatus={sync.status}
        notifications={sync.notifications}
        onSyncCatalog={sync.triggerCatalogSync}
        onLogout={onLogout}
      />

      {/* Category nav */}
      <CategoryNav
        categories={categories}
        selectedId={selectedCategory}
        onSelect={setSelectedCategory}
      />

      {/* Scale bar — shown when scale is connected */}
      {hw.config?.scale_enabled && (
        <ScaleBar
          weight={hw.scaleWeight}
          error={hw.scaleError}
          onTare={hw.tare}
        />
      )}

      {/* Main content: grid + ticket */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <LayoutGrid
            buttons={layoutButtons}
            products={products}
            columns={gridLayout.columns}
            rows={gridLayout.rows}
            priceLevel={engine.order.price_level}
            onItemButton={engine.addProduct}
            onCategoryButton={setSelectedCategory}
            onActionButton={handleAction}
          />
        </div>

        <OrderTicket
          order={engine.order}
          lines={engine.lines}
          selectedLineId={engine.selectedLineId}
          onSelectLine={engine.selectLine}
          onAddQty={engine.addQty}
          onSubQty={engine.subtractQty}
          onRemoveLine={engine.removeLine}
          onVoidLine={() => perms.requestAction("void_line", engine.voidLine)}
          onPay={() => setDialog("payment")}
          onClear={engine.clearOrder}
        />
      </div>

      {/* Action bar — with Phase 3 buttons */}
      <ActionBar
        hasLines={hasLines}
        hasSelectedLine={!!selectedLine && !selectedLine.voided}
        onHold={engine.holdOrder}
        onRecall={() => setDialog("recall")}
        onVoidOrder={() => perms.requestAction("void_order", () => engine.voidOrder())}
        onLineNote={() => setDialog("note_line")}
        onOrderNote={() => setDialog("note_order")}
        onRepeatLast={engine.repeatLastItem}
        onNumpad={(m) => { setNumpadModeState(m); setDialog("numpad"); }}
        onPromoCode={() => setDialog("promo")}
        onFallbackRules={() => setMode("fallback")}
        onRemoveDiscount={engine.removeDiscount}
        onRefund={() => setDialog("refund")}
        onShift={() => setMode("shift")}
        onSco={() => setMode("sco")}
      />

      {/* ── Dialogs ── */}

      {/* Full PaymentDialog (Phase 3) — replaces the simple inline PayDialog */}
      <PaymentDialog
        open={dialog === "payment"}
        orderTotal={engine.order.total}
        onComplete={handlePaymentComplete}
        onCancel={() => setDialog(null)}
      />

      {/* RefundDialog (Phase 3) */}
      <RefundDialog
        open={dialog === "refund"}
        cashierId={session.cashier_id}
        cashierName={session.cashier_name}
        onComplete={(refundTotal, method) => {
          setDialog(null);
          sync.triggerOutboxFlush();
          // Open drawer for cash refunds
          if (method === "cash" && hw.config?.drawer_enabled) {
            hw.openDrawer();
          }
        }}
        onCancel={() => setDialog(null)}
      />

      {dialog === "numpad" && (
        <Numpad
          mode={numpadMode}
          currentValue={numpadMode === "qty" ? selectedLine?.qty : undefined}
          onConfirm={handleNumpadConfirm}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "note_line" && (
        <NoteDialog
          title="Line Note"
          initial={selectedLine?.note}
          onConfirm={engine.addLineNote}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "note_order" && (
        <NoteDialog
          title="Order Note"
          initial={engine.order.note}
          onConfirm={engine.addOrderNote}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "promo" && (
        <PromoDialog
          onApply={engine.applyPromoCode}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "recall" && (
        <RecallDialog
          onRecall={(heldOrder, heldLines) => { engine.recallOrder(heldOrder, heldLines); }}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Permission PIN prompt */}
      {perms.pinPromptAction && perms.pinPromptRole && (
        <PinPrompt
          action={perms.pinPromptAction}
          requiredRole={perms.pinPromptRole}
          onGranted={perms.onPinGranted}
          onDenied={perms.onPinDenied}
        />
      )}

      {/* Customer display — reads from Tauri store; rendered when enabled */}
      {hw.config?.customer_display_enabled && <CustomerDisplay />}

      {/* Payment success overlay */}
      {paymentSuccess && (
        <PaymentSuccessOverlay
          result={paymentSuccess}
          onNewOrder={() => setPaymentSuccess(null)}
          onPrint={() => {
            lastReceiptPrinterCallback.current?.();
          }}
        />
      )}
    </div>
  );
}
