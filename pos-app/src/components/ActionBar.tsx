import {
  StickyNoteIcon, RepeatIcon,
  SmartphoneIcon, ShieldIcon, RotateCcwIcon,
  CalendarClock, MonitorSmartphone, BarcodeIcon, BookOpenIcon, ArrowLeftRightIcon,
} from "lucide-react";
import { HoldIcon, RecallIcon, VoidIcon, RefundIcon, DiscountIcon } from "./icons/PosIcons";
import type { NumpadMode } from "../types";
import type { PosUiTheme } from "../hooks/usePosTheme";

interface ActionBarProps {
  hasLines: boolean;
  hasSelectedLine: boolean;
  theme?: PosUiTheme;
  onHold: () => void;
  onRecall: () => void;
  onVoidOrder: () => void;
  onLineNote: () => void;
  onOrderNote: () => void;
  onRepeatLast: () => void;
  onNumpad: (mode: NumpadMode) => void;
  onPromoCode: () => void;
  onFallbackRules: () => void;
  onBarcodeConfig: () => void;
  onRemoveDiscount: () => void;
  onRefund?: () => void;
  onShift?: () => void;
  onSco?: () => void;
  onManual?: () => void;
  onStockTransfer?: () => void;
}

export function ActionBar({
  hasLines,
  hasSelectedLine,
  theme = "light",
  onHold,
  onRecall,
  onVoidOrder,
  onLineNote,
  onOrderNote,
  onRepeatLast,
  onNumpad,
  onPromoCode,
  onFallbackRules,
  onBarcodeConfig,
  onRemoveDiscount,
  onRefund,
  onShift,
  onSco,
  onManual,
  onStockTransfer,
}: ActionBarProps) {
  const isLight = theme === "light";
  type Btn = {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    enabled: boolean;
    className?: string;
    testId: string;
  };

  const buttons: Btn[] = [
    {
      label: "Hold",
      icon: HoldIcon,
      onClick: onHold,
      enabled: hasLines,
      testId: "action-hold",
    },
    {
      label: "Recall",
      icon: RecallIcon,
      onClick: onRecall,
      enabled: true,
      testId: "action-recall",
    },
    {
      label: "Void Order",
      icon: VoidIcon,
      onClick: onVoidOrder,
      enabled: hasLines,
      className: isLight ? "text-red-500 hover:bg-red-50" : "text-red-400 hover:bg-red-950",
      testId: "action-void-order",
    },
    {
      label: "Repeat",
      icon: RepeatIcon,
      onClick: onRepeatLast,
      enabled: hasLines,
      testId: "action-repeat",
    },
    {
      label: "Line Note",
      icon: StickyNoteIcon,
      onClick: onLineNote,
      enabled: hasSelectedLine,
      testId: "action-line-note",
    },
    {
      label: "Order Note",
      icon: StickyNoteIcon,
      onClick: onOrderNote,
      enabled: true,
      testId: "action-order-note",
    },
    {
      label: "Line %",
      icon: DiscountIcon,
      onClick: () => onNumpad("line_discount_pct"),
      enabled: hasSelectedLine,
      testId: "action-line-pct",
    },
    {
      label: "Line €",
      icon: DiscountIcon,
      onClick: () => onNumpad("line_discount_fixed"),
      enabled: hasSelectedLine,
      testId: "action-line-fixed",
    },
    {
      label: "Order %",
      icon: DiscountIcon,
      onClick: () => onNumpad("order_discount_pct"),
      enabled: hasLines,
      testId: "action-order-pct",
    },
    {
      label: "Price Override",
      icon: SmartphoneIcon,
      onClick: () => onNumpad("price_override"),
      enabled: hasSelectedLine,
      testId: "action-price-override",
    },
    {
      label: "Promo Code",
      icon: DiscountIcon,
      onClick: onPromoCode,
      enabled: hasLines,
      testId: "action-promo",
    },
    {
      label: "Remove Disc",
      icon: RotateCcwIcon,
      onClick: onRemoveDiscount,
      enabled: hasLines,
      testId: "action-remove-discount",
    },
    {
      label: "Fallback Rules",
      icon: ShieldIcon,
      onClick: onFallbackRules,
      enabled: true,
      testId: "action-fallback",
    },
    {
      label: "Barcode Structure",
      icon: BarcodeIcon,
      onClick: onBarcodeConfig,
      enabled: true,
      testId: "action-barcode-config",
    },
    ...(onRefund ? [{
      label: "Refund",
      icon: RefundIcon,
      onClick: onRefund,
      enabled: true,
      className: isLight ? "text-amber-600 hover:bg-amber-50" : "text-amber-400 hover:bg-amber-950",
      testId: "action-refund",
    }] : []),
    ...(onShift ? [{
      label: "Shift",
      icon: CalendarClock,
      onClick: onShift,
      enabled: true,
      testId: "action-shift",
    }] : []),
    ...(onSco ? [{
      label: "SCO Mode",
      icon: MonitorSmartphone,
      onClick: onSco,
      enabled: true,
      testId: "action-sco",
    }] : []),
    ...(onManual ? [{
      label: "Manual",
      icon: BookOpenIcon,
      onClick: onManual,
      enabled: true,
      testId: "action-manual",
    }] : []),
    ...(onStockTransfer ? [{
      label: "Stock Transfer",
      icon: ArrowLeftRightIcon,
      onClick: onStockTransfer,
      enabled: true,
      testId: "action-stock-transfer",
    }] : []),
  ];

  const barClass = isLight
    ? "border-t border-slate-200 bg-white px-3 py-2 flex items-center gap-1.5 overflow-x-auto flex-shrink-0"
    : "border-t border-gray-800 bg-gray-900 px-3 py-2 flex items-center gap-1.5 overflow-x-auto flex-shrink-0";
  const defaultBtnClass = isLight
    ? "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
    : "text-gray-400 hover:bg-gray-800 hover:text-gray-200";

  return (
    <div className={barClass}>
      {buttons.map((btn) => {
        const Icon = btn.icon;
        return (
          <button
            key={btn.testId}
            onClick={btn.onClick}
            disabled={!btn.enabled}
            className={`flex-shrink-0 flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed
              ${btn.className ?? defaultBtnClass}`}
            data-testid={btn.testId}
          >
            <Icon className="w-4 h-4" />
            <span className="whitespace-nowrap">{btn.label}</span>
          </button>
        );
      })}
    </div>
  );
}
