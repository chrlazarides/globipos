import { useState, useEffect, useCallback, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft, Smartphone, Tablet, Monitor, ShoppingCart,
  Trash2, Plus, Minus, CreditCard, Banknote, Users, Search,
  RotateCcw, AlertTriangle, CheckCircle2, Printer, BarChart2,
  TrendingDown, DoorOpen, X, ChevronLeft, Zap, Tag, Package,
  Layers, Calculator, Loader2, Receipt, Clock,
} from "lucide-react";
import type { PosLayoutSet, PosLayoutButton, Item, Customer } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface SimCartLine {
  id: string;
  itemId?: string;
  label: string;
  qty: number;
  unitPrice: number;
  vatRate: number;
  discountPct: number;
}

type DeviceView = "desktop" | "tablet" | "phone";
type DialogKind =
  | "cash" | "card" | "discount_pct" | "discount_fixed" | "order_discount"
  | "price_override" | "customer" | "qty" | "z_report" | "x_report"
  | "notes" | "cash_in" | "cash_out" | "hold" | "exchange"
  | "category" | null;

interface FeedbackMsg { text: string; ok: boolean; id: number }

const EMPTY_BUTTONS: PosLayoutButton[] = [];
const EMPTY_ITEMS: Item[] = [];
const EMPTY_CUSTOMERS: Customer[] = [];
const EMPTY_CATEGORIES: { id: string; name: string }[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmt(n: number) { return n.toFixed(2); }
function uid() { return Math.random().toString(36).slice(2, 9); }

function lineTotal(l: SimCartLine) {
  return l.unitPrice * l.qty * (1 - l.discountPct / 100);
}

function cartSubtotal(cart: SimCartLine[]) {
  return cart.reduce((s, l) => s + lineTotal(l), 0);
}

function cartVat(cart: SimCartLine[]) {
  return cart.reduce((s, l) => {
    const gross = lineTotal(l);
    return s + gross - gross / (1 + l.vatRate / 100);
  }, 0);
}

/** Resolve columns for current device view */
function deviceCols(ls: PosLayoutSet | undefined, view: DeviceView) {
  if (!ls) return 4;
  const meta = ls as any;
  if (view === "phone")  return meta.colsMobile  ?? 2;
  if (view === "tablet") return meta.colsTablet  ?? 3;
  return ls.columns ?? 4;
}

/** Positions consumed by spanning neighbours */
function consumedSet(buttons: PosLayoutButton[], cols: number): Set<number> {
  const s = new Set<number>();
  if (cols <= 0) return s;
  for (const b of buttons) {
    const cs = (b as any).colspan ?? 1;
    const rs = (b as any).rowspan ?? 1;
    if (cs === 1 && rs === 1) continue;
    const row = Math.floor(b.position / cols);
    const col = b.position % cols;
    for (let dr = 0; dr < rs; dr++) {
      for (let dc = 0; dc < cs; dc++) {
        if (dr === 0 && dc === 0) continue;
        s.add((row + dr) * cols + (col + dc));
      }
    }
  }
  return s;
}

function rcClass(shape?: string | null) {
  return shape === "round" ? "rounded-full" : "rounded-xl";
}

// Icon map for action codes
const ACTION_ICONS: Record<string, any> = {
  PAY_CASH: Banknote, PAY_CARD: CreditCard, PAY_SPLIT: CreditCard,
  PAY_ACCOUNT: Users, PAY_VOUCHER: Receipt, PAY_LAYAWAY: Receipt,
  NEW_SALE: Receipt, HOLD: Receipt, RECALL: Receipt,
  VOID_LINE: Minus, VOID_SALE: RotateCcw, REFUND: RotateCcw,
  EXCHANGE: RotateCcw, SUSPEND_SALE: Receipt,
  QTY: Calculator, DISCOUNT_PCT: TrendingDown, DISCOUNT_FIXED: TrendingDown,
  ORDER_DISCOUNT_PCT: TrendingDown, PRICE_OVERRIDE: Calculator,
  PRICE_CHECK: Search, WEIGHT: Calculator,
  CUSTOMER_LOOKUP: Users, CUSTOMER_CLEAR: Users,
  LOYALTY_POINTS: Users, CUSTOMER_ACCOUNT: Users, CUSTOMER_HISTORY: Users,
  BARCODE_SCAN: Search, ITEM_SEARCH: Search, PLU: Search,
  OPEN_DRAWER: DoorOpen, NO_SALE: DoorOpen,
  CASH_IN: Banknote, CASH_OUT: Banknote, PETTY_CASH: Banknote,
  DECLARE_CASH: Banknote,
  PRINT_RECEIPT: Printer, REPRINT: Printer, EMAIL_RECEIPT: Receipt,
  GIFT_RECEIPT: Receipt,
  CLOCK_IN: Clock, CLOCK_OUT: Clock,
  REPORT_X: BarChart2, REPORT_Z: BarChart2,
  SHIFT_START: Clock, SHIFT_END: Clock,
  JOURNAL_TIP: Receipt, JOURNAL_SERVICE_CHG: Receipt,
  JOURNAL_COVER: Receipt, VAT_SUMMARY: BarChart2,
  NUMPAD: Calculator, NOTES: Receipt,
  MANAGER_OVERRIDE: AlertTriangle, LOCK_TERMINAL: AlertTriangle,
  CHANGE_CASHIER: Users, ADMIN_MENU: Zap,
  SHOW_ALL_ITEMS: Package,
};

// ─────────────────────────────────────────────────────────────────────────────
// POS Button component
// ─────────────────────────────────────────────────────────────────────────────
function SimButton({
  label, color, buttonType, actionCode, colspan, rowspan, shape, icon,
  onClick, dimmed,
}: {
  label: string; color: string; buttonType: string;
  actionCode?: string; colspan?: number; rowspan?: number;
  shape?: string | null; icon?: string | null; onClick: () => void; dimmed?: boolean;
}) {
  const cs = colspan ?? 1;
  const rs = rowspan ?? 1;
  const rc = rcClass(shape);
  const ActionIcon = actionCode ? (ACTION_ICONS[actionCode] ?? Zap) : null;
  const TypeIcon =
    buttonType === "category" ? Tag :
    buttonType === "item"     ? Package :
    buttonType === "sublayout"? Layers  : null;

  return (
    <button
      onClick={onClick}
      style={{
        gridColumn: cs > 1 ? `span ${cs}` : undefined,
        gridRow:    rs > 1 ? `span ${rs}` : undefined,
        backgroundColor: color + "dd",
        opacity: dimmed ? 0.35 : 1,
        minHeight: "56px",
      }}
      className={`
        ${rc} relative flex flex-col items-center justify-center gap-0.5 px-2 py-2
        text-white font-semibold text-xs text-center leading-tight
        shadow-md active:scale-95 transition-all duration-75
        hover:brightness-110 cursor-pointer select-none border border-white/10
      `}
      data-testid={`sim-btn-${label.replace(/\s+/g, "-").toLowerCase()}`}
    >
      {(ActionIcon || TypeIcon) && (
        <span className="opacity-70 mb-0.5">
          {ActionIcon ? <ActionIcon className="w-3.5 h-3.5" /> : TypeIcon ? <TypeIcon className="w-3 h-3" /> : null}
        </span>
      )}
      <span className="leading-tight">{label || "—"}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Numpad dialog (cash / qty / price)
// ─────────────────────────────────────────────────────────────────────────────
function Numpad({ value, onChange, onConfirm, label, prefix = "" }: {
  value: string; onChange: (v: string) => void; onConfirm: () => void; label: string; prefix?: string;
}) {
  const press = (k: string) => {
    if (k === "del") { onChange(value.slice(0, -1) || "0"); return; }
    if (k === "." && value.includes(".")) return;
    if (value === "0" && k !== ".") { onChange(k); return; }
    onChange(value + k);
  };
  const keys = ["7","8","9","4","5","6","1","2","3","0",".",  "del"];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="rounded-lg border bg-muted px-3 py-2 text-right text-2xl font-mono font-bold tracking-wide">
        {prefix}{value}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {keys.map(k => (
          <Button key={k} variant={k === "del" ? "destructive" : "outline"}
            className="h-12 text-lg font-semibold" onClick={() => press(k)}
            data-testid={`numpad-${k}`}>
            {k === "del" ? "⌫" : k}
          </Button>
        ))}
      </div>
      <Button className="w-full h-12 text-base font-bold" onClick={onConfirm} data-testid="numpad-confirm">
        Confirm
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function PosSimulate() {
  const [, params] = useRoute("/pos/simulate/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const rootLayoutId = params?.id ?? "";

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: rootLayout } = useQuery<PosLayoutSet>({
    queryKey: ["/api/pos/layouts", rootLayoutId],
    queryFn: () => apiRequest("GET", `/api/pos/layouts/${rootLayoutId}`).then(r => r.json()),
    enabled: !!rootLayoutId,
  });
  const { data: allLayouts = [] } = useQuery<PosLayoutSet[]>({
    queryKey: ["/api/pos/layouts"],
  });
  const { data: allButtonsMap, isLoading: loadingButtons } = useQuery<Record<string, PosLayoutButton[]>>({
    queryKey: ["/api/pos/layouts/all-buttons", rootLayoutId],
    queryFn: async () => {
      const ids = allLayouts.map(l => l.id);
      if (!ids.length) return {};
      const results = await Promise.all(
        ids.map(id => apiRequest("GET", `/api/pos/layouts/${id}/buttons`).then(r => r.json()))
      );
      return Object.fromEntries(ids.map((id, i) => [id, results[i]]));
    },
    enabled: allLayouts.length > 0,
  });
  const { data: items = EMPTY_ITEMS } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: categories = EMPTY_CATEGORIES } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/categories"],
  });
  const { data: customers = EMPTY_CUSTOMERS } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });

  // ── UI State ───────────────────────────────────────────────────────────────
  const [deviceView, setDeviceView] = useState<DeviceView>("desktop");
  const [layoutStack, setLayoutStack] = useState<string[]>([rootLayoutId]);
  const currentLayoutId = layoutStack[layoutStack.length - 1] ?? rootLayoutId;

  const [cart, setCart] = useState<SimCartLine[]>([]);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [feedbacks, setFeedbacks] = useState<FeedbackMsg[]>([]);
  const [numpadVal, setNumpadVal] = useState("0");
  const [customerSearch, setCustomerSearch] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [cashIn, setCashIn] = useState("0");
  const [saleHistory, setSaleHistory] = useState<{ items: SimCartLine[]; total: number; time: Date }[]>([]);
  const [cardPhase, setCardPhase] = useState<"idle" | "processing" | "approved" | "declined">("idle");
  const [heldCart, setHeldCart] = useState<SimCartLine[] | null>(null);
  const feedbackCounter = useRef(0);

  // Reset layout stack when rootLayoutId changes
  useEffect(() => { setLayoutStack([rootLayoutId]); }, [rootLayoutId]);

  // ── Feedback toast ─────────────────────────────────────────────────────────
  const showFeedback = useCallback((text: string, ok = true) => {
    const id = ++feedbackCounter.current;
    setFeedbacks(p => [...p, { text, ok, id }]);
    setTimeout(() => setFeedbacks(p => p.filter(f => f.id !== id)), 2500);
  }, []);

  // ── Cart operations ────────────────────────────────────────────────────────
  const addItem = useCallback((item: Item) => {
    const price = parseFloat(String(item.price1 || "0"));
    const vat   = parseFloat(String(item.vatRate || "0"));
    setCart(prev => {
      const idx = prev.findIndex(l => l.itemId === item.id && l.discountPct === 0);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { id: uid(), itemId: item.id, label: item.name, qty: 1, unitPrice: price, vatRate: vat, discountPct: 0 }];
    });
    setSelectedLine(null);
  }, []);

  const addGenericItem = useCallback((label: string, price: number, vat = 0) => {
    setCart(prev => [...prev, { id: uid(), label, qty: 1, unitPrice: price, vatRate: vat, discountPct: 0 }]);
  }, []);

  const clearCart = useCallback(() => { setCart([]); setSelectedLine(null); setCustomer(null); setOrderNote(""); }, []);

  const voidLine = useCallback((idx: number) => {
    setCart(prev => prev.filter((_, i) => i !== idx));
    setSelectedLine(null);
  }, []);

  const adjustQty = useCallback((idx: number, delta: number) => {
    setCart(prev => {
      const next = [...prev];
      const newQty = next[idx].qty + delta;
      if (newQty <= 0) return next.filter((_, i) => i !== idx);
      next[idx] = { ...next[idx], qty: newQty };
      return next;
    });
  }, []);

  // ── Button action handler ──────────────────────────────────────────────────
  const handleAction = useCallback((code: string, lineIdx?: number) => {
    switch (code) {
      case "PAY_CASH":
        if (!cart.length) { showFeedback("Cart is empty", false); return; }
        setNumpadVal(fmt(cartSubtotal(cart)));
        setDialog("cash");
        break;
      case "PAY_CARD":
        if (!cart.length) { showFeedback("Cart is empty", false); return; }
        setCardPhase("idle");
        setDialog("card");
        break;
      case "PAY_SPLIT":
        if (!cart.length) { showFeedback("Cart is empty", false); return; }
        showFeedback("Split payment — tap Cash then Card portions", true);
        break;
      case "PAY_ACCOUNT":
        if (!cart.length) { showFeedback("Cart is empty", false); return; }
        if (!customer) { showFeedback("Attach a customer first (Customer Lookup)", false); return; }
        { const total = cartSubtotal(cart);
          setSaleHistory(p => [...p, { items: [...cart], total, time: new Date() }]);
          clearCart(); showFeedback(`€${fmt(total)} charged to ${customer.name}'s account`, true); }
        break;
      case "NEW_SALE":
        if (cart.length && !confirm("Clear the current sale?")) return;
        clearCart(); showFeedback("New sale started", true);
        break;
      case "VOID_SALE":
        if (!cart.length) { showFeedback("Nothing to void", false); return; }
        if (!confirm(`Void entire sale (€${fmt(cartSubtotal(cart))})?`)) return;
        clearCart(); showFeedback("Sale voided", true);
        break;
      case "VOID_LINE": {
        const idx = selectedLine ?? (cart.length ? cart.length - 1 : null);
        if (idx === null || !cart[idx]) { showFeedback("No line selected", false); return; }
        showFeedback(`Voided: ${cart[idx].label}`, true);
        voidLine(idx); break;
      }
      case "HOLD":
        if (!cart.length) { showFeedback("Nothing to hold", false); return; }
        setHeldCart([...cart]); clearCart(); showFeedback("Sale held — tap Recall to retrieve", true);
        break;
      case "RECALL":
        if (!heldCart) { showFeedback("No held sale", false); return; }
        setCart(heldCart); setHeldCart(null); showFeedback("Held sale recalled", true);
        break;
      case "DISCOUNT_PCT":
        if (!cart.length) { showFeedback("Add items first", false); return; }
        if (lineIdx !== undefined) setSelectedLine(lineIdx);
        setNumpadVal("0"); setDialog("discount_pct"); break;
      case "DISCOUNT_FIXED":
        if (!cart.length) { showFeedback("Add items first", false); return; }
        setNumpadVal("0"); setDialog("discount_fixed"); break;
      case "ORDER_DISCOUNT_PCT":
        if (!cart.length) { showFeedback("Add items first", false); return; }
        setNumpadVal("0"); setDialog("order_discount"); break;
      case "PRICE_OVERRIDE": {
        const idx2 = lineIdx ?? selectedLine ?? (cart.length ? cart.length - 1 : null);
        if (idx2 === null || !cart[idx2]) { showFeedback("No line selected", false); return; }
        if (lineIdx !== undefined) setSelectedLine(lineIdx);
        setNumpadVal(fmt(cart[idx2].unitPrice)); setDialog("price_override"); break;
      }
      case "PRICE_CHECK":
        showFeedback("Scan or enter barcode to check price", true); break;
      case "QTY": {
        const idx3 = lineIdx ?? selectedLine ?? (cart.length ? cart.length - 1 : null);
        if (idx3 === null || !cart[idx3]) { showFeedback("No line selected", false); return; }
        if (lineIdx !== undefined) setSelectedLine(lineIdx);
        setNumpadVal(fmt(cart[idx3].qty)); setDialog("qty"); break;
      }
      case "CUSTOMER_LOOKUP":
        setCustomerSearch(""); setDialog("customer"); break;
      case "CUSTOMER_CLEAR":
        setCustomer(null); showFeedback("Customer removed", true); break;
      case "LOYALTY_POINTS":
        if (!customer) { showFeedback("Attach a customer first", false); return; }
        showFeedback(`${customer.name} — loyalty points applied (simulation)`, true); break;
      case "CUSTOMER_ACCOUNT":
        if (!customer) { showFeedback("No customer attached", false); return; }
        showFeedback(`${customer.name} — balance check (simulation)`, true); break;
      case "OPEN_DRAWER": case "NO_SALE":
        showFeedback("💰 Cash drawer opened", true); break;
      case "CASH_IN":
        setNumpadVal("0"); setDialog("cash_in"); break;
      case "CASH_OUT":
        setNumpadVal("0"); setDialog("cash_out"); break;
      case "PRINT_RECEIPT": case "REPRINT":
        showFeedback("🖨 Receipt printed (simulation)", true); break;
      case "EMAIL_RECEIPT":
        showFeedback("📧 Receipt emailed to customer (simulation)", true); break;
      case "GIFT_RECEIPT":
        showFeedback("🎁 Gift receipt printed (simulation)", true); break;
      case "REPORT_X": setDialog("x_report"); break;
      case "REPORT_Z": setDialog("z_report"); break;
      case "CLOCK_IN":  showFeedback("🕐 Clocked IN (simulation)", true); break;
      case "CLOCK_OUT": showFeedback("🕐 Clocked OUT (simulation)", true); break;
      case "SHIFT_START": showFeedback("Shift started (simulation)", true); break;
      case "SHIFT_END":   showFeedback("Shift ended (simulation)", true); break;
      case "MANAGER_OVERRIDE": showFeedback("👤 Manager override granted (simulation)", true); break;
      case "LOCK_TERMINAL": showFeedback("🔒 Terminal locked (simulation)", true); break;
      case "CHANGE_CASHIER": showFeedback("Cashier change (simulation)", true); break;
      case "ITEM_SEARCH": case "BARCODE_SCAN": case "PLU":
        showFeedback("🔍 Item search active (simulation)", true); break;
      case "REFUND":
        showFeedback("Refund — select items from a prior sale (simulation)", true); break;
      case "NOTES": setDialog("notes"); break;
      case "SHOW_ALL_ITEMS": setCategoryFilter(null); showFeedback("Showing all items", true); break;
      case "JOURNAL_TIP":
        addGenericItem("Tip / Gratuity", 0, 0);
        showFeedback("Tip line added — enter amount via Price Override", true); break;
      case "JOURNAL_SERVICE_CHG":
        addGenericItem("Service Charge", cartSubtotal(cart) * 0.1, 0);
        showFeedback("10% service charge added", true); break;
      case "JOURNAL_COVER":
        addGenericItem("Cover Charge", 2.00, 0);
        showFeedback("Cover charge added", true); break;
      case "VAT_SUMMARY":
        showFeedback(`VAT collected this shift: €${fmt(cartVat(cart))} (simulation)`, true); break;
      case "WEIGHT":
        showFeedback("Enter weight in kg (simulation)", true); break;
      case "NUMPAD":
        setNumpadVal("1"); setDialog("qty"); break;
      case "EXCHANGE":
        setDialog("exchange"); break;
      case "PAY_VOUCHER":
        showFeedback("Enter voucher code (simulation)", true); break;
      default:
        showFeedback(`${code} — executed (simulation)`, true);
    }
  }, [cart, selectedLine, customer, heldCart, showFeedback, clearCart, voidLine, addGenericItem]);

  // ── Button click dispatcher ────────────────────────────────────────────────
  const handleButtonClick = useCallback((btn: PosLayoutButton) => {
    const type = btn.buttonType as string;
    if (type === "item") {
      const item = items.find(it => it.id === btn.itemId);
      if (item) addItem(item);
      else showFeedback(`Item not found (${btn.itemId})`, false);
    } else if (type === "category") {
      setCategoryFilter(btn.categoryId ?? null);
      setDialog("category");
    } else if (type === "action" && btn.actionCode) {
      handleAction(btn.actionCode);
    } else if (type === "sublayout") {
      const sub = (btn as any).sublayoutId;
      if (sub) setLayoutStack(p => [...p, sub]);
      else showFeedback("Sub-layout not configured", false);
    }
  }, [items, addItem, handleAction, showFeedback]);

  // ── Current layout buttons ─────────────────────────────────────────────────
  const currentLayout = allLayouts.find(l => l.id === currentLayoutId) ?? rootLayout;
  const rawButtons: PosLayoutButton[] = (allButtonsMap?.[currentLayoutId] ?? EMPTY_BUTTONS)
    .filter(b => b.buttonType !== "empty" && b.label);
  const cols = deviceCols(currentLayout, deviceView);
  const declaredRows = currentLayout?.rows ?? 5;
  const maxButtonPos = rawButtons.length ? Math.max(...rawButtons.map(b => b.position)) : -1;
  const neededRows = Math.ceil((maxButtonPos + 1) / cols);
  const rows = Math.max(declaredRows, neededRows);
  const totalCells = cols * rows;
  const consumed = consumedSet(rawButtons, cols);

  // Build grid array
  const grid = Array.from({ length: totalCells }, (_, i) => {
    const b = rawButtons.find(b => b.position === i);
    return b ?? null;
  });

  // ── Dialog confirm handlers ────────────────────────────────────────────────
  const confirmCash = () => {
    const tendered = parseFloat(numpadVal || "0");
    const total = cartSubtotal(cart);
    const change = tendered - total;
    if (tendered < total) { showFeedback(`Not enough — short by €${fmt(total - tendered)}`, false); return; }
    setSaleHistory(p => [...p, { items: [...cart], total, time: new Date() }]);
    clearCart();
    showFeedback(`✅ Cash sale €${fmt(total)} — Change: €${fmt(change)}`, true);
    setDialog(null);
  };

  const confirmCard = () => {
    setCardPhase("processing");
    setTimeout(() => {
      // 90% success, 10% decline in simulation
      if (Math.random() > 0.1) {
        const total = cartSubtotal(cart);
        setSaleHistory(p => [...p, { items: [...cart], total, time: new Date() }]);
        clearCart();
        setCardPhase("approved");
        showFeedback(`✅ Card approved — €${fmt(total)}`, true);
      } else {
        setCardPhase("declined");
      }
    }, 2000);
  };

  const confirmDiscount = () => {
    const pct = parseFloat(numpadVal || "0");
    if (pct <= 0 || pct > 100) { showFeedback("Enter 1–100%", false); return; }
    const idx = selectedLine ?? (cart.length ? cart.length - 1 : null);
    if (idx === null) { showFeedback("No line selected", false); return; }
    setCart(prev => prev.map((l, i) => i === idx ? { ...l, discountPct: pct } : l));
    showFeedback(`${pct}% discount applied to ${cart[idx]?.label}`, true);
    setDialog(null);
  };

  const confirmDiscountFixed = () => {
    const amt = parseFloat(numpadVal || "0");
    const idx = selectedLine ?? (cart.length ? cart.length - 1 : null);
    if (idx === null) { showFeedback("No line selected", false); return; }
    const line = cart[idx];
    if (amt <= 0 || amt > line.unitPrice * line.qty) { showFeedback("Invalid amount", false); return; }
    const pct = (amt / (line.unitPrice * line.qty)) * 100;
    setCart(prev => prev.map((l, i) => i === idx ? { ...l, discountPct: pct } : l));
    showFeedback(`€${fmt(amt)} discount on ${line.label}`, true);
    setDialog(null);
  };

  const confirmOrderDiscount = () => {
    const pct = parseFloat(numpadVal || "0");
    if (pct <= 0 || pct > 100) { showFeedback("Enter 1–100%", false); return; }
    setCart(prev => prev.map(l => ({ ...l, discountPct: pct })));
    showFeedback(`${pct}% discount on entire order`, true);
    setDialog(null);
  };

  const confirmPriceOverride = () => {
    const price = parseFloat(numpadVal || "0");
    const idx = selectedLine ?? (cart.length ? cart.length - 1 : null);
    if (idx === null) return;
    setCart(prev => prev.map((l, i) => i === idx ? { ...l, unitPrice: price } : l));
    showFeedback(`Price set to €${fmt(price)}`, true);
    setDialog(null);
  };

  const confirmQty = () => {
    const qty = parseInt(numpadVal || "1", 10);
    if (qty <= 0) { setDialog(null); return; }
    const idx = selectedLine ?? (cart.length ? cart.length - 1 : null);
    if (idx === null) { setDialog(null); return; }
    setCart(prev => prev.map((l, i) => i === idx ? { ...l, qty } : l));
    setDialog(null);
  };

  const total   = cartSubtotal(cart);
  const vatAmt  = cartVat(cart);

  // Category items
  const categoryItems = dialog === "category"
    ? items.filter(it => (it as any).categoryId === categoryFilter)
    : [];

  // ── Device frame sizing ────────────────────────────────────────────────────
  const gridPanelClass =
    deviceView === "phone"  ? "max-w-[360px] mx-auto" :
    deviceView === "tablet" ? "max-w-[640px] mx-auto" :
    "";

  // ── Breadcrumb ────────────────────────────────────────────────────────────
  const breadcrumb = layoutStack.map(id => allLayouts.find(l => l.id === id)?.name ?? id);

  return (
    <div className="flex flex-col h-full" data-testid="pos-simulator">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b bg-background flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate("/pos/layouts")} data-testid="btn-back-simulate">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{rootLayout?.name ?? "POS Simulator"}</span>
            <Badge variant="destructive" className="text-xs shrink-0 animate-pulse">⚠ SIMULATION MODE</Badge>
            {heldCart && <Badge variant="outline" className="text-xs text-amber-600 border-amber-400 shrink-0">Sale on hold</Badge>}
          </div>
          {breadcrumb.length > 1 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              {breadcrumb.map((name, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronLeft className="w-3 h-3 rotate-180" />}
                  <button onClick={() => setLayoutStack(s => s.slice(0, i + 1))}
                    className="hover:underline">{name}</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Device selector */}
        <div className="flex items-center gap-1 shrink-0">
          {([["desktop", Monitor], ["tablet", Tablet], ["phone", Smartphone]] as [DeviceView, any][]).map(([v, Icon]) => (
            <Button key={v} variant={deviceView === v ? "default" : "ghost"} size="icon"
              className="h-8 w-8" onClick={() => setDeviceView(v)} data-testid={`btn-device-${v}`}>
              <Icon className="w-4 h-4" />
            </Button>
          ))}
        </div>

        {/* Sim controls */}
        <Button variant="outline" size="sm" onClick={clearCart} className="shrink-0 text-xs h-8"
          data-testid="btn-sim-clear">
          <RotateCcw className="w-3 h-3 mr-1" /> Reset
        </Button>
      </div>

      {/* ── Feedback toasts ───────────────────────────────────────────────── */}
      <div className="fixed top-16 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {feedbacks.map(f => (
          <div key={f.id} className={`px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-white animate-in slide-in-from-right-4 ${f.ok ? "bg-green-600" : "bg-red-600"}`}>
            {f.text}
          </div>
        ))}
      </div>

      {/* ── Main area ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">

        {/* ── Left panel: Cart / Receipt ─────────────────────────────────── */}
        <div className="w-full md:w-[480px] h-64 md:h-auto min-h-0 flex-shrink-0 flex flex-col border-b md:border-b-0 md:border-r bg-slate-950 text-white">

          {/* Customer */}
          <div
            className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 cursor-pointer hover:bg-slate-900 transition-colors"
            onClick={() => { setCustomerSearch(""); setDialog("customer"); }}
            data-testid="cart-customer-area"
          >
            <Users className="w-4 h-4 text-slate-400 shrink-0" />
            {customer ? (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate">{customer.name}</p>
                <p className="text-[10px] text-slate-400 truncate">{(customer as any).email ?? "No email"}</p>
              </div>
            ) : (
              <span className="text-xs text-slate-500">Tap to add customer…</span>
            )}
            {customer && (
              <button onClick={e => { e.stopPropagation(); setCustomer(null); }}
                className="text-slate-500 hover:text-red-400 transition-colors">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Order note */}
          {orderNote && (
            <div className="px-3 py-1.5 bg-amber-900/30 border-b border-amber-700/30 text-[11px] text-amber-300 flex items-center gap-1">
              <Receipt className="w-3 h-3 shrink-0" />
              <span className="truncate">{orderNote}</span>
            </div>
          )}

          {/* Cart lines */}
          <ScrollArea className="flex-1">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-600">
                <ShoppingCart className="w-8 h-8 mb-2" />
                <p className="text-xs">Cart empty</p>
              </div>
            ) : (
              <div className="py-1">
                {cart.map((line, idx) => (
                  <div
                    key={line.id}
                    onClick={() => setSelectedLine(selectedLine === idx ? null : idx)}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors border-b border-slate-800/50 ${selectedLine === idx ? "bg-primary/20 border-l-2 border-l-primary" : "hover:bg-slate-900"}`}
                    data-testid={`cart-line-${idx}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate leading-tight">{line.label}</p>
                      <p className="text-[10px] text-slate-400 flex items-center gap-1 flex-wrap">
                        <span
                          className="px-1 rounded bg-slate-800 text-slate-300 text-[9px] font-semibold shrink-0"
                          title="VAT rate applied to this line"
                          data-testid={`text-vat-rate-${idx}`}
                        >
                          VAT {fmt(line.vatRate)}%
                        </span>
                        <button
                          className="underline decoration-dotted hover:text-white"
                          title="Tap to correct price"
                          onClick={e => { e.stopPropagation(); handleAction("PRICE_OVERRIDE", idx); }}
                          data-testid={`btn-correct-price-${idx}`}
                        >
                          €{fmt(line.unitPrice)}
                        </button>
                        <button
                          className={`underline decoration-dotted ${line.discountPct > 0 ? "text-green-400 hover:text-green-300" : "text-slate-500 hover:text-white"}`}
                          title="Tap to correct discount"
                          onClick={e => { e.stopPropagation(); handleAction("DISCOUNT_PCT", idx); }}
                          data-testid={`btn-correct-discount-${idx}`}
                        >
                          {line.discountPct > 0 ? `−${fmt(line.discountPct)}%` : "+ disc"}
                        </button>
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button className="text-slate-500 hover:text-white h-5 w-5 flex items-center justify-center"
                        onClick={e => { e.stopPropagation(); adjustQty(idx, -1); }}>
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-5 text-center text-xs font-bold">{line.qty}</span>
                      <button className="text-slate-500 hover:text-white h-5 w-5 flex items-center justify-center"
                        onClick={e => { e.stopPropagation(); adjustQty(idx, 1); }}>
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="w-14 text-right text-xs font-bold shrink-0">
                      €{fmt(lineTotal(line))}
                    </p>
                    <button className="text-slate-600 hover:text-red-400 transition-colors"
                      onClick={e => { e.stopPropagation(); voidLine(idx); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Totals */}
          <div className="border-t border-slate-800 px-3 py-2 space-y-1 flex-shrink-0">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Subtotal (excl. VAT)</span>
              <span>€{fmt(total - vatAmt)}</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>VAT</span>
              <span>€{fmt(vatAmt)}</span>
            </div>
            <div className="flex justify-between text-base font-bold">
              <span>TOTAL</span>
              <span className="text-green-400">€{fmt(total)}</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 mt-2">
              <Button size="sm" className="h-9 text-xs bg-green-700 hover:bg-green-600 text-white"
                onClick={() => handleAction("PAY_CASH")} data-testid="btn-pay-cash-shortcut">
                <Banknote className="w-3 h-3 mr-1" />Cash
              </Button>
              <Button size="sm" className="h-9 text-xs bg-blue-700 hover:bg-blue-600 text-white"
                onClick={() => handleAction("PAY_CARD")} data-testid="btn-pay-card-shortcut">
                <CreditCard className="w-3 h-3 mr-1" />Card
              </Button>
              <Button size="sm" variant="outline" className="h-9 text-xs border-slate-700 text-slate-300 hover:text-white"
                onClick={() => handleAction("VOID_SALE")} data-testid="btn-void-shortcut">
                <RotateCcw className="w-3 h-3 mr-1" />Void
              </Button>
            </div>
          </div>

          {/* Sale history counter */}
          <div className="px-3 py-1.5 border-t border-slate-800 bg-slate-900 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Sales this session: {saleHistory.length}</span>
            {saleHistory.length > 0 && (
              <span className="text-[10px] text-slate-500">
                Total: €{fmt(saleHistory.reduce((s, h) => s + h.total, 0))}
              </span>
            )}
          </div>
        </div>

        {/* ── Right panel: Button grid ───────────────────────────────────── */}
        <div className="flex-1 flex flex-col bg-slate-800 overflow-hidden min-h-0">
          {loadingButtons ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className={`flex-1 p-3 overflow-auto ${gridPanelClass}`}>
              {/* Back from sublayout */}
              {layoutStack.length > 1 && (
                <Button variant="outline" size="sm" className="mb-2 text-xs border-slate-600 text-slate-300 hover:text-white"
                  onClick={() => setLayoutStack(p => p.slice(0, -1))} data-testid="btn-sublayout-back">
                  <ChevronLeft className="w-3.5 h-3.5 mr-1" />Back
                </Button>
              )}
              <div
                style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "6px", alignContent: "start" }}
              >
                {grid.map((btn, idx) => {
                  if (!btn) {
                    return <div key={idx} style={{ minHeight: "56px" }} className="rounded-xl bg-slate-700/30" />;
                  }
                  if (consumed.has(btn.position) && grid.indexOf(btn) !== idx) return null;
                  if (consumed.has(idx) && !rawButtons.find(b => b.position === idx)) {
                    return <div key={idx} />;
                  }
                  return (
                    <SimButton
                      key={btn.id ?? idx}
                      label={btn.label ?? ""}
                      color={(btn as any).color ?? "#374151"}
                      buttonType={btn.buttonType ?? "empty"}
                      actionCode={btn.actionCode ?? undefined}
                      colspan={(btn as any).colspan ?? 1}
                      rowspan={(btn as any).rowspan ?? 1}
                      shape={(btn as any).shape}
                      icon={btn.icon}
                      onClick={() => handleButtonClick(btn)}
                    />
                  );
                })}
              </div>

              {rawButtons.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-slate-500 gap-2">
                  <LayoutGrid className="w-8 h-8" />
                  <p className="text-sm">No buttons configured for this layout.</p>
                  <Button variant="outline" size="sm" className="text-xs border-slate-600 text-slate-400 hover:text-white"
                    onClick={() => navigate(`/pos/layouts/${currentLayoutId}/edit`)}>
                    Open Layout Editor
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          DIALOGS
      ════════════════════════════════════════════════════════════════════ */}

      {/* Cash payment */}
      <Dialog open={dialog === "cash"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Banknote className="w-5 h-5" />Cash Payment</DialogTitle></DialogHeader>
          <div className="text-center mb-2">
            <p className="text-sm text-muted-foreground">Total due</p>
            <p className="text-3xl font-bold">€{fmt(total)}</p>
          </div>
          <Numpad value={numpadVal} onChange={setNumpadVal} onConfirm={confirmCash} label="Enter amount tendered" prefix="€" />
          {parseFloat(numpadVal) >= total && parseFloat(numpadVal) > 0 && (
            <div className="text-center rounded-lg bg-green-50 dark:bg-green-900/20 py-2 text-green-700 dark:text-green-400 font-bold text-lg">
              Change: €{fmt(parseFloat(numpadVal) - total)}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Card payment */}
      <Dialog open={dialog === "card"} onOpenChange={o => { if (!o && cardPhase !== "processing") { setDialog(null); setCardPhase("idle"); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5" />Card Payment</DialogTitle></DialogHeader>
          <div className="text-center py-4 space-y-4">
            <p className="text-3xl font-bold">€{fmt(total)}</p>
            {cardPhase === "idle" && (
              <>
                <div className="rounded-full bg-blue-100 dark:bg-blue-900/30 p-8 inline-flex">
                  <CreditCard className="w-12 h-12 text-blue-600" />
                </div>
                <p className="text-sm text-muted-foreground">Tap CHARGE to simulate card processing</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setDialog(null)}>Cancel</Button>
                  <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={confirmCard} data-testid="btn-card-charge">
                    Charge
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">90% approval / 10% decline rate in simulation</p>
              </>
            )}
            {cardPhase === "processing" && (
              <>
                <div className="rounded-full bg-blue-100 dark:bg-blue-900/30 p-8 inline-flex">
                  <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                </div>
                <p className="font-semibold">Processing…</p>
                <p className="text-xs text-muted-foreground">Please wait — do not remove card</p>
              </>
            )}
            {cardPhase === "approved" && (
              <>
                <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-8 inline-flex">
                  <CheckCircle2 className="w-12 h-12 text-green-600" />
                </div>
                <p className="font-bold text-green-600 text-xl">APPROVED</p>
                <p className="text-xs text-muted-foreground">SIM-REF-{Math.random().toString(36).slice(2, 10).toUpperCase()}</p>
                <Button className="w-full" onClick={() => { setDialog(null); setCardPhase("idle"); }}>Done</Button>
              </>
            )}
            {cardPhase === "declined" && (
              <>
                <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-8 inline-flex">
                  <AlertTriangle className="w-12 h-12 text-red-600" />
                </div>
                <p className="font-bold text-red-600 text-xl">DECLINED</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => { setDialog(null); setCardPhase("idle"); }}>Cancel</Button>
                  <Button className="flex-1" onClick={() => { setCardPhase("idle"); }} data-testid="btn-card-retry">Retry</Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Discount % on line */}
      <Dialog open={dialog === "discount_pct"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><TrendingDown className="w-5 h-5" />Line Discount %</DialogTitle></DialogHeader>
          {cart[selectedLine ?? cart.length - 1] && (
            <p className="text-xs text-muted-foreground">Applying to: <strong>{cart[selectedLine ?? cart.length - 1]?.label}</strong></p>
          )}
          <Numpad value={numpadVal} onChange={setNumpadVal} onConfirm={confirmDiscount} label="Enter discount percentage" prefix="" />
        </DialogContent>
      </Dialog>

      {/* Discount fixed */}
      <Dialog open={dialog === "discount_fixed"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><TrendingDown className="w-5 h-5" />Fixed Discount</DialogTitle></DialogHeader>
          <Numpad value={numpadVal} onChange={setNumpadVal} onConfirm={confirmDiscountFixed} label="Enter discount amount" prefix="€" />
        </DialogContent>
      </Dialog>

      {/* Order discount % */}
      <Dialog open={dialog === "order_discount"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><TrendingDown className="w-5 h-5" />Order Discount %</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Applies to all {cart.length} lines in the order</p>
          <Numpad value={numpadVal} onChange={setNumpadVal} onConfirm={confirmOrderDiscount} label="Enter order discount %" prefix="" />
        </DialogContent>
      </Dialog>

      {/* Price override */}
      <Dialog open={dialog === "price_override"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Calculator className="w-5 h-5" />Price Override</DialogTitle></DialogHeader>
          <Numpad value={numpadVal} onChange={setNumpadVal} onConfirm={confirmPriceOverride} label="Enter new unit price" prefix="€" />
        </DialogContent>
      </Dialog>

      {/* Qty entry */}
      <Dialog open={dialog === "qty"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Calculator className="w-5 h-5" />Enter Quantity</DialogTitle></DialogHeader>
          <Numpad value={numpadVal} onChange={setNumpadVal} onConfirm={confirmQty} label="Enter quantity" />
        </DialogContent>
      </Dialog>

      {/* Cash In / Out */}
      <Dialog open={dialog === "cash_in" || dialog === "cash_out"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5" />{dialog === "cash_in" ? "Cash In" : "Cash Out"}
            </DialogTitle>
          </DialogHeader>
          <Numpad
            value={numpadVal} onChange={setNumpadVal}
            label={`Enter ${dialog === "cash_in" ? "cash in" : "cash out"} amount`}
            prefix="€"
            onConfirm={() => {
              const amt = parseFloat(numpadVal || "0");
              showFeedback(`${dialog === "cash_in" ? "Cash In" : "Cash Out"}: €${fmt(amt)} recorded (simulation)`, true);
              setDialog(null);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Notes */}
      <Dialog open={dialog === "notes"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Order Note</DialogTitle></DialogHeader>
          <Input value={orderNote} onChange={e => setOrderNote(e.target.value)} placeholder="Add a note to this order…" data-testid="input-order-note" />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDialog(null)}>Cancel</Button>
            <Button className="flex-1" onClick={() => { showFeedback("Note saved", true); setDialog(null); }}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Customer lookup */}
      <Dialog open={dialog === "customer"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="w-5 h-5" />Customer Lookup</DialogTitle></DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name or email…"
              value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
              autoFocus
              data-testid="input-customer-search"
            />
          </div>
          <ScrollArea className="h-64">
            {customers
              .filter(c => {
                const q = customerSearch.toLowerCase();
                return !q || c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
              })
              .slice(0, 30)
              .map(c => (
                <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-muted rounded-lg transition-colors border-b last:border-0"
                  onClick={() => { setCustomer(c); setDialog(null); showFeedback(`Customer: ${c.name}`, true); }}
                  data-testid={`customer-option-${c.id}`}>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.email ?? "No email"}</p>
                </button>
              ))}
            {customers.filter(c => {
              const q = customerSearch.toLowerCase();
              return !q || c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
            }).length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">No customers found</p>
            )}
          </ScrollArea>
          {customer && (
            <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => { setCustomer(null); setDialog(null); showFeedback("Customer removed", true); }}>
              Clear customer
            </Button>
          )}
        </DialogContent>
      </Dialog>

      {/* Category items overlay */}
      <Dialog open={dialog === "category"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5" />
              {categories.find(c => c.id === categoryFilter)?.name ?? "Category Items"}
            </DialogTitle>
          </DialogHeader>
          {categoryItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No items in this category</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto">
              {categoryItems.map(item => (
                <button key={item.id}
                  onClick={() => { addItem(item); setDialog(null); showFeedback(`Added: ${item.name}`, true); }}
                  className="rounded-xl border bg-primary/5 hover:bg-primary/15 p-2 text-left transition-colors"
                  data-testid={`cat-item-${item.id}`}>
                  <p className="text-xs font-semibold truncate">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">€{fmt(parseFloat(String(item.price1 || "0")))}</p>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* X Report */}
      <Dialog open={dialog === "x_report"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><BarChart2 className="w-5 h-5" />X Report (Interim)</DialogTitle></DialogHeader>
          <div className="font-mono text-xs space-y-1 bg-muted rounded-lg p-3">
            <p className="font-bold text-center text-sm border-b pb-1 mb-2">INTERIM REPORT — SIMULATION</p>
            <p className="flex justify-between"><span>Sales:</span><span>{saleHistory.length}</span></p>
            <p className="flex justify-between"><span>Gross:</span><span>€{fmt(saleHistory.reduce((s,h)=>s+h.total,0))}</span></p>
            <p className="flex justify-between"><span>Current sale:</span><span>€{fmt(total)}</span></p>
            <p className="flex justify-between"><span>Cart lines:</span><span>{cart.length}</span></p>
            <p className="text-center text-muted-foreground mt-2 border-t pt-1 text-[10px]">
              {new Date().toLocaleString()}
            </p>
          </div>
          <Button onClick={() => setDialog(null)}>Close</Button>
        </DialogContent>
      </Dialog>

      {/* Z Report */}
      <Dialog open={dialog === "z_report"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><BarChart2 className="w-5 h-5" />Z Report (End of Day)</DialogTitle></DialogHeader>
          <div className="font-mono text-xs space-y-1 bg-muted rounded-lg p-3">
            <p className="font-bold text-center text-sm border-b pb-1 mb-2">END OF DAY — SIMULATION</p>
            <p className="flex justify-between"><span>Sales count:</span><span>{saleHistory.length}</span></p>
            <p className="flex justify-between"><span>Gross sales:</span><span>€{fmt(saleHistory.reduce((s,h)=>s+h.total,0))}</span></p>
            <p className="flex justify-between"><span>Avg. basket:</span>
              <span>€{saleHistory.length ? fmt(saleHistory.reduce((s,h)=>s+h.total,0)/saleHistory.length) : "0.00"}</span>
            </p>
            <p className="flex justify-between font-bold border-t mt-1 pt-1">
              <span>NET TOTAL:</span><span>€{fmt(saleHistory.reduce((s,h)=>s+h.total,0))}</span>
            </p>
            <p className="text-center text-muted-foreground mt-2 text-[10px]">
              Simulation — no counters reset
            </p>
            <p className="text-center text-muted-foreground text-[10px]">{new Date().toLocaleString()}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDialog(null)}>Close</Button>
            <Button className="flex-1" onClick={() => {
              setSaleHistory([]); showFeedback("Z Report — counters reset (simulation)", true); setDialog(null);
            }} data-testid="btn-z-report-reset">Reset Counters</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Needed for the breadcrumb LayoutGrid icon
function LayoutGrid({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  );
}
