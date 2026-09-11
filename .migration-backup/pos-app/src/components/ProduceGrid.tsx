/**
 * ProduceGrid — visual PLU / fresh produce selector.
 *
 * Shows a grid of produce items with photos or emoji icons.
 * Each item has a price/kg; cashier taps → weight prompt appears →
 * item is added to basket with the weighed quantity.
 *
 * Also supports PLU (numeric) code entry for items without barcodes.
 * Used in supermarket mode for fresh fruit, veg, meat, deli counter, etc.
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, Scale, Hash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Product } from "../types";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProduceItem extends Product {
  plu_code?: string;
  price_per_kg?: number;
  emoji?: string;       // fallback when no photo
  category_name?: string;
}

interface ProduceGridProps {
  onAdd: (product: Product, qty: number) => void;
  currentWeightKg?: number;   // from scale hook
  onRequestWeigh?: () => void;
}

// Produce emoji map for display when no photo available
const PRODUCE_EMOJI: Record<string, string> = {
  apple: "🍎", banana: "🍌", orange: "🍊", grape: "🍇",
  tomato: "🍅", potato: "🥔", onion: "🧅", carrot: "🥕",
  broccoli: "🥦", pepper: "🫑", cucumber: "🥒", lettuce: "🥬",
  mushroom: "🍄", lemon: "🍋", strawberry: "🍓", cherry: "🍒",
  peach: "🍑", melon: "🍈", watermelon: "🍉", pear: "🍐",
  meat: "🥩", chicken: "🍗", fish: "🐟", cheese: "🧀",
};

function getEmoji(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(PRODUCE_EMOJI)) {
    if (lower.includes(key)) return emoji;
  }
  return "🛒";
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ProduceGrid({ onAdd, currentWeightKg, onRequestWeigh }: ProduceGridProps) {
  const [items, setItems] = useState<ProduceItem[]>([]);
  const [filter, setFilter] = useState("");
  const [pluCode, setPluCode] = useState("");
  const [selected, setSelected] = useState<ProduceItem | null>(null);
  const [weightDialogOpen, setWeightDialogOpen] = useState(false);
  const [manualWeight, setManualWeight] = useState("");

  useEffect(() => {
    invoke<ProduceItem[]>("get_produce_items").then(setItems).catch(() => {});
  }, []);

  const filtered = items.filter((it) =>
    !filter || it.name.toLowerCase().includes(filter.toLowerCase())
  );

  // PLU lookup
  function handlePluSearch() {
    const found = items.find((it) => it.plu_code === pluCode || it.sku === pluCode);
    if (found) {
      openWeighDialog(found);
    }
    setPluCode("");
  }

  function openWeighDialog(item: ProduceItem) {
    setSelected(item);
    setManualWeight(currentWeightKg ? currentWeightKg.toFixed(3) : "");
    setWeightDialogOpen(true);
  }

  function confirmAdd() {
    if (!selected) return;
    const kg = parseFloat(manualWeight) || currentWeightKg || 0;
    if (kg <= 0) return;

    const pricePerKg = selected.price_per_kg ?? selected.price1;
    const lineTotal = kg * pricePerKg;

    const productWithWeight: Product = {
      ...selected,
      // Encode weight into qty; unit_price = price/kg
      price1: pricePerKg,
    };

    onAdd(productWithWeight, kg);
    setWeightDialogOpen(false);
    setSelected(null);
    setManualWeight("");
  }

  const confirmWeight = parseFloat(manualWeight) || currentWeightKg || 0;
  const lineTotal = selected
    ? confirmWeight * (selected.price_per_kg ?? selected.price1)
    : 0;

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Search + PLU row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-produce-search"
            className="pl-8"
            placeholder="Search produce…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          <Input
            data-testid="input-plu-code"
            className="w-24"
            placeholder="PLU"
            value={pluCode}
            onChange={(e) => setPluCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handlePluSearch()}
          />
          <Button
            size="icon"
            variant="outline"
            data-testid="btn-plu-search"
            onClick={handlePluSearch}
            disabled={!pluCode}
          >
            <Hash className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 overflow-y-auto flex-1 pr-1">
        {filtered.map((item) => (
          <button
            key={item.id}
            data-testid={`produce-item-${item.id}`}
            onClick={() => openWeighDialog(item)}
            className="flex flex-col items-center gap-1 rounded-xl border bg-card p-3 hover:bg-muted/60 transition-colors active:scale-95 text-center"
          >
            <span className="text-3xl leading-none">{item.emoji || getEmoji(item.name)}</span>
            <span className="text-xs font-medium leading-tight line-clamp-2">{item.name}</span>
            <span className="text-xs text-primary font-semibold">
              €{(item.price_per_kg ?? item.price1).toFixed(2)}/kg
            </span>
            {item.plu_code && (
              <span className="text-[10px] text-muted-foreground">PLU {item.plu_code}</span>
            )}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-muted-foreground text-sm py-8">
            No produce items found
          </div>
        )}
      </div>

      {/* Weight entry dialog */}
      <Dialog open={weightDialogOpen} onOpenChange={setWeightDialogOpen}>
        <DialogContent className="sm:max-w-xs" data-testid="weight-entry-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-4 w-4" />
              {selected?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Price: €{(selected?.price_per_kg ?? selected?.price1 ?? 0).toFixed(2)}/kg
            </p>

            {/* Scale weight or manual */}
            {currentWeightKg != null && currentWeightKg > 0 && (
              <div className="rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-2 text-center">
                <p className="text-sm text-green-700 dark:text-green-300 font-medium">
                  Scale: {currentWeightKg.toFixed(3)} kg
                </p>
                <button
                  className="text-xs text-green-600 dark:text-green-400 underline mt-0.5"
                  onClick={() => setManualWeight(currentWeightKg.toFixed(3))}
                >
                  Use scale weight
                </button>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-sm font-medium">Weight (kg)</label>
              <Input
                data-testid="input-produce-weight"
                type="number"
                min={0.001}
                step={0.001}
                placeholder="0.000"
                value={manualWeight}
                onChange={(e) => setManualWeight(e.target.value)}
                autoFocus
              />
            </div>

            {confirmWeight > 0 && (
              <div className="text-right text-lg font-bold text-primary">
                €{lineTotal.toFixed(2)}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {onRequestWeigh && (
              <Button variant="outline" size="sm" onClick={onRequestWeigh} data-testid="btn-request-weigh">
                <Scale className="h-3.5 w-3.5 mr-1" /> Weigh
              </Button>
            )}
            <Button
              data-testid="btn-confirm-produce"
              onClick={confirmAdd}
              disabled={confirmWeight <= 0}
              className="flex-1"
            >
              Add to order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
