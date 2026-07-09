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
import { open as openShell } from "@tauri-apps/plugin-shell";
import type {
  Product, Category, LayoutButton, CashierSession, TerminalConfig,
  NumpadMode, Order as OrderType, OrderLine as OrderLineType,
} from "../types";
import { getProducts, getProductByBarcode, getCategories, getLayout, getHeldOrders, getOrderLines, issueCreditNote, issueGiftVoucher, redeemCreditNote, redeemGiftVoucher, getStockByLocation, getPosLocations, createStockTransfer } from "../lib/db";
import { formatCurrency } from "../lib/pricing";
import { useOrder } from "../hooks/useOrder";
import { useBarcode } from "../hooks/useBarcode";
import { usePermissions } from "../hooks/usePermissions";
import { useHardware } from "../hooks/useHardware";
import { useShift } from "../hooks/useShift";
import { usePosTheme } from "../hooks/usePosTheme";
import { useResponsiveColumns, type LayoutColumnConfig } from "../hooks/useWindowSize";
import { SyncHeader } from "../components/SyncHeader";
import { CategoryNav } from "../components/CategoryNav";
import { LayoutGrid } from "../components/LayoutGrid";
import { OrderTicket } from "../components/OrderTicket";
import { CorrectionsPanel } from "../components/CorrectionsPanel";
import { PriceCheckDialog } from "../components/PriceCheckDialog";
import { StockTransferDialog } from "../components/StockTransferDialog";
import { Numpad } from "../components/Numpad";
import { ActionBar } from "../components/ActionBar";
import { PinPrompt } from "../components/PinPrompt";
import ScaleBar from "../components/ScaleBar";
import CustomerDisplay from "../components/CustomerDisplay";
import PaymentDialog from "../components/PaymentDialog";
import RefundDialog from "../components/RefundDialog";
import type { PaymentResult } from "../hooks/usePayment";
import { FallbackRules } from "./FallbackRules";
import { BarcodeConfig } from "./BarcodeConfig";
import type { BarcodeConfig as BarcodeConfigType } from "../types";
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

// ── Cash journal dialog (cash-in / cash-out / petty cash) ────────────────────

const CASH_DIALOG_LABELS: Record<"cash_in" | "cash_out" | "petty_cash", string> = {
  cash_in: "Cash In",
  cash_out: "Cash Out",
  petty_cash: "Petty Cash",
};

function CashDialog({
  mode, onConfirm, onClose,
}: { mode: "cash_in" | "cash_out" | "petty_cash"; onConfirm: (amount: number, note: string) => void; onClose: () => void; }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const parsed = parseFloat(amount) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-white font-semibold mb-4">{CASH_DIALOG_LABELS[mode]}</h2>
        <label className="text-gray-400 text-xs mb-1 block">Amount</label>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          autoFocus
          className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-burgundy-500"
          data-testid="input-cash-dialog-amount"
        />
        <label className="text-gray-400 text-xs mb-1 block">Note</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason (optional)"
          className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-burgundy-500"
          data-testid="input-cash-dialog-note"
        />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Cancel</button>
          <button
            onClick={() => { if (parsed > 0) { onConfirm(parsed, note); onClose(); } }}
            disabled={parsed <= 0}
            className="flex-1 py-2.5 bg-burgundy-700 hover:bg-burgundy-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
            data-testid="button-confirm-cash-dialog"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Department sale dialog ────────────────────────────────────────────────────

function DeptSaleDialog({
  categories, onConfirm, onClose,
}: { categories: Category[]; onConfirm: (category: Category, amount: number) => void; onClose: () => void; }) {
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const parsed = parseFloat(amount) || 0;
  const selected = categories.find((c) => c.id === categoryId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-white font-semibold mb-4">Department Sale</h2>
        <label className="text-gray-400 text-xs mb-1 block">Department</label>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-burgundy-500"
          data-testid="select-dept-sale-category"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label className="text-gray-400 text-xs mb-1 block">Amount</label>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          autoFocus
          className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-burgundy-500"
          data-testid="input-dept-sale-amount"
        />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Cancel</button>
          <button
            onClick={() => { if (selected && parsed > 0) { onConfirm(selected, parsed); onClose(); } }}
            disabled={!selected || parsed <= 0}
            className="flex-1 py-2.5 bg-burgundy-700 hover:bg-burgundy-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
            data-testid="button-confirm-dept-sale"
          >
            Add to Order
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Issue credit note dialog ──────────────────────────────────────────────────

function IssueCreditNoteDialog({
  onIssue, onClose,
}: { onIssue: (amount: number, reason: string) => Promise<{ code: string }>; onClose: () => void; }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parseFloat(amount) || 0;

  async function handleIssue() {
    if (parsed <= 0 || busy) return;
    setBusy(true);
    try {
      const result = await onIssue(parsed, reason);
      setIssuedCode(result.code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-white font-semibold mb-4">Issue Credit Note</h2>
        {issuedCode ? (
          <div className="text-center py-4">
            <p className="text-gray-400 text-sm mb-2">Credit note issued</p>
            <p className="text-2xl font-mono font-bold text-burgundy-400" data-testid="text-issued-credit-note-code">{issuedCode}</p>
            <p className="text-gray-500 text-xs mt-2">Give this code to the customer for redemption</p>
          </div>
        ) : (
          <>
            <label className="text-gray-400 text-xs mb-1 block">Amount</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-burgundy-500"
              data-testid="input-issue-credit-note-amount"
            />
            <label className="text-gray-400 text-xs mb-1 block">Reason</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-burgundy-500"
              data-testid="input-issue-credit-note-reason"
            />
          </>
        )}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
            {issuedCode ? "Done" : "Cancel"}
          </button>
          {!issuedCode && (
            <button
              onClick={handleIssue}
              disabled={parsed <= 0 || busy}
              className="flex-1 py-2.5 bg-burgundy-700 hover:bg-burgundy-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
              data-testid="button-confirm-issue-credit-note"
            >
              {busy ? "Issuing…" : "Issue"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Issue gift voucher dialog ────────────────────────────────────────────────

function IssueVoucherDialog({
  onIssue, onClose,
}: { onIssue: (amount: number) => Promise<{ code: string }>; onClose: () => void; }) {
  const [amount, setAmount] = useState("");
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parseFloat(amount) || 0;

  async function handleIssue() {
    if (parsed <= 0 || busy) return;
    setBusy(true);
    try {
      const result = await onIssue(parsed);
      setIssuedCode(result.code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        <h2 className="text-white font-semibold mb-4">Sell Gift Voucher</h2>
        {issuedCode ? (
          <div className="text-center py-4">
            <p className="text-gray-400 text-sm mb-2">Gift voucher issued</p>
            <p className="text-2xl font-mono font-bold text-burgundy-400" data-testid="text-issued-voucher-code">{issuedCode}</p>
            <p className="text-gray-500 text-xs mt-2">Give this code to the customer for redemption</p>
          </div>
        ) : (
          <>
            <label className="text-gray-400 text-xs mb-1 block">Amount</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-burgundy-500"
              data-testid="input-issue-voucher-amount"
            />
          </>
        )}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
            {issuedCode ? "Done" : "Cancel"}
          </button>
          {!issuedCode && (
            <button
              onClick={handleIssue}
              disabled={parsed <= 0 || busy}
              className="flex-1 py-2.5 bg-burgundy-700 hover:bg-burgundy-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
              data-testid="button-confirm-issue-voucher"
            >
              {busy ? "Issuing…" : "Issue"}
            </button>
          )}
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

type Dialog = "payment" | "numpad" | "refund" | "note_line" | "note_order" | "promo" | "recall" | "price_check" | "cash_dialog" | "dept_sale" | "issue_credit_note" | "issue_voucher" | "stock_transfer" | null;
type CashDialogMode = "cash_in" | "cash_out" | "petty_cash";
type POSMode = "sell" | "sco" | "shift" | "fallback" | "barcode_config";

interface PaymentSuccessState {
  total: number;
  method: string;
  changeDue: number;
  tendered: number;
  orderNumber: string;
  cardRef?: string;
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
          {result.cardRef && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Card Ref</span>
              <span className="text-gray-200 font-mono" data-testid="text-success-card-ref">{result.cardRef}</span>
            </div>
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
  const { theme: posTheme, toggleTheme } = usePosTheme();

  const [products, setProducts]           = useState<Product[]>([]);
  const [categories, setCategories]       = useState<Category[]>([]);
  const [layoutButtons, setLayoutButtons] = useState<LayoutButton[]>([]);
  const [layoutConfig, setLayoutConfig]   = useState<LayoutColumnConfig | null>(null);
  const [maxButtonPos, setMaxButtonPos]   = useState(19); // default 4×5-1

  // Responsive column count — recalculates live on window resize.
  // Depends on layoutConfig state so must be declared after it.
  const activeColumns = useResponsiveColumns(layoutConfig);
  const activeRows    = Math.ceil((maxButtonPos + 1) / activeColumns);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [dialog, setDialog]               = useState<Dialog>(null);
  const [numpadMode, setNumpadModeState]  = useState<NumpadMode>("qty");
  const [cashDialogMode, setCashDialogMode] = useState<CashDialogMode>("cash_in");
  const [mode, setMode]                   = useState<POSMode>(config.sco_mode ? "sco" : "sell");
  const [paymentSuccess, setPaymentSuccess] = useState<PaymentSuccessState | null>(null);
  const lastReceiptPrinterCallback = useRef<(() => Promise<void>) | null>(null);
  const barcodeConfigRef = useRef<BarcodeConfigType | null>(null);
  const [receiptLanguage, setReceiptLanguage] = useState<"en" | "el">(
    () => (localStorage.getItem("pos_receipt_language") as "en" | "el") || "en"
  );
  const toggleLanguage = useCallback(() => {
    setReceiptLanguage((prev) => {
      const next = prev === "en" ? "el" : "en";
      localStorage.setItem("pos_receipt_language", next);
      return next;
    });
  }, []);

  // Responsive column config — fetch from server once on mount.
  // Uses X-Terminal-Code header (no API key needed) to get the layout
  // set's per-breakpoint column counts. Falls back to defaults silently.
  useEffect(() => {
    const base = config.server_url.replace(/\/$/, "");
    fetch(`${base}/api/pos/sync/layout-config`, {
      headers: { "X-Terminal-Code": config.terminal_code },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setLayoutConfig(data); })
      .catch(() => {/* no-op: defaults apply */});
  }, [config.server_url, config.terminal_code]);

  // Load barcode structure config once on mount (used to parse weight/price scale barcodes)
  useEffect(() => {
    import("../lib/db").then(({ getBarcodeConfig }) =>
      getBarcodeConfig().then((cfg) => { barcodeConfigRef.current = cfg; }).catch(() => {})
    );
  }, []);

  // Load local data on mount
  useEffect(() => {
    getProducts().then(setProducts).catch(() => {});
    getCategories().then(setCategories).catch(() => {});
    getLayout().then((btns) => {
      setLayoutButtons(btns);
      if (btns.length > 0) {
        setMaxButtonPos(Math.max(...btns.map((b) => b.position)));
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

  // Signage polling state
  const [signage, setSignage] = useState<any[]>([]);
  useEffect(() => {
    const fetchSignage = async () => {
      try {
        const base = config.server_url.replace(/\/$/, "");
        const resp = await fetch(`${base}/api/pos/signage/playlist`, {
          headers: { "X-Terminal-Code": config.terminal_code },
        });
        if (resp.ok) {
          const data = await resp.json();
          setSignage(data.items || []);
        }
      } catch (err) {
        console.error("Signage fetch error:", err);
      }
    };
    fetchSignage();
    const timer = setInterval(fetchSignage, 5 * 60 * 1000); // Poll every 5 minutes
    return () => clearInterval(timer);
  }, [config.server_url, config.terminal_code]);

  useEffect(() => {
    if (!hw.config?.customer_display_enabled && !hw.config?.vfd_enabled) return;

    async function publishDisplayState() {
      try {
        if (!cdStoreRef.current) {
          cdStoreRef.current = await loadStore("customer_display.json");
        }
        const store = cdStoreRef.current;
        const hasLines = engine.lines.length > 0;
        
        // Push to secondary screen multimedia display
        if (hw.config?.customer_display_enabled) {
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
            signage,
          });
          await store.save();
        }

        // Push to hardware VFD (serial 2x20)
        if (hw.config?.vfd_enabled) {
          if (hasLines) {
            const lastLine = engine.lines[engine.lines.length - 1];
            const line1 = lastLine.description.toUpperCase();
            const line2 = `TOTAL: €${engine.order.total.toFixed(2)}`;
            hw.writeVfd(line1, line2);
          } else {
            hw.writeVfd("WELCOME", config.terminal_name.toUpperCase());
          }
        }
      } catch {
        // ignore — window may be closing
      }
    }

    publishDisplayState();
  }, [engine.lines, engine.order, hw.config, signage, config.terminal_name]);

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
      const { parseScaleBarcode, DEFAULT_BARCODE_CONFIG } = await import("../lib/scaleBarcode");

      const scale = parseScaleBarcode(barcode, barcodeConfigRef.current ?? DEFAULT_BARCODE_CONFIG);

      if (scale) {
        // Try the 5-digit PLU first; fall back to the full barcode
        let product = await getProductByBarcode(scale.plu);
        if (!product) product = await getProductByBarcode(barcode);

        if (product) {
          if (scale.type === "weight" && scale.value > 0) {
            // qty = weight in kg (e.g. 1.500)
            engine.addProduct(product, parseFloat(scale.value.toFixed(3)));
          } else if (scale.type === "price" && scale.value > 0) {
            // embedded price overrides the catalogue price
            engine.addProduct(product, 1, parseFloat(scale.value.toFixed(2)));
          } else {
            // PLU-only — plain add at qty 1
            engine.addProduct(product);
          }
        }
      } else {
        // Standard (non-scale) barcode lookup
        const product = await getProductByBarcode(barcode);
        if (product) engine.addProduct(product);
      }
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
      case "CORRECTION":          engine.correction(); break;
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
      case "BARCODE_CONFIG": setMode("barcode_config"); break;
      case "PAY_CASH":
      case "PAY_CARD": setDialog("payment"); break;
      // ── Quantity multiplier before scan ──────────────────────────────────
      case "NUMPAD": setNumpadModeState("qty_multiplier"); setDialog("numpad"); break;
      // ── Cash drawer & journal group ──────────────────────────────────────
      case "OPEN_DRAWER": hw.openDrawer(); break;
      case "NO_SALE": shift.noSale(); break;
      case "CASH_IN": setCashDialogMode("cash_in"); setDialog("cash_dialog"); break;
      case "CASH_OUT": setCashDialogMode("cash_out"); setDialog("cash_dialog"); break;
      case "PETTY_CASH": setCashDialogMode("petty_cash"); setDialog("cash_dialog"); break;
      case "DECLARE_CASH": setMode("shift"); break;
      // ── Surcharge % ───────────────────────────────────────────────────────
      case "SURCHARGE_PCT": perms.requestAction("discount", () => { setNumpadModeState("surcharge_pct"); setDialog("numpad"); }); break;
      case "LINE_SURCHARGE_PCT": perms.requestAction("discount", () => { setNumpadModeState("line_surcharge_pct"); setDialog("numpad"); }); break;
      // ── Department-key sale ──────────────────────────────────────────────
      case "DEPT_SALE": setDialog("dept_sale"); break;
      // ── Credit notes ──────────────────────────────────────────────────────
      case "ISSUE_CREDIT_NOTE": perms.requestAction("discount", () => { setDialog("issue_credit_note"); }); break;
      case "REDEEM_CREDIT_NOTE": setDialog("payment"); break;
      // ── Gift vouchers ────────────────────────────────────────────────────
      case "ISSUE_VOUCHER": perms.requestAction("discount", () => { setDialog("issue_voucher"); }); break;
      // ── Re-print last invoice ────────────────────────────────────────────
      case "REPRINT_LAST":
        if (lastReceiptPrinterCallback.current) {
          lastReceiptPrinterCallback.current();
        } else {
          alert("No recent receipt available to re-print.");
        }
        break;
      // ── Language switch (receipt labels) ────────────────────────────────
      case "TOGGLE_LANGUAGE": toggleLanguage(); break;
    }
  }, [engine, perms, hw, shift, toggleLanguage]);

  // ── Numpad confirm ────────────────────────────────────────────────────────
  function handleNumpadConfirm(value: number) {
    switch (numpadMode) {
      case "qty":                  engine.setQty(value); break;
      case "price_override":       engine.setPriceOverride(value); break;
      case "line_discount_pct":    engine.setLinePct(value); break;
      case "line_discount_fixed":  engine.setLineFixed(value); break;
      case "order_discount_pct":   engine.setOrderPct(value); break;
      case "order_discount_fixed": engine.setOrderFixed(value); break;
      case "qty_multiplier":       engine.setPendingMultiplier(value); break;
      case "surcharge_pct":        engine.setSurchargePct(value); break;
      case "line_surcharge_pct":   engine.setLineSurcharge(value); break;
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

      // Settle any validated voucher / credit-note tenders against their DB balance.
      // (Free-text/legacy voucher tenders with no settleId are skipped — nothing to redeem.)
      for (const tender of result.tenders) {
        if (tender.method === "voucher" && tender.settleId) {
          await redeemGiftVoucher(tender.settleId, tender.amount).catch((err) => {
            console.error("Failed to redeem gift voucher", tender.settleId, err);
          });
        } else if (tender.method === "credit_note" && tender.settleId) {
          await redeemCreditNote(tender.settleId, tender.amount).catch((err) => {
            console.error("Failed to redeem credit note", tender.settleId, err);
          });
        }
      }

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
      const RECEIPT_LABELS = {
        en: { terminal: "Terminal", cashier: "Cashier", order: "Order", subtotal: "Subtotal", vat: "VAT", total: "TOTAL", payment: "Payment", tendered: "Tendered", change: "Change", cardRef: "Card Ref", thankYou: "Thank you for your purchase!" },
        el: { terminal: "Ταμείο", cashier: "Ταμίας", order: "Παραγγελία", subtotal: "Υποσύνολο", vat: "ΦΠΑ", total: "ΣΥΝΟΛΟ", payment: "Πληρωμή", tendered: "Δόθηκε", change: "Ρέστα", cardRef: "Κωδ. Κάρτας", thankYou: "Ευχαριστούμε για την προτίμησή σας!" },
      } as const;
      const t = RECEIPT_LABELS[receiptLanguage];
      const receiptLines = [
        { text: config.terminal_code, align: "center" as const, bold: true, size: "big" as const },
        { divider: true },
        { text: `${t.terminal}: ${config.terminal_code}  ${t.cashier}: ${session.cashier_name}` },
        { text: `${t.order}: ${completedOrder.order_number}  ${new Date().toLocaleString()}` },
        { divider: true },
        ...saleLines.map((l) => ({
          text: pad(
            l.description.substring(0, colW - 10),
            `x${l.qty} ${formatCurrency(l.line_total)}`
          ),
        })),
        { divider: true },
        { text: pad(t.subtotal, formatCurrency(saleOrder.subtotal)) },
        { text: pad(t.vat, formatCurrency(saleOrder.vat_amount)) },
        { text: pad(t.total, formatCurrency(completedOrder.total)), bold: true, size: "big" as const, align: "right" as const },
        { divider: true },
        { text: `${t.payment}: ${method.replace("card_", "Card ").replace("_", " ").toUpperCase()}` },
        ...(result.totalTendered > 0 ? [
          { text: pad(t.tendered, formatCurrency(result.totalTendered)) },
          { text: pad(t.change, formatCurrency(result.changeDue)) },
        ] : []),
        ...(paymentRef ? [{ text: `${t.cardRef}: ${paymentRef}` }] : []),
        { divider: true },
        { text: t.thankYou, align: "center" as const },
      ];

      // Store for re-print from success overlay
      lastReceiptPrinterCallback.current = async () => { await hw.printReceipt(receiptLines); };

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
        cardRef: paymentRef,
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

  if (mode === "barcode_config") {
    return (
      <BarcodeConfig
        onClose={() => {
          import("../lib/db").then(({ getBarcodeConfig }) =>
            getBarcodeConfig().then((cfg) => { barcodeConfigRef.current = cfg; }).catch(() => {})
          );
          setMode("sell");
        }}
      />
    );
  }

  const selectedLine = engine.lines.find((l) => l.id === engine.selectedLineId);
  const hasLines = engine.lines.length > 0;

  const isLightTheme = posTheme === "light";

  return (
    <div className={`flex flex-col h-screen overflow-hidden ${isLightTheme ? "bg-slate-100" : "bg-gray-950"}`}>
      {/* Sync header */}
      <SyncHeader
        config={config}
        session={session}
        syncStatus={sync.status}
        peripheralHealth={sync.peripheralHealth}
        notifications={sync.notifications}
        theme={posTheme}
        onToggleTheme={toggleTheme}
        onSyncCatalog={sync.triggerCatalogSync}
        onLogout={onLogout}
      />

      {/* Category nav */}
      <CategoryNav
        categories={categories}
        selectedId={selectedCategory}
        onSelect={setSelectedCategory}
        theme={posTheme}
      />

      {/* Scale bar — shown when scale is connected */}
      {hw.config?.scale_enabled && (
        <ScaleBar
          weight={hw.scaleWeight}
          error={hw.scaleError}
          onTare={hw.tare}
        />
      )}

      {/* Main content: journal + corrections/numpad panel + grid (journal → keypad → items) */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
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
          theme={posTheme}
        />

        <CorrectionsPanel
          selectedLine={selectedLine ?? null}
          hasLines={hasLines}
          theme={posTheme}
          onSetQty={(qty) => engine.setQty(qty)}
          onSetPriceOverride={(price) => perms.requestAction("price_override", () => engine.setPriceOverride(price))}
          onSetLineDiscountPct={(pct) => perms.requestAction("discount", () => engine.setLinePct(pct))}
          onRemoveLine={engine.removeLine}
          onVoidLine={() => perms.requestAction("void_line", engine.voidLine)}
          onHold={engine.holdOrder}
          onRecall={() => setDialog("recall")}
          onRepeatLast={engine.repeatLastItem}
          onVoidOrder={() => perms.requestAction("void_order", () => engine.voidOrder())}
          onLineNote={() => setDialog("note_line")}
          onPromoCode={() => setDialog("promo")}
          onRemoveDiscount={engine.removeDiscount}
          onDeptSale={() => setDialog("dept_sale")}
          onPriceCheck={() => setDialog("price_check")}
        />

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <LayoutGrid
            buttons={layoutButtons}
            products={products}
            columns={activeColumns}
            rows={activeRows}
            priceLevel={engine.order.price_level}
            colorTheme={isLightTheme ? "light" : "standard"}
            onItemButton={engine.addProduct}
            onCategoryButton={setSelectedCategory}
            onActionButton={handleAction}
          />
        </div>
      </div>

      {/* Action bar — with Phase 3 buttons */}
      <ActionBar
        hasLines={hasLines}
        hasSelectedLine={!!selectedLine && !selectedLine.voided}
        theme={posTheme}
        onHold={engine.holdOrder}
        onRecall={() => setDialog("recall")}
        onVoidOrder={() => perms.requestAction("void_order", () => engine.voidOrder())}
        onLineNote={() => setDialog("note_line")}
        onOrderNote={() => setDialog("note_order")}
        onRepeatLast={engine.repeatLastItem}
        onNumpad={(m) => { setNumpadModeState(m); setDialog("numpad"); }}
        onPromoCode={() => setDialog("promo")}
        onFallbackRules={() => setMode("fallback")}
        onBarcodeConfig={() => setMode("barcode_config")}
        onRemoveDiscount={engine.removeDiscount}
        onRefund={() => setDialog("refund")}
        onShift={() => setMode("shift")}
        onSco={() => setMode("sco")}
        onStockTransfer={() => setDialog("stock_transfer")}
        onManual={() => {
          const base = config.server_url.replace(/\/$/, "");
          openShell(`${base}/api/manual`).catch(() => {
            window.open(`${base}/api/manual`, "_blank", "noopener,noreferrer");
          });
        }}
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
        terminalCode={config.terminal_code}
        printerColumns={hw.config?.printer_columns}
        onPrint={
          hw.printerStatus === "online" && hw.config?.printer_enabled
            ? (lines) => hw.printReceipt(lines)
            : undefined
        }
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
          theme={posTheme}
        />
      )}

      {dialog === "price_check" && (
        <PriceCheckDialog
          priceLevel={engine.order.price_level}
          theme={posTheme}
          onSearch={(query) => getProducts(undefined, query)}
          onLookupBarcode={(barcode) => getProductByBarcode(barcode)}
          onGetStockByLocation={(itemId) => getStockByLocation(itemId)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "stock_transfer" && (
        <StockTransferDialog
          theme={posTheme}
          cashierName={session.cashier_name}
          onSearch={(query) => getProducts(undefined, query)}
          onLookupBarcode={(barcode) => getProductByBarcode(barcode)}
          onGetLocations={() => getPosLocations()}
          onSubmit={(toLocationId, cashierName, items) => createStockTransfer(toLocationId, cashierName, items)}
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

      {dialog === "cash_dialog" && (
        <CashDialog
          mode={cashDialogMode}
          onConfirm={(amount, note) => {
            if (cashDialogMode === "cash_in") shift.addCashIn(amount, note);
            else if (cashDialogMode === "cash_out") shift.addCashOut(amount, note);
            else shift.addCashOut(amount, note ? `Petty cash: ${note}` : "Petty cash");
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "dept_sale" && (
        <DeptSaleDialog
          categories={categories}
          onConfirm={(category, amount) => engine.addDepartmentLine(category, amount)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "issue_credit_note" && (
        <IssueCreditNoteDialog
          onIssue={async (amount, reason) => {
            const note = await issueCreditNote(amount, session.cashier_id, session.cashier_name, {
              orderNumber: engine.order.order_number || undefined,
              reason: reason || undefined,
            });
            sync.triggerOutboxFlush();
            return { code: note.code };
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "issue_voucher" && (
        <IssueVoucherDialog
          onIssue={async (amount) => {
            const voucher = await issueGiftVoucher(amount, session.cashier_id, session.cashier_name);
            sync.triggerOutboxFlush();
            return { code: voucher.code };
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
