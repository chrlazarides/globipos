/**
 * Main POS selling screen.
 * Layout: [Category Nav + Layout Grid] | [Order Ticket]
 * Bottom: Action Bar
 * Top: Sync Header
 */
import { useState, useEffect, useCallback } from "react";
import type { Product, Category, LayoutButton, CashierSession, TerminalConfig, NumpadMode, Order as OrderType, OrderLine as OrderLineType } from "../types";
import { getProducts, getCategories, getLayout, getHeldOrders, getOrderLines } from "../lib/db";
import { formatCurrency } from "../lib/pricing";
import { useOrder } from "../hooks/useOrder";
import { useBarcode } from "../hooks/useBarcode";
import { usePermissions } from "../hooks/usePermissions";
import { SyncHeader } from "../components/SyncHeader";
import { CategoryNav } from "../components/CategoryNav";
import { LayoutGrid } from "../components/LayoutGrid";
import { OrderTicket } from "../components/OrderTicket";
import { Numpad } from "../components/Numpad";
import { ActionBar } from "../components/ActionBar";
import { PinPrompt } from "../components/PinPrompt";
import { FallbackRules } from "./FallbackRules";
import type { UseSyncReturn } from "../hooks/useSync";

interface POSProps {
  config: TerminalConfig;
  session: CashierSession;
  sync: UseSyncReturn;
  onLogout: () => void;
}

// ── Payment dialog ────────────────────────────────────────────────────────────

function PayDialog({
  total,
  onPay,
  onClose,
}: {
  total: number;
  onPay: (method: string, tendered: number) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [tendered, setTendered] = useState(total.toFixed(2));

  const change = Math.max(0, parseFloat(tendered || "0") - total);
  const methods = ["cash", "card"] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-white font-bold text-xl mb-5">Payment</h2>

        {/* Total */}
        <div className="bg-gray-800 rounded-xl px-4 py-3 mb-5 text-center">
          <div className="text-gray-400 text-sm">Amount Due</div>
          <div className="text-white text-3xl font-bold">{formatCurrency(total)}</div>
        </div>

        {/* Payment method */}
        <div className="flex gap-2 mb-4">
          {methods.map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`flex-1 py-2.5 rounded-lg font-semibold text-sm capitalize transition-colors ${
                method === m
                  ? m === "cash" ? "bg-green-700 text-white" : "bg-blue-700 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
              data-testid={`pay-method-${m}`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Cash tendered */}
        {method === "cash" && (
          <div className="mb-4">
            <label className="text-gray-400 text-sm block mb-1.5">Cash Tendered</label>
            <input
              type="number"
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-xl font-mono rounded-lg px-4 py-3 text-right focus:outline-none focus:ring-2 focus:ring-burgundy-500"
              data-testid="input-tendered"
              autoFocus
            />
            {change > 0 && (
              <div className="text-green-400 text-sm mt-2 text-right">
                Change: <span className="font-bold">{formatCurrency(change)}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onPay(method, method === "cash" ? parseFloat(tendered || String(total)) : total)}
            className="flex-2 flex-[2] py-3 bg-green-700 hover:bg-green-600 text-white rounded-xl font-bold text-lg transition-colors"
            data-testid="button-confirm-pay"
          >
            {method === "cash" ? "Confirm Cash" : "Confirm Card"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Note input dialog ─────────────────────────────────────────────────────────

function NoteDialog({
  title,
  initial,
  onConfirm,
  onClose,
}: {
  title: string;
  initial?: string;
  onConfirm: (note: string) => void;
  onClose: () => void;
}) {
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
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
            Cancel
          </button>
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
  onApply,
  onClose,
}: {
  onApply: (code: string) => { success: boolean; message: string };
  onClose: () => void;
}) {
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
          <p className={`mt-2 text-sm ${result.success ? "text-green-400" : "text-red-400"}`}>
            {result.message}
          </p>
        )}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
            Cancel
          </button>
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

function RecallDialog({
  onRecall,
  onClose,
}: {
  onRecall: (order: OrderType, lines: OrderLineType[]) => void;
  onClose: () => void;
}) {
  type HeldOrder = { id: string; order_number: string; total: number; created_at: string };
  const [held, setHeld] = useState<HeldOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHeldOrders().then((h) => {
      setHeld(h as HeldOrder[]);
    }).finally(() => setLoading(false));
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
        <button onClick={onClose} className="mt-4 w-full py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
          Close
        </button>
      </div>
    </div>
  );
}

// ── Main POS Screen ───────────────────────────────────────────────────────────

type Dialog = "pay" | "numpad" | "note_line" | "note_order" | "promo" | "recall" | "price_check" | null;
type GridLayout = { columns: number; rows: number };

export function POS({ config, session, sync, onLogout }: POSProps) {
  const engine = useOrder(session.cashier_id, session.cashier_name, config.terminal_code);
  const perms  = usePermissions(session);

  const [products, setProducts]         = useState<Product[]>([]);
  const [categories, setCategories]     = useState<Category[]>([]);
  const [layoutButtons, setLayoutButtons] = useState<LayoutButton[]>([]);
  const [gridLayout, setGridLayout]     = useState<GridLayout>({ columns: 4, rows: 5 });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [dialog, setDialog]             = useState<Dialog>(null);
  const [numpadMode, setNumpadModeState] = useState<NumpadMode>("qty");
  const [showFallback, setShowFallback] = useState(false);

  // Load local data on mount
  useEffect(() => {
    getProducts().then(setProducts).catch(() => {});
    getCategories().then(setCategories).catch(() => {});
    getLayout().then((btns) => {
      setLayoutButtons(btns);
      // Auto-detect grid size from max position
      if (btns.length > 0) {
        const maxPos = Math.max(...btns.map((b) => b.position));
        const cols = 4; // default; server sets this via layout set
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

  // Barcode scanner
  useBarcode({
    enabled: dialog === null && !showFallback,
    onScan: async (barcode) => {
      const { getProductByBarcode } = await import("../lib/db");
      const product = await getProductByBarcode(barcode);
      if (product) {
        engine.addProduct(product);
      } else {
        // Trigger search with the barcode value
        setProducts([]);
      }
    },
  });

  // ── Action dispatcher (from layout grid action buttons and action bar) ──────
  const handleAction = useCallback((code: string) => {
    switch (code) {
      case "CLEAR_ORDER":    engine.clearOrder(); break;
      case "VOID_ORDER":     perms.requestAction("void_order", () => { engine.voidOrder(); }); break;
      case "HOLD_ORDER":     engine.holdOrder(); break;
      case "RECALL_ORDER":   setDialog("recall"); break;
      case "REPEAT_LAST":    engine.repeatLastItem(); break;
      case "ADD_LINE_NOTE":  setDialog("note_line"); break;
      case "ADD_NOTE":       setDialog("note_order"); break;
      case "PRICE_CHECK":    setDialog("price_check"); break;
      case "PROMO_CODE":     setDialog("promo"); break;
      case "PRICE_OVERRIDE": perms.requestAction("price_override", () => { setNumpadModeState("price_override"); setDialog("numpad"); }); break;
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
      case "FALLBACK_RULES": setShowFallback(true); break;
      case "PAY_CASH":
      case "PAY_CARD":       setDialog("pay"); break;
    }
  }, [engine, perms]);

  // ── Numpad confirm ────────────────────────────────────────────────────────────
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

  // ── Pay ───────────────────────────────────────────────────────────────────────
  async function handlePay(method: string, tendered: number) {
    try {
      const completed = await engine.completeOrder(method, tendered, session.cashier_id, session.cashier_name);
      setDialog(null);
      // Trigger outbox flush
      sync.triggerOutboxFlush();
    } catch (e) {
      console.error("Pay failed:", e);
    }
  }

  if (showFallback) {
    return <FallbackRules onClose={() => setShowFallback(false)} />;
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

      {/* Main content: grid + ticket */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Layout grid */}
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

        {/* Right: Order ticket */}
        <OrderTicket
          order={engine.order}
          lines={engine.lines}
          selectedLineId={engine.selectedLineId}
          onSelectLine={engine.selectLine}
          onAddQty={engine.addQty}
          onSubQty={engine.subtractQty}
          onRemoveLine={engine.removeLine}
          onVoidLine={() => perms.requestAction("void_line", engine.voidLine)}
          onPay={() => setDialog("pay")}
          onClear={engine.clearOrder}
        />
      </div>

      {/* Action bar */}
      <ActionBar
        hasLines={hasLines}
        hasSelectedLine={!!selectedLine && !selectedLine.voided}
        onHold={engine.holdOrder}
        onRecall={() => setDialog("recall")}
        onVoidOrder={() => perms.requestAction("void_order", () => engine.voidOrder())}
        onLineNote={() => setDialog("note_line")}
        onOrderNote={() => setDialog("note_order")}
        onRepeatLast={engine.repeatLastItem}
        onNumpad={(mode) => { setNumpadModeState(mode); setDialog("numpad"); }}
        onPromoCode={() => setDialog("promo")}
        onFallbackRules={() => setShowFallback(true)}
        onRemoveDiscount={engine.removeDiscount}
      />

      {/* ── Dialogs ── */}

      {dialog === "pay" && (
        <PayDialog
          total={engine.order.total}
          onPay={handlePay}
          onClose={() => setDialog(null)}
        />
      )}

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
          onRecall={(heldOrder, heldLines) => {
            engine.recallOrder(heldOrder, heldLines);
          }}
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
    </div>
  );
}
