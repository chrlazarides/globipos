import type { LayoutButton, Product, ButtonType } from "../types";
import { formatCurrency } from "../lib/pricing";

interface LayoutGridProps {
  buttons: LayoutButton[];
  products: Product[];
  columns: number;
  rows: number;
  priceLevel: number;
  onItemButton: (product: Product) => void;
  onCategoryButton: (categoryId: string) => void;
  onActionButton: (actionCode: string) => void;
}

const ACTION_COLORS: Record<string, string> = {
  PAY_CASH:           "bg-green-800 hover:bg-green-700 text-green-100",
  PAY_CARD:           "bg-blue-800 hover:bg-blue-700 text-blue-100",
  VOID_ORDER:         "bg-red-900 hover:bg-red-800 text-red-100",
  CLEAR_ORDER:        "bg-red-900 hover:bg-red-800 text-red-100",
  HOLD_ORDER:         "bg-amber-800 hover:bg-amber-700 text-amber-100",
  RECALL_ORDER:       "bg-amber-800 hover:bg-amber-700 text-amber-100",
  PRICE_OVERRIDE:     "bg-purple-900 hover:bg-purple-800 text-purple-100",
  LINE_DISCOUNT_PCT:  "bg-purple-900 hover:bg-purple-800 text-purple-100",
  ORDER_DISCOUNT_PCT: "bg-purple-900 hover:bg-purple-800 text-purple-100",
  PROMO_CODE:         "bg-purple-900 hover:bg-purple-800 text-purple-100",
};

export function LayoutGrid({
  buttons,
  products,
  columns,
  rows,
  priceLevel,
  onItemButton,
  onCategoryButton,
  onActionButton,
}: LayoutGridProps) {
  const productMap = new Map(products.map((p) => [p.server_id, p]));
  const totalSlots = columns * rows;

  // Fill empty slots
  const slots: (LayoutButton | null)[] = Array(totalSlots).fill(null);
  for (const btn of buttons) {
    if (btn.position >= 0 && btn.position < totalSlots) {
      slots[btn.position] = btn;
    }
  }

  function priceForLevel(p: Product): number {
    if (p.timed_price != null) return p.timed_price;
    const prices = [p.price1, p.price2, p.price3, p.price4, p.price5];
    return prices[priceLevel - 1] || p.price1;
  }

  function renderButton(btn: LayoutButton | null, index: number) {
    if (!btn || btn.button_type === "empty") {
      return (
        <div
          key={index}
          className="rounded-xl border border-dashed border-gray-800 bg-gray-900/30"
        />
      );
    }

    if (btn.button_type === "item") {
      const product = btn.item_id ? productMap.get(btn.item_id) : null;
      return (
        <button
          key={index}
          onClick={() => product && onItemButton(product)}
          disabled={!product}
          style={{ backgroundColor: btn.color || "#374151" }}
          className="rounded-xl p-2 text-left flex flex-col justify-between transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-30 min-h-0 overflow-hidden"
          data-testid={`grid-btn-${index}`}
        >
          <span className="text-white text-xs font-semibold leading-tight line-clamp-2 flex-1">
            {btn.label}
          </span>
          {product && (
            <span className="text-white/70 text-xs mt-1">
              {formatCurrency(priceForLevel(product))}
              {product.timed_price != null && <span className="ml-1 text-amber-300">★</span>}
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
          style={{ backgroundColor: btn.color || "#1f2937" }}
          className="rounded-xl p-2 text-left flex items-center justify-center transition-opacity hover:opacity-90 active:scale-95"
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
      return (
        <button
          key={index}
          onClick={() => btn.action_code && onActionButton(btn.action_code)}
          className={`rounded-xl p-2 text-center flex items-center justify-center font-semibold text-xs transition-all active:scale-95 ${colorClass}`}
          data-testid={`grid-action-${index}`}
        >
          {btn.label}
        </button>
      );
    }

    return null;
  }

  return (
    <div
      className="flex-1 grid gap-1.5 p-2 overflow-hidden"
      style={{
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {slots.map((btn, i) => renderButton(btn, i))}
    </div>
  );
}
