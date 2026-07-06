import { useState } from "react";
import type { CSSProperties, ComponentType, SVGProps } from "react";
import { ChevronLeftIcon, LayersIcon } from "lucide-react";
import {
  CashIcon, CardIcon, VoidIcon, HoldIcon, RecallIcon, DiscountIcon, SubtotalIcon,
  VoucherIcon, RefundIcon, PayIcon,
} from "./icons/PosIcons";
import type { LayoutButton, Product } from "../types";
import { formatCurrency } from "../lib/pricing";
import type { PosColorTheme } from "../hooks/useWindowSize";

interface LayoutGridProps {
  buttons: LayoutButton[];
  products: Product[];
  columns: number;
  rows: number;
  priceLevel: number;
  colorTheme?: PosColorTheme;
  onItemButton: (product: Product) => void;
  onCategoryButton: (categoryId: string) => void;
  onActionButton: (actionCode: string) => void;
}

const ACTION_COLORS: Record<string, string> = {
  PAY_CASH:            "bg-green-700 hover:bg-green-600 text-white",
  PAY_CARD:            "bg-blue-700 hover:bg-blue-600 text-white",
  VOID_ORDER:          "bg-red-800 hover:bg-red-700 text-white",
  CLEAR_ORDER:         "bg-red-800 hover:bg-red-700 text-white",
  HOLD_ORDER:          "bg-amber-700 hover:bg-amber-600 text-white",
  RECALL_ORDER:        "bg-amber-700 hover:bg-amber-600 text-white",
  PRICE_OVERRIDE:      "bg-purple-800 hover:bg-purple-700 text-white",
  LINE_DISCOUNT_PCT:   "bg-purple-800 hover:bg-purple-700 text-white",
  ORDER_DISCOUNT_PCT:  "bg-purple-800 hover:bg-purple-700 text-white",
  PROMO_CODE:          "bg-purple-800 hover:bg-purple-700 text-white",
  NUMPAD:              "bg-slate-700 hover:bg-slate-600 text-white",
  OPEN_DRAWER:         "bg-teal-700 hover:bg-teal-600 text-white",
  NO_SALE:             "bg-teal-700 hover:bg-teal-600 text-white",
  CASH_IN:             "bg-emerald-700 hover:bg-emerald-600 text-white",
  CASH_OUT:            "bg-orange-700 hover:bg-orange-600 text-white",
  PETTY_CASH:          "bg-orange-700 hover:bg-orange-600 text-white",
  DECLARE_CASH:        "bg-teal-700 hover:bg-teal-600 text-white",
  SURCHARGE_PCT:       "bg-purple-800 hover:bg-purple-700 text-white",
  DEPT_SALE:           "bg-indigo-700 hover:bg-indigo-600 text-white",
  ISSUE_CREDIT_NOTE:   "bg-pink-800 hover:bg-pink-700 text-white",
  REDEEM_CREDIT_NOTE:  "bg-pink-800 hover:bg-pink-700 text-white",
  LINE_SURCHARGE_PCT:  "bg-purple-800 hover:bg-purple-700 text-white",
  CORRECTION:          "bg-red-800 hover:bg-red-700 text-white",
  REPRINT_LAST:        "bg-slate-700 hover:bg-slate-600 text-white",
  ISSUE_VOUCHER:       "bg-pink-800 hover:bg-pink-700 text-white",
  TOGGLE_LANGUAGE:     "bg-slate-700 hover:bg-slate-600 text-white",
};

const ACTION_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  PAY_CASH:            CashIcon,
  PAY_CARD:            CardIcon,
  VOID_ORDER:          VoidIcon,
  CLEAR_ORDER:         VoidIcon,
  HOLD_ORDER:          HoldIcon,
  RECALL_ORDER:        RecallIcon,
  PRICE_OVERRIDE:      DiscountIcon,
  LINE_DISCOUNT_PCT:   DiscountIcon,
  LINE_DISCOUNT_FIXED: DiscountIcon,
  ORDER_DISCOUNT_PCT:  DiscountIcon,
  ORDER_DISCOUNT_FIXED:DiscountIcon,
  REMOVE_DISCOUNT:     DiscountIcon,
  PROMO_CODE:          DiscountIcon,
  MANUAL_PROMO:        DiscountIcon,
  PRICE_CHECK:         SubtotalIcon,
  CASH_IN:             CashIcon,
  CASH_OUT:            CashIcon,
  PETTY_CASH:          CashIcon,
  OPEN_DRAWER:         CashIcon,
  DECLARE_CASH:        CashIcon,
  DEPT_SALE:           PayIcon,
  ISSUE_CREDIT_NOTE:   VoucherIcon,
  REDEEM_CREDIT_NOTE:  RefundIcon,
  LINE_SURCHARGE_PCT:  DiscountIcon,
  CORRECTION:          VoidIcon,
  REPRINT_LAST:        SubtotalIcon,
  ISSUE_VOUCHER:       VoucherIcon,
  TOGGLE_LANGUAGE:     SubtotalIcon,
};

export function LayoutGrid({
  buttons,
  products,
  columns,
  rows,
  priceLevel,
  colorTheme = "standard",
  onItemButton,
  onCategoryButton,
  onActionButton,
}: LayoutGridProps) {
  const isLight = colorTheme === "light";
  const emptySlotClass = isLight
    ? "rounded-xl border border-dashed border-gray-300 bg-gray-200/40"
    : "rounded-xl border border-dashed border-gray-800 bg-gray-900/30";
  const barClass = isLight
    ? "bg-gray-50 border-b border-gray-200"
    : "bg-gray-900 border-b border-gray-800";
  const barTextMuted = isLight ? "text-gray-500 hover:text-gray-800" : "text-gray-400 hover:text-white";
  const barTextLabel = isLight ? "text-gray-900" : "text-white";
  // Stack of sublayout IDs navigated into. Empty = root panel.
  const [panelStack, setPanelStack] = useState<string[]>([]);
  const currentPanelId = panelStack.length > 0 ? panelStack[panelStack.length - 1] : null;

  const productMap = new Map(products.map((p) => [p.server_id, p]));

  // Buttons belonging to the current panel
  const panelButtons = buttons.filter((b) =>
    currentPanelId === null
      ? !b.sublayout_id                  // root: no sublayout_id
      : b.sublayout_id === currentPanelId // child: matching id
  );

  const totalSlots = columns * rows;

  // Build a position → button map, then compute grid-area spans
  // We use CSS grid-column/row span via inline style on each rendered cell.
  // Occupied positions are tracked so we skip rendering placeholder there.
  const occupied = new Set<number>();
  const slotMap = new Map<number, LayoutButton>();

  // Sort by position so earlier slots win on overlap
  const sorted = [...panelButtons].sort((a, b) => a.position - b.position);
  for (const btn of sorted) {
    if (btn.position < 0 || btn.position >= totalSlots) continue;
    if (occupied.has(btn.position)) continue;
    slotMap.set(btn.position, btn);
    const cs = btn.colspan ?? 1;
    const rs = btn.rowspan ?? 1;
    const col = btn.position % columns;
    const row = Math.floor(btn.position / columns);
    for (let r = 0; r < rs; r++) {
      for (let c = 0; c < cs; c++) {
        const pos = (row + r) * columns + (col + c);
        if (pos < totalSlots) occupied.add(pos);
      }
    }
  }

  function priceForLevel(p: Product): number {
    if (p.timed_price != null) return p.timed_price;
    const prices = [p.price1, p.price2, p.price3, p.price4, p.price5];
    return prices[priceLevel - 1] || p.price1;
  }

  function pushPanel(sublayoutId: string) {
    setPanelStack((s) => [...s, sublayoutId]);
  }

  function popPanel() {
    setPanelStack((s) => s.slice(0, -1));
  }

  function renderButton(btn: LayoutButton, index: number) {
    const cs = Math.min(btn.colspan ?? 1, columns);
    const rs = btn.rowspan ?? 1;
    const col = (index % columns) + 1;          // CSS grid 1-based
    const rowStart = Math.floor(index / columns) + 1;
    // Always use explicit placement so spanning buttons never clash with auto-flow
    const spanStyle: CSSProperties = {
      gridColumn: `${col} / span ${cs}`,
      gridRow: `${rowStart} / span ${rs}`,
    };

    if (btn.button_type === "empty") {
      return <div key={index} style={spanStyle} className={emptySlotClass} />;
    }

    if (btn.button_type === "item") {
      const product = btn.item_id ? productMap.get(btn.item_id) : null;
      const price = product ? priceForLevel(product) : null;
      return (
        <button
          key={index}
          onClick={() => product && onItemButton(product)}
          disabled={!product}
          style={{ backgroundColor: btn.color || "#374151", ...spanStyle }}
          className="rounded-xl p-2 text-left flex flex-col justify-between transition-all hover:brightness-110 active:scale-95 disabled:opacity-30 min-h-0 overflow-hidden"
          data-testid={`grid-btn-${index}`}
        >
          <span className="text-white text-xs font-semibold leading-tight line-clamp-3 flex-1">
            {btn.label}
          </span>
          {price != null && (
            <span className="text-white/75 text-xs mt-1 font-medium">
              {formatCurrency(price)}
              {product?.timed_price != null && <span className="ml-1 text-amber-300">★</span>}
            </span>
          )}
        </button>
      );
    }

    if (btn.button_type === "category") {
      return (
        <button
          key={index}
          onClick={() => btn.category_id && onCategoryButton(btn.category_id)}
          style={{ backgroundColor: btn.color || "#1f2937", ...spanStyle }}
          className="rounded-xl p-2 flex items-center justify-center transition-all hover:brightness-110 active:scale-95"
          data-testid={`grid-cat-${index}`}
        >
          <span className="text-white text-xs font-semibold text-center leading-tight">
            {btn.label}
          </span>
        </button>
      );
    }

    if (btn.button_type === "action") {
      const colorClass = btn.action_code
        ? ACTION_COLORS[btn.action_code] ?? "bg-gray-700 hover:bg-gray-600 text-white"
        : "bg-gray-700 hover:bg-gray-600 text-white";
      const ActionIcon = btn.action_code ? ACTION_ICONS[btn.action_code] : undefined;
      return (
        <button
          key={index}
          onClick={() => btn.action_code && onActionButton(btn.action_code)}
          style={spanStyle}
          className={`rounded-xl p-2 text-center flex flex-col items-center justify-center gap-1 font-semibold text-xs transition-all active:scale-95 ${colorClass}`}
          data-testid={`grid-action-${index}`}
        >
          {ActionIcon && <ActionIcon className="w-5 h-5" />}
          {btn.label}
        </button>
      );
    }

    if (btn.button_type === "sublayout") {
      // Check whether this sublayout has any child buttons
      const hasChildren = buttons.some((b) => b.sublayout_id === btn.sublayout_id && b !== btn);
      return (
        <button
          key={index}
          onClick={() => btn.sublayout_id && pushPanel(btn.sublayout_id)}
          disabled={!btn.sublayout_id}
          style={{ backgroundColor: btn.color || "#1e3a5f", ...spanStyle }}
          className="rounded-xl p-2 text-left flex flex-col justify-between transition-all hover:brightness-110 active:scale-95 disabled:opacity-30 overflow-hidden"
          data-testid={`grid-sublayout-${index}`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-white text-xs font-semibold leading-tight line-clamp-2 flex-1">
              {btn.label}
            </span>
            <LayersIcon className="w-3.5 h-3.5 text-white/60 flex-shrink-0" />
          </div>
          {hasChildren && (
            <span className="text-white/50 text-[10px] mt-1">tap to expand</span>
          )}
        </button>
      );
    }

    return null;
  }

  // Determine the label for the current panel (find the sublayout button that opened it)
  const currentPanelLabel = currentPanelId
    ? buttons.find((b) => b.button_type === "sublayout" && b.sublayout_id === currentPanelId)?.label
    : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Breadcrumb / back bar — shown when inside a child panel */}
      {panelStack.length > 0 && (
        <div className={`flex items-center gap-2 px-3 py-1.5 flex-shrink-0 ${barClass}`}>
          <button
            onClick={popPanel}
            className={`flex items-center gap-1 text-xs font-medium transition-colors active:scale-95 ${barTextMuted}`}
            data-testid="grid-back"
          >
            <ChevronLeftIcon className="w-4 h-4" />
            Back
          </button>
          {panelStack.length > 1 && (
            <>
              <span className={`text-xs ${isLight ? "text-gray-300" : "text-gray-700"}`}>/</span>
              {panelStack.slice(0, -1).map((id, i) => {
                const lbl = buttons.find((b) => b.button_type === "sublayout" && b.sublayout_id === id)?.label ?? id;
                return (
                  <button
                    key={id}
                    onClick={() => setPanelStack((s) => s.slice(0, i + 1))}
                    className={`text-xs transition-colors ${isLight ? "text-gray-500 hover:text-gray-800" : "text-gray-500 hover:text-gray-300"}`}
                  >
                    {lbl}
                  </button>
                );
              })}
              <span className={`text-xs ${isLight ? "text-gray-300" : "text-gray-700"}`}>/</span>
            </>
          )}
          {currentPanelLabel && (
            <span className={`text-xs font-semibold ${barTextLabel}`}>{currentPanelLabel}</span>
          )}
          <button
            onClick={() => setPanelStack([])}
            className={`ml-auto text-xs transition-colors ${isLight ? "text-gray-400 hover:text-gray-700" : "text-gray-600 hover:text-gray-400"}`}
            data-testid="grid-root"
          >
            Root
          </button>
        </div>
      )}

      {/* Grid */}
      <div
        className="flex-1 grid gap-1.5 p-2 overflow-hidden"
        style={{
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
        }}
      >
        {Array.from({ length: totalSlots }, (_, i) => {
          if (occupied.has(i) && !slotMap.has(i)) return null; // inner span cell — skip
          const btn = slotMap.get(i);
          const col = (i % columns) + 1;
          const rowStart = Math.floor(i / columns) + 1;
          if (!btn) {
            return (
              <div
                key={i}
                style={{ gridColumn: `${col}`, gridRow: `${rowStart}` }}
                className={emptySlotClass}
              />
            );
          }
          return renderButton(btn, i);
        })}
      </div>
    </div>
  );
}
