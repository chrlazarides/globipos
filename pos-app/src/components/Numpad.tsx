import { useState, useEffect } from "react";
import { DeleteIcon, XIcon } from "lucide-react";
import type { NumpadMode } from "../types";
import { formatCurrency } from "../lib/pricing";
import type { PosUiTheme } from "../hooks/usePosTheme";

interface NumpadProps {
  mode: NumpadMode;
  onConfirm: (value: number) => void;
  onClose: () => void;
  currentValue?: number;
  theme?: PosUiTheme;
}

const MODE_LABELS: Record<NumpadMode, string> = {
  qty:                 "Set Quantity",
  price_override:      "Override Price",
  line_discount_pct:   "Line Discount %",
  line_discount_fixed: "Line Discount €",
  order_discount_pct:  "Order Discount %",
  order_discount_fixed:"Order Discount €",
  amount_tendered:     "Amount Tendered",
  price_check:         "Price Check",
  qty_multiplier:      "Qty × (before scan)",
  surcharge_pct:       "Surcharge / Cover %",
  line_surcharge_pct:  "Item Surcharge % (Pagomena)",
  cash_in:             "Cash In Amount",
  cash_out:            "Cash Out Amount",
  petty_cash:          "Petty Cash Amount",
  dept_sale:           "Department Amount",
};

const MODE_SUFFIX: Partial<Record<NumpadMode, string>> = {
  line_discount_pct:   "%",
  order_discount_pct:  "%",
  surcharge_pct:       "%",
  line_surcharge_pct:  "%",
};

const MODE_PREFIX: Partial<Record<NumpadMode, string>> = {
  price_override:      "€",
  line_discount_fixed: "€",
  order_discount_fixed:"€",
  amount_tendered:     "€",
  cash_in:             "€",
  cash_out:            "€",
  petty_cash:          "€",
  dept_sale:           "€",
};

export function Numpad({ mode, onConfirm, onClose, currentValue, theme = "light" }: NumpadProps) {
  const isLight = theme === "light";
  const [display, setDisplay] = useState(
    currentValue != null && currentValue > 0 ? String(currentValue) : ""
  );
  const hasDecimal = mode !== "qty" && mode !== "qty_multiplier";
  const prefix = MODE_PREFIX[mode] ?? "";
  const suffix = MODE_SUFFIX[mode] ?? "";
  const label  = MODE_LABELS[mode] ?? "Enter Value";

  function handleDigit(d: string) {
    if (d === "." && !hasDecimal) return;
    if (d === "." && display.includes(".")) return;
    // Limit decimal places
    if (display.includes(".")) {
      const [, dec] = display.split(".");
      if (dec && dec.length >= 2) return;
    }
    setDisplay((p) => (p === "0" ? (d === "." ? "0." : d) : p + d));
  }

  function handleDelete() {
    setDisplay((p) => p.length <= 1 ? "" : p.slice(0, -1));
  }

  function handleConfirm() {
    const val = parseFloat(display || "0");
    if (!isNaN(val)) onConfirm(val);
    onClose();
  }

  // Keyboard support
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      e.stopPropagation();
      if (e.key >= "0" && e.key <= "9") handleDigit(e.key);
      else if (e.key === "." && hasDecimal) handleDigit(".");
      else if (e.key === "Backspace") handleDelete();
      else if (e.key === "Enter") handleConfirm();
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const keys = ["7","8","9","4","5","6","1","2","3",".",  "0","⌫"];
  const parsedVal = parseFloat(display || "0");

  const panelClass = isLight ? "bg-white border border-slate-200" : "bg-gray-900 border border-gray-700";
  const labelClass = isLight ? "text-slate-600" : "text-gray-300";
  const closeClass = isLight ? "text-slate-400 hover:text-slate-700" : "text-gray-600 hover:text-gray-300";
  const displayClass = isLight ? "bg-slate-100" : "bg-gray-800";
  const displayTextClass = isLight ? "text-slate-800" : "text-white";
  const keyClass = isLight
    ? "bg-slate-100 hover:bg-slate-200 text-slate-800"
    : "bg-gray-800 hover:bg-burgundy-800 text-white";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={`rounded-t-2xl sm:rounded-2xl w-full max-w-xs shadow-2xl p-4 ${panelClass}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <span className={`font-semibold text-sm ${labelClass}`}>{label}</span>
          <button onClick={onClose} className={`transition-colors ${closeClass}`}>
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Display */}
        <div className={`rounded-xl px-4 py-3 mb-4 text-right min-h-[52px] flex items-center justify-end ${displayClass}`}>
          <span className={`text-2xl font-mono font-bold tracking-tight ${displayTextClass}`}>
            {prefix}{display || "0"}{suffix}
          </span>
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2">
          {keys.map((k, i) => {
            if (k === "." && !hasDecimal) {
              return <div key={i} />;
            }
            if (k === "⌫") {
              return (
                <button
                  key={i}
                  onClick={handleDelete}
                  className={`h-12 flex items-center justify-center rounded-xl font-semibold text-lg transition-colors ${keyClass}`}
                  data-testid="numpad-delete"
                >
                  <DeleteIcon className="w-5 h-5" />
                </button>
              );
            }
            return (
              <button
                key={i}
                onClick={() => handleDigit(k)}
                className={`h-12 flex items-center justify-center rounded-xl font-semibold text-lg transition-colors active:scale-95 ${keyClass}`}
                data-testid={`numpad-${k}`}
              >
                {k}
              </button>
            );
          })}
        </div>

        {/* Confirm */}
        <button
          onClick={handleConfirm}
          disabled={!display || isNaN(parsedVal)}
          className="mt-3 w-full bg-burgundy-600 hover:bg-burgundy-500 text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-40"
          data-testid="numpad-confirm"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
