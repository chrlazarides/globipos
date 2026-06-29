import {
  PauseIcon, PlayIcon, XCircleIcon, StickyNoteIcon, RepeatIcon,
  PercentIcon, TagIcon, SmartphoneIcon, ShieldIcon, RotateCcwIcon,
} from "lucide-react";
import type { NumpadMode } from "../types";

interface ActionBarProps {
  hasLines: boolean;
  hasSelectedLine: boolean;
  onHold: () => void;
  onRecall: () => void;
  onVoidOrder: () => void;
  onLineNote: () => void;
  onOrderNote: () => void;
  onRepeatLast: () => void;
  onNumpad: (mode: NumpadMode) => void;
  onPromoCode: () => void;
  onFallbackRules: () => void;
  onRemoveDiscount: () => void;
}

export function ActionBar({
  hasLines,
  hasSelectedLine,
  onHold,
  onRecall,
  onVoidOrder,
  onLineNote,
  onOrderNote,
  onRepeatLast,
  onNumpad,
  onPromoCode,
  onFallbackRules,
  onRemoveDiscount,
}: ActionBarProps) {
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
      icon: PauseIcon,
      onClick: onHold,
      enabled: hasLines,
      testId: "action-hold",
    },
    {
      label: "Recall",
      icon: PlayIcon,
      onClick: onRecall,
      enabled: true,
      testId: "action-recall",
    },
    {
      label: "Void Order",
      icon: XCircleIcon,
      onClick: onVoidOrder,
      enabled: hasLines,
      className: "text-red-400 hover:bg-red-950",
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
      icon: PercentIcon,
      onClick: () => onNumpad("line_discount_pct"),
      enabled: hasSelectedLine,
      testId: "action-line-pct",
    },
    {
      label: "Line €",
      icon: TagIcon,
      onClick: () => onNumpad("line_discount_fixed"),
      enabled: hasSelectedLine,
      testId: "action-line-fixed",
    },
    {
      label: "Order %",
      icon: PercentIcon,
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
      icon: TagIcon,
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
  ];

  return (
    <div className="border-t border-gray-800 bg-gray-900 px-3 py-2 flex items-center gap-1.5 overflow-x-auto flex-shrink-0">
      {buttons.map((btn) => {
        const Icon = btn.icon;
        return (
          <button
            key={btn.testId}
            onClick={btn.onClick}
            disabled={!btn.enabled}
            className={`flex-shrink-0 flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed
              ${btn.className ?? "text-gray-400 hover:bg-gray-800 hover:text-gray-200"}`}
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
