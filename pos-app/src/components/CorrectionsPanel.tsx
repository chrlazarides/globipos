import { useEffect, useState } from "react";
import { DeleteIcon } from "lucide-react";
import {
  HoldIcon, RecallIcon, VoidIcon, DiscountIcon,
} from "./icons/PosIcons";
import { StickyNoteIcon, RepeatIcon, SearchIcon, PackageIcon } from "lucide-react";
import type { OrderLine } from "../types";
import { formatCurrency } from "../lib/pricing";
import type { PosUiTheme } from "../hooks/usePosTheme";

type CorrectionMode = "qty" | "price" | "discount";

interface CorrectionsPanelProps {
  selectedLine: OrderLine | null;
  hasLines: boolean;
  theme?: PosUiTheme;
  onSetQty: (qty: number) => void;
  onSetPriceOverride: (price: number) => void;
  onSetLineDiscountPct: (pct: number) => void;
  onRemoveLine: () => void;
  onVoidLine: () => void;
  onHold: () => void;
  onRecall: () => void;
  onRepeatLast: () => void;
  onVoidOrder: () => void;
  onLineNote: () => void;
  onPromoCode: () => void;
  onRemoveDiscount: () => void;
  onDeptSale: () => void;
  onPriceCheck: () => void;
}

const NUMPAD_KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"];

export function CorrectionsPanel({
  selectedLine,
  hasLines,
  theme = "light",
  onSetQty,
  onSetPriceOverride,
  onSetLineDiscountPct,
  onRemoveLine,
  onVoidLine,
  onHold,
  onRecall,
  onRepeatLast,
  onVoidOrder,
  onLineNote,
  onPromoCode,
  onRemoveDiscount,
  onDeptSale,
  onPriceCheck,
}: CorrectionsPanelProps) {
  const isLight = theme === "light";
  const [mode, setMode] = useState<CorrectionMode>("qty");
  const [display, setDisplay] = useState("");

  // Reset the pending entry whenever the selected line changes
  useEffect(() => {
    setDisplay("");
    setMode("qty");
  }, [selectedLine?.id]);

  const panelClass = isLight
    ? "bg-slate-50 border-l border-slate-200"
    : "bg-gray-950 border-l border-gray-800";
  const contextClass = isLight ? "bg-white border border-slate-200" : "bg-gray-900 border border-gray-800";
  const contextLabelClass = isLight ? "text-slate-400" : "text-gray-500";
  const contextNameClass = isLight ? "text-slate-800" : "text-white";
  const tabActiveClass = "bg-sky-500 text-white";
  const tabInactiveClass = isLight ? "bg-slate-100 text-slate-600 hover:bg-slate-200" : "bg-gray-800 text-gray-300 hover:bg-gray-700";
  const numDisplayClass = isLight ? "bg-white border border-slate-200 text-slate-800" : "bg-gray-900 border border-gray-800 text-white";
  const numKeyClass = isLight ? "bg-white border border-slate-200 hover:bg-slate-100 text-slate-800" : "bg-gray-800 hover:bg-gray-700 text-white";
  const funcLabelClass = isLight ? "text-slate-400" : "text-gray-500";

  function pressKey(k: string) {
    if (k === "⌫") { setDisplay((d) => d.slice(0, -1)); return; }
    if (k === "." && display.includes(".")) return;
    setDisplay((d) => (d + k).slice(0, 8));
  }

  function applyCorrection() {
    if (!selectedLine || !display) return;
    const val = parseFloat(display);
    if (isNaN(val)) return;
    if (mode === "qty") onSetQty(Math.max(1, Math.round(val)));
    if (mode === "price") onSetPriceOverride(val);
    if (mode === "discount") onSetLineDiscountPct(Math.min(100, Math.max(0, val)));
    setDisplay("");
  }

  function applyQuickDiscount(pct: number) {
    if (!selectedLine) return;
    onSetLineDiscountPct(pct);
    setDisplay("");
  }

  const FUNCTION_KEYS: { label: string; onClick: () => void; tone: string; icon: React.ComponentType<{ className?: string }>; enabled: boolean }[] = [
    { label: "Hold", onClick: onHold, tone: "bg-amber-500 hover:bg-amber-400", icon: HoldIcon, enabled: hasLines },
    { label: "Recall", onClick: onRecall, tone: "bg-sky-500 hover:bg-sky-400", icon: RecallIcon, enabled: true },
    { label: "Repeat", onClick: onRepeatLast, tone: "bg-indigo-500 hover:bg-indigo-400", icon: RepeatIcon, enabled: hasLines },
    { label: "Line Note", onClick: onLineNote, tone: "bg-fuchsia-500 hover:bg-fuchsia-400", icon: StickyNoteIcon, enabled: !!selectedLine },
    { label: "Promo", onClick: onPromoCode, tone: "bg-pink-500 hover:bg-pink-400", icon: DiscountIcon, enabled: hasLines },
    { label: "Dept Sale", onClick: onDeptSale, tone: "bg-teal-500 hover:bg-teal-400", icon: PackageIcon, enabled: true },
    { label: "Price Check", onClick: onPriceCheck, tone: "bg-cyan-500 hover:bg-cyan-400", icon: SearchIcon, enabled: true },
    { label: "Remove Disc.", onClick: onRemoveDiscount, tone: "bg-slate-500 hover:bg-slate-400", icon: DiscountIcon, enabled: hasLines },
    { label: "Void Line", onClick: onVoidLine, tone: "bg-rose-500 hover:bg-rose-400", icon: VoidIcon, enabled: !!selectedLine },
    { label: "Void Order", onClick: onVoidOrder, tone: "bg-red-600 hover:bg-red-500", icon: VoidIcon, enabled: hasLines },
  ];

  return (
    <div className={`flex flex-col p-3 gap-3 overflow-y-auto ${panelClass}`} style={{ width: 320 }} data-testid="corrections-panel">
      {/* Correction context */}
      <div className={`rounded-xl px-3 py-2.5 ${contextClass}`}>
        {selectedLine ? (
          <>
            <div className={`text-[11px] mb-0.5 ${contextLabelClass}`}>Editing line</div>
            <div className={`text-sm font-semibold truncate ${contextNameClass}`} data-testid="text-editing-line">
              {selectedLine.description}
            </div>
            <div className="flex gap-1.5 mt-2">
              {(["qty", "price", "discount"] as CorrectionMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setDisplay(""); }}
                  className={`flex-1 text-[11px] font-semibold rounded-lg py-1.5 capitalize transition-colors ${mode === m ? tabActiveClass : tabInactiveClass}`}
                  data-testid={`button-correction-mode-${m}`}
                >
                  {m === "discount" ? "Disc %" : m}
                </button>
              ))}
            </div>
            {mode === "discount" && (
              <div className="flex gap-1.5 mt-1.5">
                {[5, 10, 20].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => applyQuickDiscount(pct)}
                    className="flex-1 text-[11px] font-semibold rounded-lg py-1 bg-emerald-500 hover:bg-emerald-400 text-white transition-colors"
                    data-testid={`button-quick-discount-${pct}`}
                  >
                    -{pct}%
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className={`text-xs ${contextLabelClass}`}>Select a journal line to edit qty, price or discount</div>
        )}
      </div>

      {/* Function keys */}
      <div>
        <div className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${funcLabelClass}`}>Quick Functions</div>
        <div className="grid grid-cols-2 gap-2">
          {FUNCTION_KEYS.map((f) => {
            const Icon = f.icon;
            return (
              <button
                key={f.label}
                onClick={f.onClick}
                disabled={!f.enabled}
                className={`text-white text-xs font-bold rounded-xl py-2.5 active:scale-95 transition-transform flex items-center justify-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed ${f.tone}`}
                data-testid={`button-function-${f.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Numpad */}
      <div>
        <div className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${funcLabelClass}`}>
          {selectedLine ? `Set ${mode === "discount" ? "Discount %" : mode}` : "Numpad"}
        </div>
        <div className={`rounded-xl px-3 py-2 text-right mb-2 ${numDisplayClass}`}>
          <span className="text-xl font-mono font-bold tracking-tight" data-testid="text-correction-display">
            {mode === "price" ? "€" : ""}{display || "0"}{mode === "discount" ? "%" : ""}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {NUMPAD_KEYS.map((k) => (
            <button
              key={k}
              onClick={() => pressKey(k)}
              disabled={!selectedLine}
              className={`text-lg font-bold rounded-xl py-2.5 active:scale-95 transition-transform disabled:opacity-30 ${numKeyClass}`}
              data-testid={`corrections-numpad-${k === "⌫" ? "delete" : k}`}
            >
              {k === "⌫" ? <DeleteIcon className="w-4 h-4 mx-auto" /> : k}
            </button>
          ))}
        </div>
        <button
          onClick={applyCorrection}
          disabled={!selectedLine || !display}
          className="mt-2 w-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-30 text-white text-sm font-bold rounded-xl py-2.5 transition-colors"
          data-testid="button-apply-correction"
        >
          Apply to Line
        </button>
      </div>
    </div>
  );
}
