/**
 * ScaleBar — compact scale display shown in the POS header or action bar.
 *
 * Shows live weight with stability indicator, tare button, and
 * the effective price/kg computed from the selected product.
 */

import { Scale, RotateCcw, AlertCircle } from "lucide-react";
import type { ScaleReading } from "../hooks/useHardware";

interface ScaleBarProps {
  weight: ScaleReading | null;
  error: string | null;
  pricePerKg?: number;          // if set, shows computed price
  onTare: () => void;
  onWeightConfirm?: (kg: number) => void;  // callback when cashier accepts weight
  className?: string;
}

export default function ScaleBar({
  weight,
  error,
  pricePerKg,
  onTare,
  onWeightConfirm,
  className = "",
}: ScaleBarProps) {
  const kg = weight?.kg ?? 0;
  const stable = weight?.stable ?? false;
  const lineTotal = pricePerKg != null ? kg * pricePerKg : null;

  return (
    <div
      data-testid="scale-bar"
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm
        ${error
          ? "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300"
          : stable
            ? "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-300"
            : "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
        } ${className}`}
    >
      {error ? (
        <>
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="truncate">{error}</span>
        </>
      ) : (
        <>
          <Scale className="h-4 w-4 shrink-0" />

          {/* Weight display */}
          <span className="font-mono font-semibold text-base tabular-nums w-24 text-right">
            {weight != null ? `${weight.grams.toFixed(0)} g` : "— g"}
          </span>

          {/* Stability indicator */}
          <span className={`w-2 h-2 rounded-full shrink-0 ${stable ? "bg-green-500" : "bg-yellow-400 animate-pulse"}`} />

          {/* kg display */}
          <span className="text-muted-foreground tabular-nums">
            {weight != null ? `${kg.toFixed(3)} kg` : ""}
          </span>

          {/* Price */}
          {lineTotal != null && (
            <span className="font-semibold text-primary ml-auto tabular-nums">
              €{lineTotal.toFixed(2)}
            </span>
          )}

          {/* Tare button */}
          <button
            data-testid="scale-tare-btn"
            onClick={onTare}
            title="Tare (zero the scale)"
            className="ml-1 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>

          {/* Accept weight button (when pricePerKg given) */}
          {onWeightConfirm && stable && kg > 0 && (
            <button
              data-testid="scale-confirm-btn"
              onClick={() => onWeightConfirm(kg)}
              className="ml-1 rounded bg-green-600 px-2 py-0.5 text-white text-xs font-medium hover:bg-green-700 transition-colors"
            >
              Add
            </button>
          )}
        </>
      )}
    </div>
  );
}
