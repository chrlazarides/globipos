import { useEffect, useMemo, useState } from "react";
import { GroceryProductTile } from "./GroceryProductTile";
import type { CSSProperties, ComponentType, SVGProps } from "react";
import { ChevronLeftIcon, ChevronRightIcon, HomeIcon, LayersIcon, ReceiptTextIcon, SearchIcon, XIcon } from "lucide-react";
import {
  CashIcon, CardIcon, VoidIcon, HoldIcon, RecallIcon, DiscountIcon, SubtotalIcon,
  VoucherIcon, RefundIcon, PayIcon, LoyaltyIcon,
} from "./icons/PosIcons";
import type { Category, LayoutButton, Product } from "../types";
import { formatCurrency, getPriceForLevel } from "../lib/pricing";
import type { PosColorTheme } from "../hooks/useWindowSize";

interface LayoutGridProps {
  buttons: LayoutButton[];
  products: Product[];
  columns: number;
  rows: number;
  priceLevel: number;
  colorTheme?: PosColorTheme;
  categories?: Category[];
  selectedCategoryId?: string | null;
  busyProductId?: string | null;
  groceryPage?: number;
  groceryTotal?: number;
  groceryLoading?: boolean;
  groceryError?: string | null;
  fastKeysOpen?: boolean;
  onOpenFastKeys?: () => void;
  pluQuery?: string;
  pluProduct?: Product | null;
  searchProducts?: Product[];
  pluLoading?: boolean;
  pluError?: string | null;
  onPluQueryChange?: (query: string) => void;
  imageBaseUrl?: string;
  onGroceryPageChange?: (page: number, columns: number) => void;
  onItemButton: (product: Product) => void;
  onCategoryButton: (categoryId: string | null) => boolean | void;
  onActionButton: (actionCode: string) => void;
  paymentsEnabled?: boolean;
}

const ACTION_COLORS: Record<string, string> = {
  PAY_CASH:            "bg-green-700 hover:bg-green-600 text-white",
  PAY_CARD:            "bg-blue-700 hover:bg-blue-600 text-white",
  PAY_SPLIT:           "bg-cyan-700 hover:bg-cyan-600 text-white",
  PAY_VOUCHER:         "bg-pink-800 hover:bg-pink-700 text-white",
  VOID_ORDER:          "bg-red-800 hover:bg-red-700 text-white",
  CLEAR_ORDER:         "bg-red-800 hover:bg-red-700 text-white",
  VOID_LINE:           "bg-red-800 hover:bg-red-700 text-white",
  VOID_SALE:           "bg-red-800 hover:bg-red-700 text-white",
  HOLD_ORDER:          "bg-amber-700 hover:bg-amber-600 text-white",
  RECALL_ORDER:        "bg-amber-700 hover:bg-amber-600 text-white",
  QTY:                 "bg-slate-700 hover:bg-slate-600 text-white",
  WEIGHT:              "bg-indigo-700 hover:bg-indigo-600 text-white",
  PRICE_CHECK:         "bg-cyan-700 hover:bg-cyan-600 text-white",
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
  DEPT_SALE_VAT_19:    "bg-red-700 hover:bg-red-600 text-white",
  DEPT_SALE_VAT_5:     "bg-blue-700 hover:bg-blue-600 text-white",
  REVIEW_TRANSACTIONS: "bg-indigo-700 hover:bg-indigo-600 text-white",
  ISSUE_CREDIT_NOTE:   "bg-pink-800 hover:bg-pink-700 text-white",
  REDEEM_CREDIT_NOTE:  "bg-pink-800 hover:bg-pink-700 text-white",
  LINE_SURCHARGE_PCT:  "bg-purple-800 hover:bg-purple-700 text-white",
  CORRECTION:          "bg-red-800 hover:bg-red-700 text-white",
  REPRINT_LAST:        "bg-slate-700 hover:bg-slate-600 text-white",
  ISSUE_VOUCHER:       "bg-pink-800 hover:bg-pink-700 text-white",
  TOGGLE_LANGUAGE:     "bg-slate-700 hover:bg-slate-600 text-white",
  CUSTOMER_LOOKUP:     "bg-violet-700 hover:bg-violet-600 text-white",
  CUSTOMER_CLEAR:      "bg-violet-800 hover:bg-violet-700 text-white",
  REFUND:              "bg-rose-800 hover:bg-rose-700 text-white",
  EXCHANGE:            "bg-rose-700 hover:bg-rose-600 text-white",
  MANAGER_OVERRIDE:    "bg-red-900 hover:bg-red-800 text-white",
  CHANGE_CASHIER:      "bg-slate-800 hover:bg-slate-700 text-white",
};

const ACTION_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  PAY_CASH:            CashIcon,
  PAY_CARD:            CardIcon,
  PAY_SPLIT:           PayIcon,
  PAY_VOUCHER:         VoucherIcon,
  VOID_ORDER:          VoidIcon,
  CLEAR_ORDER:         VoidIcon,
  VOID_LINE:           VoidIcon,
  VOID_SALE:           VoidIcon,
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
  QTY:                 SubtotalIcon,
  WEIGHT:              SubtotalIcon,
  CASH_IN:             CashIcon,
  CASH_OUT:            CashIcon,
  PETTY_CASH:          CashIcon,
  OPEN_DRAWER:         CashIcon,
  DECLARE_CASH:        CashIcon,
  DEPT_SALE:           PayIcon,
  DEPT_SALE_VAT_19:    PayIcon,
  DEPT_SALE_VAT_5:     PayIcon,
  REVIEW_TRANSACTIONS: ReceiptTextIcon,
  ISSUE_CREDIT_NOTE:   VoucherIcon,
  REDEEM_CREDIT_NOTE:  RefundIcon,
  LINE_SURCHARGE_PCT:  DiscountIcon,
  CORRECTION:          VoidIcon,
  REPRINT_LAST:        SubtotalIcon,
  ISSUE_VOUCHER:       VoucherIcon,
  TOGGLE_LANGUAGE:     SubtotalIcon,
  CUSTOMER_LOOKUP:     LoyaltyIcon,
  CUSTOMER_CLEAR:      LoyaltyIcon,
  REFUND:              RefundIcon,
  EXCHANGE:            RefundIcon,
  MANAGER_OVERRIDE:    VoidIcon,
  CHANGE_CASHIER:      LoyaltyIcon,
};

export function LayoutGrid({
  buttons,
  products,
  columns,
  rows,
  priceLevel,
  colorTheme = "standard",
  categories = [],
  selectedCategoryId = null,
  busyProductId = null,
  groceryPage,
  groceryTotal,
  groceryLoading = false,
  groceryError = null,
  fastKeysOpen = false,
  onOpenFastKeys,
  pluQuery = "",
  pluProduct = null,
  searchProducts = [],
  pluLoading = false,
  pluError = null,
  onPluQueryChange,
  imageBaseUrl,
  onGroceryPageChange,
  onItemButton,
  onCategoryButton,
  onActionButton,
  paymentsEnabled = false,
}: LayoutGridProps) {
  const isFresh = colorTheme === "fresh";
  const [freshAssignmentsOpen, setFreshAssignmentsOpen] = useState(false);
  const isLight = colorTheme === "light" || isFresh;
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

  const totalSlots = isFresh && freshAssignmentsOpen
    ? Math.max(columns * rows, ...panelButtons.map(b => b.position + columns * (b.rowspan ?? 1)))
    : columns * rows;

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
    return getPriceForLevel(p, priceLevel);
  }

  // ── Category view ──
  const [gridCols, setGridCols] = useState<number>(isFresh ? columns : 6);
  useEffect(() => {
    if (isFresh) {
      setGridCols(columns);
      onGroceryPageChange?.(0, columns);
    }
  }, [isFresh, columns]);
  const [page, setPage] = useState(0);

  const catByKey = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) { m.set(c.server_id, c); m.set(c.id, c); }
    return m;
  }, [categories]);
  const selectedCat = selectedCategoryId ? catByKey.get(selectedCategoryId) ?? null : null;

  const descendantKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!selectedCategoryId) return keys;
    const root = catByKey.get(selectedCategoryId);
    const seen = new Set<Category>();
    const queue: Category[] = root ? [root] : [];
    keys.add(selectedCategoryId);
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      keys.add(cur.id); keys.add(cur.server_id);
      for (const c of categories) {
        if (c.active !== false && !seen.has(c) && c.parent_id && (c.parent_id === cur.id || c.parent_id === cur.server_id)) queue.push(c);
      }
    }
    return keys;
  }, [categories, catByKey, selectedCategoryId]);

  const childCats = selectedCat
    ? categories.filter((c) => c.active !== false && c.parent_id && (c.parent_id === selectedCat.id || c.parent_id === selectedCat.server_id))
    : [];
  const catProducts = selectedCategoryId
    ? products.filter((p) => p.category_id && descendantKeys.has(p.category_id))
    : [];
  const perPage = gridCols * 4;
  const serverPaged = groceryPage != null && groceryTotal != null;
  const totalCount = serverPaged ? groceryTotal : catProducts.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / perPage));
  const safePage = Math.min(serverPaged ? groceryPage : page, pageCount - 1);
  const pageProducts = serverPaged ? catProducts : catProducts.slice(safePage * perPage, safePage * perPage + perPage);
  const showItems = !(serverPaged && groceryLoading);
  function goPage(n: number) {
    if (serverPaged) onGroceryPageChange?.(n, gridCols);
    else setPage(n);
  }
  function setCols(n: number) {
    setGridCols(n);
    if (serverPaged) onGroceryPageChange?.(0, n);
  }

  useEffect(() => { setPage(0); }, [selectedCategoryId, gridCols]);

  const assignedTabs: { id: string; label: string }[] = [];
  for (const b of buttons) {
    if (b.button_type === "category" && b.category_id && !assignedTabs.some((t) => t.id === b.category_id)) {
      assignedTabs.push({ id: b.category_id, label: b.label || catByKey.get(b.category_id)?.name || "" });
    }
  }
  const tabs = [...assignedTabs];
  for (const c of isFresh ? categories.filter(c => c.active !== false && !c.parent_id) : []) {
    if (!tabs.some(tab => catByKey.get(tab.id)?.server_id === c.server_id)) tabs.push({ id: c.server_id, label: c.name });
  }
  const showFastKeys = (!isFresh || !freshAssignmentsOpen) && (fastKeysOpen || !!selectedCategoryId);
  function tabIcon(label: string) {
    if (/vegetable/i.test(label)) return "🥦";
    if (/fruit|produce/i.test(label)) return "🍎";
    if (/bakery|bread/i.test(label)) return "🥖";
    if (/\b(ice|bags?|packaging)\b/i.test(label)) return "🧊";
    return "";
  }

  function pickCategory(id: string | null) {
    if (id === null) setPanelStack([]);
    const r = onCategoryButton(id);
    return r;
  }
  const rootOfSelected = (() => {
    let cur = selectedCat; const seen = new Set<Category>();
    while (cur && cur.parent_id && !seen.has(cur)) { seen.add(cur); const p = catByKey.get(cur.parent_id); if (!p) break; cur = p; }
    return cur;
  })();
  function isTabActive(id: string) {
    if (!selectedCat) return false;
    const t = catByKey.get(id);
    return id === selectedCategoryId || (!!t && !!rootOfSelected && (t.id === rootOfSelected.id));
  }
  const tabIdle = isLight ? "bg-white text-gray-700 border-gray-200 hover:bg-green-50" : "bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-700";
  const tabOn = isFresh ? "bg-green-700 text-white border-green-700 shadow-sm" : "bg-green-700 text-white border-green-700";
  const tileFor = (t: { id: string }) => { const c = catByKey.get(t.id); const keys = new Set([t.id, c?.id, c?.server_id]); return products.find((p) => p.image_url && p.category_id && keys.has(p.category_id)); };

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
          title={btn.label}
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
      {isFresh && <div className={`flex flex-wrap items-center gap-2 px-3 py-2 flex-shrink-0 ${barClass}`}
        data-testid="fresh-payment-functions">
        {[
          ["PAY_CASH", "Cash"], ["PAY_CARD", "Card"], ["PAY_SPLIT", "Split"],
        ].map(([code, label]) => (
          <button key={code} type="button" onClick={() => onActionButton(code)}
            disabled={!paymentsEnabled}
            data-testid={`fresh-${code.toLowerCase()}`}
            className={`rounded-lg border px-4 py-2 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed ${tabIdle}`}>
            {label}
          </button>
        ))}
        <button type="button" onClick={() => setFreshAssignmentsOpen(open => !open)}
          aria-expanded={freshAssignmentsOpen} data-testid="fresh-layout-functions"
          className={`ml-auto rounded-lg border px-3 py-2 text-sm font-bold ${tabIdle}`}>
          {freshAssignmentsOpen ? "Back to products" : "Layout functions"}
        </button>
      </div>}
      {!isFresh && !showFastKeys && onOpenFastKeys && (
        <button type="button" onClick={onOpenFastKeys} data-testid="open-fast-keys"
          className={`m-2 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold ${tabIdle}`}>
          <SearchIcon className="h-4 w-4" /> Fast-Keys / PLU lookup
        </button>
      )}
      {showFastKeys && onPluQueryChange && (
        <div className={`px-3 py-2 flex-shrink-0 ${barClass}`}>
          {!isFresh && <label htmlFor="fast-key-plu" className={`block text-xs font-bold mb-1 ${barTextLabel}`}>Fast-Keys / Look-Up — PLU code</label>}
          <div className="flex items-center gap-2">
            <SearchIcon className={`h-4 w-4 ${barTextMuted}`} />
            <input id="fast-key-plu" data-testid="fast-key-plu-search" value={pluQuery} inputMode={isFresh ? "text" : "numeric"}
              onChange={event => onPluQueryChange(event.target.value)}
              placeholder={isFresh ? "Search products or enter a PLU code" : "Type a PLU code, e.g. 4011"} autoComplete="off" maxLength={64}
              className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm ${tabIdle}`} />
            {pluQuery && <button type="button" onClick={() => onPluQueryChange("")} aria-label="Clear PLU search" data-testid="clear-plu-search"
              className={`rounded-lg border p-2 ${tabIdle}`}><XIcon className="h-4 w-4" /></button>}
          </div>
        </div>
      )}
      {showFastKeys && tabs.length > 0 && (
        <div className={`flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto flex-shrink-0 ${barClass}`} data-testid="category-tabs">
          <button
            onClick={() => pickCategory(null)}
            className={`flex items-center gap-1 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-bold active:scale-95 ${!selectedCategoryId ? tabOn : tabIdle}`}
            data-testid="category-tab-home"
          >
            <HomeIcon className="w-3.5 h-3.5" /> Home
          </button>
          {tabs.map((t) => {
            const ph = isFresh ? tileFor(t) : undefined;
            const src = ph?.image_url ? (ph.image_url.startsWith("data:image/") ? ph.image_url : (() => { try { return new URL(ph.image_url, imageBaseUrl ? `${imageBaseUrl.replace(/\/$/, "")}/` : undefined).href; } catch { return ""; } })()) : "";
            return isFresh ? (
              <button key={t.id} onClick={() => pickCategory(t.id)} data-testid={`category-tab-${t.id}`}
                className={`flex w-24 flex-shrink-0 flex-col items-center gap-1 rounded-xl border p-1.5 text-xs font-bold active:scale-95 ${isTabActive(t.id) ? "border-green-700 bg-green-100 text-green-900" : "border-gray-200 bg-white text-gray-700"}`}>
                <span className="flex h-12 w-full items-center justify-center overflow-hidden rounded-lg bg-green-50">
                  {src ? <img src={src} alt="" className="h-full w-full object-contain" /> : <LayersIcon className="h-5 w-5 text-green-700" />}
                </span>
                <span className="w-full truncate text-center">{t.label}</span>
              </button>
            ) : (
            <button
              key={t.id}
              onClick={() => pickCategory(t.id)}
              className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-bold active:scale-95 ${isTabActive(t.id) ? tabOn : tabIdle}`}
              data-testid={`category-tab-${t.id}`}
            >
              {tabIcon(t.label)} {t.label}
            </button>
            );
          })}
        </div>
      )}

      {showFastKeys && pluQuery.trim() ? (
        <div className="flex-1 min-h-0 overflow-auto p-3" aria-live="polite" data-testid="plu-results">
          {pluLoading ? <p className={`text-sm ${barTextMuted}`}>Looking up PLU…</p>
            : pluError ? <p className="text-sm text-red-500" role="alert">{pluError}</p>
            : pluProduct ? <div className="h-52 w-44 flex">
                <GroceryProductTile product={pluProduct} price={priceForLevel(pluProduct)} light={isLight}
                  imageBaseUrl={imageBaseUrl}
                  busy={busyProductId === pluProduct.server_id} disabled={!!busyProductId}
                  onClick={() => onItemButton(pluProduct)} />
              </div>
            : isFresh && searchProducts.length ? <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
                {searchProducts.map(product => <div key={product.server_id} className="h-52 flex">
                  <GroceryProductTile product={product} price={priceForLevel(product)} light={isLight}
                    imageBaseUrl={imageBaseUrl} busy={busyProductId === product.server_id}
                    disabled={!!busyProductId} onClick={() => onItemButton(product)} />
                </div>)}
              </div>
            : <p className={`text-sm ${barTextMuted}`}>{isFresh ? "No active products match this name or PLU." : "No active item matches this PLU. Check its catalogue PLU/SKU code."}</p>}
        </div>
      ) : showFastKeys && !selectedCategoryId ? (
        <div className={`p-4 text-sm ${barTextMuted}`}>Choose a category above, or type a PLU code to find an item.</div>
      ) : showFastKeys && selectedCategoryId ? (
        <div className="flex flex-col flex-1 min-h-0" data-testid="category-view">
          <div className={`flex items-center gap-2 px-3 py-1.5 flex-shrink-0 ${barClass}`}>
            <button
              onClick={() => pickCategory(selectedCat?.parent_id && catByKey.has(selectedCat.parent_id) ? selectedCat.parent_id : null)}
              className={`flex items-center gap-1 text-xs font-medium active:scale-95 ${barTextMuted}`}
              data-testid="category-back"
            >
              <ChevronLeftIcon className="w-4 h-4" /> Back
            </button>
            <span className={`text-xs font-semibold ${barTextLabel}`}>{selectedCat?.name ?? ""}</span>
            <div className="ml-auto flex items-center gap-1">
              {(isFresh ? [...new Set([columns, 6, 8])] : [6, 8]).map((n) => (
                <button
                  key={n}
                  onClick={() => setCols(n)}
                  className={`rounded-md border px-2 py-0.5 text-xs font-bold ${gridCols === n ? tabOn : tabIdle}`}
                  data-testid={`category-cols-${n}`}
                >
                  {n}x4
                </button>
              ))}
              <button onClick={() => pickCategory(null)} className={`ml-2 text-xs ${barTextMuted}`} data-testid="category-home">Home</button>
            </div>
          </div>

          {childCats.length > 0 && (
            <div className="flex gap-1.5 px-2 pt-2 overflow-x-auto flex-shrink-0">
              {childCats.map((c) => (
                <button
                  key={c.server_id}
                  onClick={() => pickCategory(c.server_id)}
                  className={`whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-bold active:scale-95 ${tabIdle}`}
                  data-testid={`category-child-${c.server_id}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {groceryError ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-red-500" data-testid="category-error">
              <span>{groceryError}</span>
              <button onClick={() => goPage(safePage)} className={`rounded-md border px-3 py-1 text-xs font-bold ${tabIdle}`} data-testid="category-retry">Retry</button>
            </div>
          ) : !showItems ? (
            <div className={`flex-1 flex items-center justify-center text-sm animate-pulse ${isLight ? "text-gray-500" : "text-gray-400"}`} data-testid="category-loading">
              Loading products…
            </div>
          ) : catProducts.length === 0 ? (
            <div className={`flex-1 flex items-center justify-center text-sm ${isLight ? "text-gray-500" : "text-gray-400"}`} data-testid="category-empty">
              No products in this category
            </div>
          ) : (
            <div
              className="flex-1 grid gap-1.5 p-2 min-h-0 overflow-hidden"
              style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`, gridTemplateRows: "repeat(4, minmax(0, 1fr))" }}
            >
              {pageProducts.map((p) => (
                <GroceryProductTile
                  key={p.server_id}
                  product={p}
                  imageBaseUrl={imageBaseUrl}
                  price={priceForLevel(p)}
                  light={isLight}
                  busy={busyProductId === p.server_id || busyProductId === p.id}
                  disabled={busyProductId != null}
                  onClick={() => { if (busyProductId == null) onItemButton(p); }}
                />
              ))}
            </div>
          )}

          {(pageCount > 1 || serverPaged) && !groceryError && (
            <div className={`flex items-center justify-center gap-3 py-1 flex-shrink-0 ${barClass}`}>
              <button disabled={safePage === 0 || groceryLoading} onClick={() => goPage(safePage - 1)} className={`p-1 disabled:opacity-30 ${barTextMuted}`} data-testid="category-prev">
                <ChevronLeftIcon className="w-5 h-5" />
              </button>
              <span className={`text-xs font-semibold ${barTextLabel}`}>{safePage + 1} / {pageCount}</span>
              <button disabled={safePage >= pageCount - 1 || groceryLoading} onClick={() => goPage(safePage + 1)} className={`p-1 disabled:opacity-30 ${barTextMuted}`} data-testid="category-next">
                <ChevronRightIcon className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      ) : (
      <>
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
              Home
          </button>
        </div>
      )}

      {/* Grid */}
      <div
        className={`flex-1 grid gap-1.5 p-2 ${isFresh && freshAssignmentsOpen ? "overflow-y-auto" : "overflow-hidden"}`}
        style={{
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gridTemplateRows: isFresh && freshAssignmentsOpen
            ? `repeat(${Math.ceil(totalSlots / columns)}, minmax(64px, 1fr))`
            : `repeat(${rows}, 1fr)`,
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
      </>
      )}
    </div>
  );
}
