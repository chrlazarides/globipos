import { PlusIcon, MinusIcon, TrashIcon, StickyNoteIcon, MessageSquareIcon } from "lucide-react";
import { SubtotalIcon, PayIcon } from "./icons/PosIcons";
import type { OrderLine, Order } from "../types";
import { formatCurrency, computeLineAmounts } from "../lib/pricing";
import type { PosUiTheme } from "../hooks/usePosTheme";

interface OrderTicketProps {
  order: Order;
  lines: OrderLine[];
  selectedLineId: string | null;
  onSelectLine: (id: string) => void;
  onAddQty: () => void;
  onSubQty: () => void;
  onRemoveLine: () => void;
  onVoidLine: () => void;
  onPay: () => void;
  onClear: () => void;
  theme?: PosUiTheme;
}

export function OrderTicket({
  order,
  lines,
  selectedLineId,
  onSelectLine,
  onAddQty,
  onSubQty,
  onRemoveLine,
  onVoidLine,
  onPay,
  onClear,
  theme = "light",
}: OrderTicketProps) {
  const activeLines = lines.filter((l) => !l.voided);
  const voidedLines = lines.filter((l) => l.voided);
  const isEmpty = lines.length === 0;
  const isLight = theme === "light";

  const rootClass = isLight
    ? "flex flex-col h-full bg-white border-l border-slate-200 w-[360px] min-w-[320px] flex-shrink-0"
    : "flex flex-col h-full bg-gray-900 border-l border-gray-800 w-[360px] min-w-[320px] flex-shrink-0";
  const headerClass = isLight
    ? "px-4 py-3 border-b border-slate-100 flex items-center justify-between"
    : "px-3 py-2.5 border-b border-gray-800 flex items-center justify-between";
  const labelClass = isLight ? "text-slate-400 text-xs" : "text-gray-400 text-xs";
  const orderNumClass = isLight ? "text-slate-400 text-xs ml-1" : "text-gray-500 text-xs ml-1";
  const clearClass = isLight
    ? "text-slate-400 hover:text-red-500 text-xs transition-colors"
    : "text-gray-600 hover:text-red-400 text-xs transition-colors";
  const emptyIconClass = isLight ? "text-slate-300" : "text-gray-700";
  const emptyTextClass = isLight ? "text-slate-400" : "text-gray-700";
  const divideClass = isLight ? "divide-slate-100" : "divide-gray-800";
  const rowSelectedClass = isLight
    ? "bg-sky-50 border-l-4 border-sky-400"
    : "bg-burgundy-900/40 border-l-2 border-burgundy-500";
  const rowHoverClass = isLight ? "hover:bg-slate-50 border-l-4 border-transparent" : "hover:bg-gray-800/50";
  const nameClass = isLight ? "text-slate-800 text-sm font-medium leading-tight flex-1 truncate" : "text-white text-sm font-medium leading-tight flex-1 truncate";
  const priceClass = isLight ? "text-slate-800 text-sm font-semibold flex-shrink-0" : "text-white text-sm font-semibold flex-shrink-0";
  const qtyBtnClass = isLight ? "bg-slate-200 hover:bg-slate-300" : "bg-gray-700 hover:bg-gray-600";
  const qtyBtnIconClass = isLight ? "text-slate-600" : "text-gray-300";
  const qtyTextClass = isLight ? "text-slate-700 text-xs font-semibold w-6 text-center" : "text-gray-300 text-xs font-semibold w-6 text-center";
  const unitPriceClass = isLight ? "text-slate-400 text-xs ml-1" : "text-gray-600 text-xs ml-1";
  const vatClass = isLight ? "text-slate-400 text-xs" : "text-gray-600 text-xs";
  const removeBtnClass = isLight ? "bg-slate-100 hover:bg-red-100" : "bg-gray-800 hover:bg-red-900";
  const removeIconClass = isLight ? "text-slate-400 hover:text-red-500" : "text-gray-500 hover:text-red-400";
  const totalsBorderClass = isLight ? "border-t border-slate-100 px-4 py-3 space-y-1.5" : "border-t border-gray-800 px-3 py-3 space-y-1.5";
  const totalsMutedClass = isLight ? "text-slate-500" : "text-gray-400";
  const totalsVatClass = isLight ? "text-slate-400" : "text-gray-500";
  const totalRowClass = isLight
    ? "flex justify-between text-slate-800 font-bold text-lg border-t border-slate-100 pt-2 mt-2"
    : "flex justify-between text-white font-bold text-lg border-t border-gray-800 pt-2 mt-2";

  return (
    <div className={rootClass}>
      {/* Header */}
      <div className={headerClass}>
        <div>
          <span className={labelClass}>Order</span>
          {order.order_number && <span className={orderNumClass}>#{order.order_number}</span>}
        </div>
        {!isEmpty && (
          <button onClick={onClear} className={clearClass} title="Clear order" data-testid="button-clear-order">
            Clear
          </button>
        )}
      </div>

      {/* Line items — scrolls independently of everything else on screen */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <MessageSquareIcon className={`w-8 h-8 opacity-40 ${emptyIconClass}`} />
            <p className={`text-sm ${emptyTextClass}`}>Tap a product to start</p>
          </div>
        ) : (
          <div className={`divide-y ${divideClass}`}>
            {activeLines.map((line) => {
              const isSelected = line.id === selectedLineId;
              const { lineDiscount, vatAmount } = computeLineAmounts(line);
              const hasDiscount = line.line_discount_pct > 0 || line.line_discount_fixed > 0 || line.override_price != null;
              return (
                <div
                  key={line.id}
                  onClick={() => onSelectLine(line.id)}
                  className={`px-3 py-2.5 cursor-pointer transition-colors ${isSelected ? rowSelectedClass : rowHoverClass}`}
                  data-testid={`ticket-line-${line.id}`}
                >
                  {/* Name + total */}
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className={nameClass}>{line.description}</span>
                    <span className={priceClass}>{formatCurrency(line.line_total)}</span>
                  </div>

                  {/* Notes */}
                  {line.note && (
                    <div className="flex items-center gap-1 text-amber-500 text-xs mb-1.5">
                      <StickyNoteIcon className="w-3 h-3" />
                      {line.note}
                    </div>
                  )}

                  {/* Inline qty controls — always visible */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      {/* Subtract */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onSelectLine(line.id); onSubQty(); }}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors active:scale-90 ${qtyBtnClass}`}
                        data-testid={`sub-qty-${line.id}`}
                      >
                        <MinusIcon className={`w-3 h-3 ${qtyBtnIconClass}`} />
                      </button>

                      <span className={qtyTextClass}>{line.qty}</span>

                      {/* Add */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onSelectLine(line.id); onAddQty(); }}
                        className="w-6 h-6 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center transition-colors active:scale-90"
                        data-testid={`add-qty-${line.id}`}
                      >
                        <PlusIcon className="w-3 h-3 text-white" />
                      </button>

                      <span className={unitPriceClass}>
                        × {formatCurrency(line.override_price ?? line.unit_price)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {hasDiscount && (
                        <span className="text-emerald-500 text-xs">-{formatCurrency(lineDiscount)}</span>
                      )}
                      {line.vat_rate > 0 && <span className={vatClass}>VAT {formatCurrency(vatAmount)}</span>}
                      {/* Remove — always visible */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onSelectLine(line.id); onVoidLine(); }}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors active:scale-90 ${removeBtnClass}`}
                        title="Remove line"
                        data-testid={`remove-line-${line.id}`}
                      >
                        <TrashIcon className={`w-3 h-3 ${removeIconClass}`} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Voided lines */}
            {voidedLines.map((line) => (
              <div key={line.id} className="px-3 py-2 opacity-40">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm line-through truncate ${isLight ? "text-slate-400" : "text-gray-500"}`}>{line.description}</div>
                  </div>
                  <div className={`text-xs line-through ${isLight ? "text-slate-400" : "text-gray-600"}`}>{formatCurrency(line.line_total)}</div>
                </div>
                <span className="text-red-500 text-xs">VOID</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Totals */}
      <div className={totalsBorderClass}>
        {order.discount_amount > 0 && (
          <>
            <div className={`flex justify-between text-sm ${totalsMutedClass}`}>
              <span className="flex items-center gap-1.5">
                <SubtotalIcon className="w-3.5 h-3.5" />
                Subtotal
              </span>
              <span>{formatCurrency(order.subtotal + order.discount_amount)}</span>
            </div>
            <div className="flex justify-between text-sm text-emerald-500">
              <span>Savings</span>
              <span>-{formatCurrency(order.discount_amount)}</span>
            </div>
          </>
        )}
        {order.vat_amount > 0 && (
          <div className={`flex justify-between text-xs ${totalsVatClass}`}>
            <span>VAT</span>
            <span>{formatCurrency(order.vat_amount)}</span>
          </div>
        )}
        <div className={totalRowClass}>
          <span>TOTAL</span>
          <span>{formatCurrency(order.total)}</span>
        </div>
      </div>

      {/* Pay button */}
      <div className="px-3 pb-3">
        <button
          onClick={onPay}
          disabled={isEmpty || order.total <= 0}
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-bold py-3.5 rounded-xl text-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-2"
          data-testid="button-pay"
        >
          <PayIcon className="w-5 h-5" />
          PAY {!isEmpty ? formatCurrency(order.total) : ""}
        </button>
      </div>
    </div>
  );
}
