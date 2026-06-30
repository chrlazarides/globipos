/**
 * useMultiBuy — multi-buy promotion & meal-deal engine.
 *
 * Loads active promotions from the local SQLite cache (synced from server).
 * On every basket change, re-evaluates all rules and computes the optimal
 * discount set. Returns a list of applied discounts to inject as order lines.
 *
 * Promotion types:
 *   buy_n_get_m  — Buy N of (items/categories), get M free (cheapest)
 *   qty_threshold— Buy N+, pay fixed price per item
 *   meal_deal    — Pick one from each slot → fixed bundle price
 *   coupon       — Barcode-validated fixed/% discount
 *   mix_match    — Any N items from a set for a fixed total price
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OrderLine } from "../types";

// ── Types ──────────────────────────────────────────────────────────────────────

export type PromoType =
  | "buy_n_get_m"
  | "qty_threshold"
  | "meal_deal"
  | "coupon"
  | "mix_match";

export interface Promotion {
  id: string;
  name: string;
  type: PromoType;
  product_ids: string[];      // specific items (empty = any in category)
  category_ids: string[];
  threshold_qty: number;      // buy N
  get_qty: number;            // get M free (buy_n_get_m)
  threshold_price: number;    // fixed price per unit when qty reached
  bundle_price: number;       // meal deal / mix_match bundle total
  discount_pct: number;       // percentage discount (coupon)
  discount_fixed: number;     // fixed amount off
  coupon_code?: string;
  valid_from?: string;
  valid_until?: string;
  active: boolean;
  priority: number;           // higher = applied first
  stackable: boolean;         // can this stack with other promos?
}

export interface AppliedPromo {
  promo_id: string;
  promo_name: string;
  discount_amount: number;
  description: string;
  affected_line_ids: string[];
}

export interface UseMultiBuyReturn {
  promotions: Promotion[];
  appliedPromos: AppliedPromo[];
  totalSavings: number;
  loading: boolean;
  error: string | null;

  evaluate: (lines: OrderLine[]) => AppliedPromo[];
  validateCoupon: (code: string) => Promise<{ valid: boolean; promo?: Promotion; message: string }>;
  applyCoupon: (promo: Promotion, lines: OrderLine[]) => AppliedPromo | null;
  loadPromotions: () => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function lineMatchesPromo(line: OrderLine, promo: Promotion): boolean {
  if (line.voided || !line.product_id) return false;
  if (promo.product_ids.length > 0) {
    return promo.product_ids.includes(line.product_id);
  }
  if (promo.category_ids.length > 0) {
    return promo.category_ids.includes((line as any).category_id ?? "");
  }
  return false; // need explicit matching
}

function evalBuyNGetM(promo: Promotion, lines: OrderLine[]): AppliedPromo | null {
  const eligible = lines.filter((l) => lineMatchesPromo(l, promo) && !l.voided);
  const totalQty = eligible.reduce((s, l) => s + l.qty, 0);
  const sets = Math.floor(totalQty / (promo.threshold_qty + promo.get_qty));
  if (sets === 0) return null;

  const freeQty = sets * promo.get_qty;
  // Apply discount to cheapest lines first
  const sorted = [...eligible].sort((a, b) => a.unit_price - b.unit_price);
  let remaining = freeQty;
  let discount = 0;
  const affected: string[] = [];
  for (const line of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, line.qty);
    discount += take * line.unit_price;
    remaining -= take;
    affected.push(line.id);
  }
  return {
    promo_id: promo.id,
    promo_name: promo.name,
    discount_amount: Math.round(discount * 100) / 100,
    description: `${promo.name}: ${freeQty} item(s) free`,
    affected_line_ids: affected,
  };
}

function evalQtyThreshold(promo: Promotion, lines: OrderLine[]): AppliedPromo | null {
  const eligible = lines.filter((l) => lineMatchesPromo(l, promo) && !l.voided);
  const totalQty = eligible.reduce((s, l) => s + l.qty, 0);
  if (totalQty < promo.threshold_qty) return null;

  const currentTotal = eligible.reduce((s, l) => s + l.line_total, 0);
  const newTotal = totalQty * promo.threshold_price;
  const discount = Math.max(0, currentTotal - newTotal);
  if (discount < 0.01) return null;

  return {
    promo_id: promo.id,
    promo_name: promo.name,
    discount_amount: Math.round(discount * 100) / 100,
    description: `${promo.name}: €${promo.threshold_price.toFixed(2)} each`,
    affected_line_ids: eligible.map((l) => l.id),
  };
}

function evalMixMatch(promo: Promotion, lines: OrderLine[]): AppliedPromo | null {
  const eligible = lines.filter((l) => lineMatchesPromo(l, promo) && !l.voided);
  const totalQty = eligible.reduce((s, l) => s + l.qty, 0);
  const sets = Math.floor(totalQty / promo.threshold_qty);
  if (sets === 0) return null;

  const eligibleTotal = eligible.reduce((s, l) => s + l.line_total, 0);
  const targetTotal = sets * promo.bundle_price;
  const discount = Math.max(0, eligibleTotal - targetTotal);
  if (discount < 0.01) return null;

  return {
    promo_id: promo.id,
    promo_name: promo.name,
    discount_amount: Math.round(discount * 100) / 100,
    description: `${promo.name}: ${sets * promo.threshold_qty} for €${targetTotal.toFixed(2)}`,
    affected_line_ids: eligible.map((l) => l.id),
  };
}

function evalMealDeal(promo: Promotion, lines: OrderLine[]): AppliedPromo | null {
  const eligible = lines.filter((l) => lineMatchesPromo(l, promo) && !l.voided);
  if (eligible.length < promo.threshold_qty) return null;

  const eligibleTotal = eligible.reduce((s, l) => s + l.line_total, 0);
  const discount = Math.max(0, eligibleTotal - promo.bundle_price);
  if (discount < 0.01) return null;

  return {
    promo_id: promo.id,
    promo_name: promo.name,
    discount_amount: Math.round(discount * 100) / 100,
    description: `${promo.name} deal: €${promo.bundle_price.toFixed(2)}`,
    affected_line_ids: eligible.map((l) => l.id),
  };
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useMultiBuy(): UseMultiBuyReturn {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [appliedPromos, setAppliedPromos] = useState<AppliedPromo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPromotions = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await invoke<Promotion[]>("get_promotions");
      setPromotions(rows.filter((p) => p.active));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load promotions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPromotions();
  }, [loadPromotions]);

  const evaluate = useCallback(
    (lines: OrderLine[]): AppliedPromo[] => {
      const now = new Date().toISOString();
      const active = promotions
        .filter((p) => p.active && p.type !== "coupon")
        .filter((p) => !p.valid_until || p.valid_until > now)
        .sort((a, b) => b.priority - a.priority);

      const applied: AppliedPromo[] = [];
      const usedLineIds = new Set<string>();

      for (const promo of active) {
        // Skip lines already claimed by a higher-priority non-stackable promo
        const availableLines = promo.stackable
          ? lines
          : lines.filter((l) => !usedLineIds.has(l.id));

        let result: AppliedPromo | null = null;
        switch (promo.type) {
          case "buy_n_get_m":    result = evalBuyNGetM(promo, availableLines); break;
          case "qty_threshold":  result = evalQtyThreshold(promo, availableLines); break;
          case "mix_match":      result = evalMixMatch(promo, availableLines); break;
          case "meal_deal":      result = evalMealDeal(promo, availableLines); break;
        }

        if (result) {
          applied.push(result);
          if (!promo.stackable) {
            result.affected_line_ids.forEach((id) => usedLineIds.add(id));
          }
        }
      }

      setAppliedPromos(applied);
      return applied;
    },
    [promotions]
  );

  const validateCoupon = useCallback(
    async (code: string): Promise<{ valid: boolean; promo?: Promotion; message: string }> => {
      const coupon = promotions.find(
        (p) => p.type === "coupon" && p.coupon_code?.toLowerCase() === code.toLowerCase()
      );
      if (!coupon) {
        // Try server/local validation via Tauri command (reads config from state)
        try {
          const result = await invoke<{ valid: boolean; promo?: Promotion; message?: string }>(
            "validate_coupon",
            { code }
          );
          if (!result || typeof result !== "object") {
            return { valid: false, message: "Could not validate coupon" };
          }
          return result.valid
            ? { valid: true, promo: result.promo, message: result.message ?? "Coupon applied" }
            : { valid: false, message: result.message ?? "Invalid or expired coupon" };
        } catch {
          return { valid: false, message: "Could not validate coupon" };
        }
      }
      const now = new Date().toISOString();
      if (coupon.valid_until && coupon.valid_until < now) {
        return { valid: false, message: "Coupon has expired" };
      }
      return { valid: true, promo: coupon, message: `Applied: ${coupon.name}` };
    },
    [promotions]
  );

  const applyCoupon = useCallback(
    (promo: Promotion, lines: OrderLine[]): AppliedPromo | null => {
      const eligible = lines.filter((l) => lineMatchesPromo(l, promo) && !l.voided);
      const base = eligible.length > 0
        ? eligible.reduce((s, l) => s + l.line_total, 0)
        : lines.reduce((s, l) => s + l.line_total, 0);

      let discount = 0;
      if (promo.discount_pct > 0) {
        discount = (base * promo.discount_pct) / 100;
      } else if (promo.discount_fixed > 0) {
        discount = Math.min(promo.discount_fixed, base);
      }
      if (discount <= 0) return null;

      const applied: AppliedPromo = {
        promo_id: promo.id,
        promo_name: promo.name,
        discount_amount: Math.round(discount * 100) / 100,
        description: promo.discount_pct > 0
          ? `Coupon: ${promo.discount_pct}% off`
          : `Coupon: €${discount.toFixed(2)} off`,
        affected_line_ids: (eligible.length > 0 ? eligible : lines).map((l) => l.id),
      };
      setAppliedPromos((prev) => [...prev, applied]);
      return applied;
    },
    []
  );

  const totalSavings = useMemo(
    () => appliedPromos.reduce((s, p) => s + p.discount_amount, 0),
    [appliedPromos]
  );

  return {
    promotions,
    appliedPromos,
    totalSavings,
    loading,
    error,
    evaluate,
    validateCoupon,
    applyCoupon,
    loadPromotions,
  };
}
