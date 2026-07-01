import { PlusIcon, MinusIcon, TrashIcon, StickyNoteIcon, MessageSquareIcon } from "lucide-react";
import type { OrderLine, Order } from "../types";
import { formatCurrency, computeLineAmounts } from "../lib/pricing";

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
}: OrderTicketProps) {
  const activeLines = lines.filter((l) => !l.voided);
  const voidedLines = lines.filter((l) => l.voided);
  const isEmpty = lines.length === 0;

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800 w-80 min-w-[300px] flex-shrink-0">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-gray-800 flex items-center justify-between">
        <div>
          <span className="text-gray-400 text-xs">Order</span>
          {order.order_number && (
            <span className="text-gray-500 text-xs ml-1">#{order.order_number}</span>
          )}
        </div>
        {!isEmpty && (
          <button
            onClick={onClear}
            className="text-gray-600 hover:text-red-400 text-xs transition-colors"
            title="Clear order"
            data-testid="button-clear-order"
          >
            Clear
          </button>
        )}
      </div>

      {/* Line items */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-700 gap-2">
            <MessageSquareIcon className="w-8 h-8 opacity-30" />
            <p className="text-sm">Tap a product to start</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {activeLines.map((line) => {
              const isSelected = line.id === selectedLineId;
              const { lineDiscount, vatAmount } = computeLineAmounts(line);
              const hasDiscount = line.line_discount_pct > 0 || line.line_discount_fixed > 0 || line.override_price != null;
              return (
                <div
                  key={line.id}
                  onClick={() => onSelectLine(line.id)}
                  className={`px-3 py-2.5 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-burgundy-900/40 border-l-2 border-burgundy-500"
                      : "hover:bg-gray-800/50"
                  }`}
                  data-testid={`ticket-line-${line.id}`}
                >
                  {/* Name + total */}
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-white text-sm font-medium leading-tight flex-1 truncate">
                      {line.description}
                    </span>
                    <span className="text-white text-sm font-semibold flex-shrink-0">
                      {formatCurrency(line.line_total)}
                    </span>
                  </div>

                  {/* Notes */}
                  {line.note && (
                    <div className="flex items-center gap-1 text-amber-400 text-xs mb-1.5">
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
                        className="w-6 h-6 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors active:scale-90"
                        data-testid={`sub-qty-${line.id}`}
                      >
                        <MinusIcon className="w-3 h-3 text-gray-300" />
                      </button>

                      <span className="text-gray-300 text-xs font-semibold w-6 text-center">
                        {line.qty}
                      </span>

                      {/* Add */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onSelectLine(line.id); onAddQty(); }}
                        className="w-6 h-6 rounded-full bg-green-800 hover:bg-green-700 flex items-center justify-center transition-colors active:scale-90"
                        data-testid={`add-qty-${line.id}`}
                      >
                        <PlusIcon className="w-3 h-3 text-green-100" />
                      </button>

                      <span className="text-gray-600 text-xs ml-1">
                        × {formatCurrency(line.override_price ?? line.unit_price)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {hasDiscount && (
                        <span className="text-green-400 text-xs">
                          -{formatCurrency(lineDiscount)}
                        </span>
                      )}
                      {line.vat_rate > 0 && (
                        <span className="text-gray-600 text-xs">
                          VAT {formatCurrency(vatAmount)}
                        </span>
                      )}
                      {/* Remove — always visible */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onSelectLine(line.id); onVoidLine(); }}
                        className="w-6 h-6 rounded-full bg-gray-800 hover:bg-red-900 flex items-center justify-center transition-colors active:scale-90"
                        title="Remove line"
                        data-testid={`remove-line-${line.id}`}
                      >
                        <TrashIcon className="w-3 h-3 text-gray-500 hover:text-red-400" />
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
                    <div className="text-gray-500 text-sm line-through truncate">{line.description}</div>
                  </div>
                  <div className="text-gray-600 text-xs line-through">{formatCurrency(line.line_total)}</div>
                </div>
                <span className="text-red-600 text-xs">VOID</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Totals */}
      <div className="border-t border-gray-800 px-3 py-3 space-y-1.5">
        {order.discount_amount > 0 && (
          <>
            <div className="flex justify-between text-sm text-gray-400">
              <span>Subtotal</span>
              <span>{formatCurrency(order.subtotal + order.discount_amount)}</span>
            </div>
            <div className="flex justify-between text-sm text-green-400">
              <span>Savings</span>
              <span>-{formatCurrency(order.discount_amount)}</span>
            </div>
          </>
        )}
        {order.vat_amount > 0 && (
          <div className="flex justify-between text-xs text-gray-500">
            <span>VAT</span>
            <span>{formatCurrency(order.vat_amount)}</span>
          </div>
        )}
        <div className="flex justify-between text-white font-bold text-lg border-t border-gray-800 pt-2 mt-2">
          <span>TOTAL</span>
          <span>{formatCurrency(order.total)}</span>
        </div>
      </div>

      {/* Pay button */}
      <div className="px-3 pb-3">
        <button
          onClick={onPay}
          disabled={isEmpty || order.total <= 0}
          className="w-full bg-green-700 hover:bg-green-600 text-white font-bold py-3.5 rounded-xl text-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
          data-testid="button-pay"
        >
          PAY {!isEmpty ? formatCurrency(order.total) : ""}
        </button>
      </div>
    </div>
  );
}
