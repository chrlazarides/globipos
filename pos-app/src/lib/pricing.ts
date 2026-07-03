/**
 * Pricing engine — pure functions with no side effects.
 * Implements all 11 pricing/discount functions.
 */

import type { Product, OrderLine, Order, LineAmounts } from "../types";

// ── Price level selection ─────────────────────────────────────────────────────

export function getPriceForLevel(product: Product, level: number): number {
  // Apply timed price override first (from inbox)
  if (product.timed_price != null) return product.timed_price;
  switch (level) {
    case 2: return product.price2 || product.price1;
    case 3: return product.price3 || product.price1;
    case 4: return product.price4 || product.price1;
    case 5: return product.price5 || product.price1;
    default: return product.price1;
  }
}

// ── Compute amounts for a single line ─────────────────────────────────────────

export function computeLineAmounts(line: Omit<OrderLine, "line_total" | "vat_amount">): LineAmounts {
  const effectiveUnitPrice =
    line.override_price != null ? line.override_price : line.unit_price;

  const lineSubtotal = round2(effectiveUnitPrice * line.qty);

  // Apply line discount (% first, then fixed)
  const pctDiscount = round2(lineSubtotal * (line.line_discount_pct / 100));
  const lineDiscount = round2(pctDiscount + line.line_discount_fixed);
  const lineNet = Math.max(0, round2(lineSubtotal - lineDiscount));

  const vatRate = line.vat_rate / 100;
  const vatAmount = round2(lineNet * vatRate);
  const lineTotal = round2(lineNet + vatAmount);

  return { effectiveUnitPrice, lineSubtotal, lineDiscount, lineNet, vatAmount, lineTotal };
}

// ── Compute order totals from lines ──────────────────────────────────────────

export interface OrderTotals {
  subtotal: number;      // sum of line nets (after line discounts, before order discount)
  orderDiscount: number; // order-level discount amount
  taxableAmount: number; // subtotal - orderDiscount
  vatAmount: number;     // VAT on taxableAmount
  surchargeAmount: number; // additional charge/surcharge (e.g. cover/service charge), applied after discount, before VAT
  total: number;         // taxableAmount + surchargeAmount + vatAmount
  discountAmount: number; // total discounts (line + order)
}

/**
 * Compute full order totals.
 * `surchargePct` implements the CPLPOS "Additional Charge" function — a % surcharge
 * (e.g. cover charge / service charge) applied to the discounted subtotal, and itself
 * subject to VAT like the rest of the order.
 */
export function computeOrderTotals(
  lines: OrderLine[],
  orderDiscountPct: number,
  orderDiscountFixed: number,
  surchargePct: number = 0
): OrderTotals {
  const activeLines = lines.filter((l) => !l.voided);

  const subtotal = round2(activeLines.reduce((s, l) => s + l.line_total, 0));
  const lineDiscountTotal = round2(
    activeLines.reduce((s, l) => {
      const { lineDiscount } = computeLineAmounts(l);
      return s + lineDiscount;
    }, 0)
  );

  const orderDiscountPctAmt = round2(subtotal * (orderDiscountPct / 100));
  const orderDiscount = round2(orderDiscountPctAmt + orderDiscountFixed);
  const afterOrderDiscount = Math.max(0, round2(subtotal - orderDiscount));

  const surchargeAmount = round2(afterOrderDiscount * (surchargePct / 100));
  const taxableBase = round2(afterOrderDiscount + surchargeAmount);

  // Re-compute VAT on the proportional residual amounts (surcharge follows the
  // blended VAT rate of the order, since it isn't tied to any single line's rate)
  const blendedVatRate = subtotal > 0
    ? activeLines.reduce((s, l) => {
        const { lineNet } = computeLineAmounts(l);
        return s + (lineNet / subtotal) * l.vat_rate;
      }, 0)
    : 0;

  const vatAmount = round2(
    activeLines.reduce((s, l) => {
      const { lineNet } = computeLineAmounts(l);
      const proportion = subtotal > 0 ? lineNet / subtotal : 0;
      const allocatedNet = round2(afterOrderDiscount * proportion);
      return s + round2(allocatedNet * (l.vat_rate / 100));
    }, 0) + round2(surchargeAmount * (blendedVatRate / 100))
  );

  const total = round2(taxableBase + vatAmount);
  const discountAmount = round2(lineDiscountTotal + orderDiscount);

  return {
    subtotal,
    orderDiscount,
    taxableAmount: taxableBase,
    vatAmount,
    surchargeAmount,
    total,
    discountAmount,
  };
}

// ── Apply order discount to a line (redistribute) ────────────────────────────

export function applyOrderDiscountToLine(
  line: OrderLine,
  orderDiscountPct: number,
  orderDiscountFixed: number,
  subtotal: number
): OrderLine {
  // Order discount is applied proportionally when computing totals,
  // so individual lines keep their own amounts. The engine applies it at the order level.
  return line;
}

// ── Line operations ───────────────────────────────────────────────────────────

/** Create a new order line from a product */
export function createLine(
  product: Product,
  priceLevel: number,
  qty = 1,
  timedPriceOverrides: Map<string, number> = new Map()
): OrderLine {
  const timedPrice = timedPriceOverrides.get(product.server_id) ?? null;
  const productWithTimed = { ...product, timed_price: timedPrice };
  const unitPrice = getPriceForLevel(productWithTimed, priceLevel);
  const lineId = crypto.randomUUID();
  const orderId = "";

  const partial: Omit<OrderLine, "line_total" | "vat_amount"> = {
    id: lineId,
    order_id: orderId,
    product_id: product.server_id,
    description: product.name,
    sku: product.sku,
    qty,
    unit_price: unitPrice,
    override_price: timedPrice ?? undefined,
    line_discount_pct: 0,
    line_discount_fixed: 0,
    vat_rate: product.vat_rate,
    voided: false,
  };

  const { lineTotal, vatAmount } = computeLineAmounts(partial);
  return { ...partial, line_total: lineTotal, vat_amount: vatAmount };
}

/** Update a line's quantity and recompute */
export function setLineQty(line: OrderLine, qty: number): OrderLine {
  const updated = { ...line, qty };
  const { lineTotal, vatAmount } = computeLineAmounts(updated);
  return { ...updated, line_total: lineTotal, vat_amount: vatAmount };
}

/** Override a line's price and recompute */
export function setLinePriceOverride(line: OrderLine, price: number): OrderLine {
  const updated = { ...line, override_price: price };
  const { lineTotal, vatAmount } = computeLineAmounts(updated);
  return { ...updated, line_total: lineTotal, vat_amount: vatAmount };
}

/** Apply line % discount and recompute */
export function setLineDiscountPct(line: OrderLine, pct: number): OrderLine {
  const updated = { ...line, line_discount_pct: pct };
  const { lineTotal, vatAmount } = computeLineAmounts(updated);
  return { ...updated, line_total: lineTotal, vat_amount: vatAmount };
}

/** Apply line fixed discount and recompute */
export function setLineDiscountFixed(line: OrderLine, fixed: number): OrderLine {
  const updated = { ...line, line_discount_fixed: fixed };
  const { lineTotal, vatAmount } = computeLineAmounts(updated);
  return { ...updated, line_total: lineTotal, vat_amount: vatAmount };
}

/** Remove all discounts from a line */
export function removeLineDiscount(line: OrderLine): OrderLine {
  const updated = {
    ...line,
    override_price: undefined,
    line_discount_pct: 0,
    line_discount_fixed: 0,
  };
  const { lineTotal, vatAmount } = computeLineAmounts(updated);
  return { ...updated, line_total: lineTotal, vat_amount: vatAmount };
}

/** Override a line's VAT rate and recompute */
export function setLineTaxOverride(line: OrderLine, vatRate: number): OrderLine {
  const updated = { ...line, vat_rate: vatRate };
  const { lineTotal, vatAmount } = computeLineAmounts(updated);
  return { ...updated, line_total: lineTotal, vat_amount: vatAmount };
}

// ── Promo code (simple table-driven) ─────────────────────────────────────────

/** Resolve a promo code from the locally-known codes.
 *  In Phase 3, this will call the server with a fallback rule. */
export interface PromoResult {
  valid: boolean;
  type: "pct" | "fixed";
  value: number;
  label: string;
}

export function resolvePromoCode(code: string): PromoResult {
  // Demo codes — replace with server lookup in production
  const codes: Record<string, PromoResult> = {
    SAVE10: { valid: true, type: "pct", value: 10, label: "10% off order" },
    EURO5: { valid: true, type: "fixed", value: 5, label: "€5 off order" },
    HAPPY20: { valid: true, type: "pct", value: 20, label: "20% off order" },
  };
  return codes[code.toUpperCase()] ?? { valid: false, type: "pct", value: 0, label: "Invalid code" };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatCurrency(n: number, symbol = "€"): string {
  return `${symbol}${n.toFixed(2)}`;
}
