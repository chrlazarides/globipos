/**
 * Core order engine — all 15 order management functions + 11 pricing functions.
 * Uses React state for the active order; persists to SQLite via Tauri commands.
 */
import { useState, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Order, OrderLine, Product, NumpadMode } from "../types";
import {
  createLine,
  setLineQty,
  setLinePriceOverride,
  setLineDiscountPct,
  setLineDiscountFixed,
  removeLineDiscount,
  setLineTaxOverride,
  computeOrderTotals,
  getPriceForLevel,
  resolvePromoCode,
  computeLineAmounts,
} from "../lib/pricing";
import { saveOrder, nextOrderNumber, writeAudit } from "../lib/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseOrderReturn {
  order: Order;
  lines: OrderLine[];
  selectedLineId: string | null;
  numpadMode: NumpadMode;
  lastLineId: string | null;

  // Order management (#1–15)
  addProduct: (product: Product, qty?: number, overridePrice?: number) => void;
  addQty: () => void;                     // #2 +1 to selected line
  subtractQty: () => void;                // #3 -1 from selected line
  setQty: (qty: number) => void;          // #4 set qty on selected line
  removeLine: () => void;                 // #5 remove selected line
  voidLine: () => void;                   // #6 void selected line (keep display)
  clearOrder: () => void;                 // #7 wipe entire order
  holdOrder: () => Promise<void>;         // #8 save as held, start new
  recallOrder: (held: Order, heldLines: OrderLine[]) => void; // #9
  addLineNote: (note: string) => void;    // #10
  addOrderNote: (note: string) => void;   // #11
  repeatLastItem: () => void;             // #12
  priceCheck: (product: Product) => number; // #13 (returns price, no add)
  voidOrder: () => Promise<void>;         // #14
  selectLine: (id: string | null) => void;
  setCustomer: (customerId: string) => void; // #15

  // Pricing/discount functions (#16–26)
  setPriceOverride: (price: number) => void;    // #16
  setLinePct: (pct: number) => void;            // #17
  setLineFixed: (fixed: number) => void;        // #18
  setOrderPct: (pct: number) => void;           // #19
  setOrderFixed: (fixed: number) => void;       // #20
  applyPromoCode: (code: string) => { success: boolean; message: string }; // #21
  applyManualPromo: (type: "pct" | "fixed", value: number) => void; // #22
  switchPriceLevel: (level: number) => void;    // #23
  removeDiscount: () => void;                   // #24
  setTaxOverride: (vatRate: number) => void;    // #25
  applyTimedPrices: (overrides: Map<string, number>) => void; // #26

  // Payment
  completeOrder: (
    paymentMethod: string,
    amountTendered: number,
    cashierId: string,
    cashierName: string,
    paymentRef?: string
  ) => Promise<Order>;

  // Numpad mode
  setNumpadMode: (mode: NumpadMode) => void;
}

function makeEmptyOrder(cashierId: string, cashierName: string): Order {
  return {
    id: uuidv4(),
    order_number: "",
    status: "active",
    cashier_id: cashierId,
    cashier_name: cashierName,
    price_level: 1,
    order_discount_pct: 0,
    order_discount_fixed: 0,
    subtotal: 0,
    discount_amount: 0,
    vat_amount: 0,
    total: 0,
    created_at: new Date().toISOString(),
  };
}

function rebuildOrderTotals(order: Order, lines: OrderLine[]): Order {
  const totals = computeOrderTotals(lines, order.order_discount_pct, order.order_discount_fixed);
  return {
    ...order,
    subtotal: totals.subtotal,
    discount_amount: totals.discountAmount,
    vat_amount: totals.vatAmount,
    total: totals.total,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useOrder(cashierId: string, cashierName: string, terminalPrefix = "POS"): UseOrderReturn {
  const [order, setOrder] = useState<Order>(() => makeEmptyOrder(cashierId, cashierName));
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [numpadMode, setNumpadMode] = useState<NumpadMode>("qty");
  const [lastLineId, setLastLineId] = useState<string | null>(null);
  const timedPricesRef = useRef<Map<string, number>>(new Map());

  // Helper: update lines and rebuild order totals
  const updateLines = useCallback((newLines: OrderLine[]) => {
    setLines(newLines);
    setOrder((prev) => rebuildOrderTotals(prev, newLines));
  }, []);

  const selectedLine = lines.find((l) => l.id === selectedLineId) ?? null;

  // ── #1 Add product ──────────────────────────────────────────────────────────
  const addProduct = useCallback((product: Product, qty = 1, overridePrice?: number) => {
    let line = createLine(product, order.price_level, qty, timedPricesRef.current);
    // Apply scale-barcode embedded price (or any caller-supplied override)
    if (overridePrice != null && overridePrice > 0) {
      line = setLinePriceOverride(line, overridePrice);
    }
    const newLine = { ...line, order_id: order.id };
    const newLines = [...lines, newLine];
    updateLines(newLines);
    setSelectedLineId(newLine.id);
    setLastLineId(newLine.id);
  }, [lines, order.id, order.price_level, updateLines]);

  // ── #2 Add qty ──────────────────────────────────────────────────────────────
  const addQty = useCallback(() => {
    if (!selectedLine) return;
    const newLines = lines.map((l) =>
      l.id === selectedLine.id ? setLineQty(l, l.qty + 1) : l
    );
    updateLines(newLines);
  }, [lines, selectedLine, updateLines]);

  // ── #3 Subtract qty ─────────────────────────────────────────────────────────
  const subtractQty = useCallback(() => {
    if (!selectedLine) return;
    if (selectedLine.qty <= 1) return;
    const newLines = lines.map((l) =>
      l.id === selectedLine.id ? setLineQty(l, l.qty - 1) : l
    );
    updateLines(newLines);
  }, [lines, selectedLine, updateLines]);

  // ── #4 Set qty ──────────────────────────────────────────────────────────────
  const setQty = useCallback((qty: number) => {
    if (!selectedLine || qty <= 0) return;
    const newLines = lines.map((l) =>
      l.id === selectedLine.id ? setLineQty(l, qty) : l
    );
    updateLines(newLines);
  }, [lines, selectedLine, updateLines]);

  // ── #5 Remove line ──────────────────────────────────────────────────────────
  const removeLine = useCallback(() => {
    if (!selectedLine) return;
    const newLines = lines.filter((l) => l.id !== selectedLine.id);
    updateLines(newLines);
    setSelectedLineId(newLines.length > 0 ? newLines[newLines.length - 1].id : null);
  }, [lines, selectedLine, updateLines]);

  // ── #6 Void line ────────────────────────────────────────────────────────────
  const voidLine = useCallback(() => {
    if (!selectedLine) return;
    const newLines = lines.map((l) =>
      l.id === selectedLine.id ? { ...l, voided: true } : l
    );
    updateLines(newLines);
    writeAudit("void_line", "order_line", selectedLine.id, selectedLine.description, cashierId, cashierName);
  }, [lines, selectedLine, updateLines, cashierId, cashierName]);

  // ── #7 Clear order ──────────────────────────────────────────────────────────
  const clearOrder = useCallback(() => {
    setLines([]);
    setOrder(makeEmptyOrder(cashierId, cashierName));
    setSelectedLineId(null);
    setLastLineId(null);
  }, [cashierId, cashierName]);

  // ── #8 Hold order ───────────────────────────────────────────────────────────
  const holdOrder = useCallback(async () => {
    if (lines.length === 0) return;
    const orderNum = await nextOrderNumber(`${terminalPrefix}-H`);
    const heldOrder: Order = { ...order, order_number: orderNum, status: "held" };
    await saveOrder(heldOrder, lines);
    writeAudit("hold_order", "order", heldOrder.id, `Held order ${orderNum}`, cashierId, cashierName);
    clearOrder();
  }, [order, lines, cashierId, cashierName, terminalPrefix, clearOrder]);

  // ── #9 Recall held order ────────────────────────────────────────────────────
  const recallOrder = useCallback((held: Order, heldLines: OrderLine[]) => {
    const recalled: Order = { ...held, status: "active", id: uuidv4() };
    setOrder(recalled);
    setLines(heldLines.map((l) => ({ ...l, order_id: recalled.id })));
    setSelectedLineId(null);
    writeAudit("recall_order", "order", held.id, `Recalled order ${held.order_number}`, cashierId, cashierName);
  }, [cashierId, cashierName]);

  // ── #10 Add line note ───────────────────────────────────────────────────────
  const addLineNote = useCallback((note: string) => {
    if (!selectedLine) return;
    const newLines = lines.map((l) =>
      l.id === selectedLine.id ? { ...l, note } : l
    );
    setLines(newLines);
  }, [lines, selectedLine]);

  // ── #11 Add order note ──────────────────────────────────────────────────────
  const addOrderNote = useCallback((note: string) => {
    setOrder((prev) => ({ ...prev, note }));
  }, []);

  // ── #12 Repeat last item ────────────────────────────────────────────────────
  const repeatLastItem = useCallback(() => {
    if (!lastLineId) return;
    const last = lines.find((l) => l.id === lastLineId);
    if (!last) return;
    const newLine: OrderLine = { ...last, id: uuidv4(), order_id: order.id, voided: false, note: undefined };
    const newLines = [...lines, newLine];
    updateLines(newLines);
    setSelectedLineId(newLine.id);
    setLastLineId(newLine.id);
  }, [lastLineId, lines, order.id, updateLines]);

  // ── #13 Price check ─────────────────────────────────────────────────────────
  const priceCheck = useCallback((product: Product): number => {
    return getPriceForLevel(product, order.price_level);
  }, [order.price_level]);

  // ── #14 Void order ──────────────────────────────────────────────────────────
  const voidOrder = useCallback(async () => {
    const orderNum = await nextOrderNumber(`${terminalPrefix}-V`);
    const voidedOrder: Order = { ...order, order_number: orderNum, status: "voided" };
    await saveOrder(voidedOrder, lines);
    writeAudit("void_order", "order", voidedOrder.id, `Voided order ${orderNum}`, cashierId, cashierName);
    clearOrder();
  }, [order, lines, cashierId, cashierName, terminalPrefix, clearOrder]);

  // ── #15 Set customer ────────────────────────────────────────────────────────
  const setCustomer = useCallback((customerId: string) => {
    setOrder((prev) => ({ ...prev, customer_id: customerId }));
  }, []);

  // ── #16 Line price override ─────────────────────────────────────────────────
  const setPriceOverride = useCallback((price: number) => {
    if (!selectedLine) return;
    const newLines = lines.map((l) =>
      l.id === selectedLine.id ? setLinePriceOverride(l, price) : l
    );
    updateLines(newLines);
    writeAudit("price_override", "order_line", selectedLine.id, `Override to €${price}`, cashierId, cashierName);
  }, [lines, selectedLine, updateLines, cashierId, cashierName]);

  // ── #17 Line % discount ─────────────────────────────────────────────────────
  const setLinePct = useCallback((pct: number) => {
    if (!selectedLine) return;
    const newLines = lines.map((l) =>
      l.id === selectedLine.id ? setLineDiscountPct(l, pct) : l
    );
    updateLines(newLines);
  }, [lines, selectedLine, updateLines]);

  // ── #18 Line fixed discount ─────────────────────────────────────────────────
  const setLineFixed = useCallback((fixed: number) => {
    if (!selectedLine) return;
    const newLines = lines.map((l) =>
      l.id === selectedLine.id ? setLineDiscountFixed(l, fixed) : l
    );
    updateLines(newLines);
  }, [lines, selectedLine, updateLines]);

  // ── #19 Order % discount ────────────────────────────────────────────────────
  const setOrderPct = useCallback((pct: number) => {
    setOrder((prev) => {
      const updated = { ...prev, order_discount_pct: pct };
      return rebuildOrderTotals(updated, lines);
    });
  }, [lines]);

  // ── #20 Order fixed discount ────────────────────────────────────────────────
  const setOrderFixed = useCallback((fixed: number) => {
    setOrder((prev) => {
      const updated = { ...prev, order_discount_fixed: fixed };
      return rebuildOrderTotals(updated, lines);
    });
  }, [lines]);

  // ── #21 Promo code ──────────────────────────────────────────────────────────
  const applyPromoCode = useCallback((code: string): { success: boolean; message: string } => {
    const result = resolvePromoCode(code);
    if (!result.valid) return { success: false, message: `Invalid promo code: ${code}` };
    if (result.type === "pct") {
      setOrder((prev) => rebuildOrderTotals({ ...prev, order_discount_pct: result.value }, lines));
    } else {
      setOrder((prev) => rebuildOrderTotals({ ...prev, order_discount_fixed: result.value }, lines));
    }
    writeAudit("promo_code", "order", order.id, `Applied ${code}: ${result.label}`, cashierId, cashierName);
    return { success: true, message: result.label };
  }, [order.id, lines, cashierId, cashierName]);

  // ── #22 Manual promotion ────────────────────────────────────────────────────
  const applyManualPromo = useCallback((type: "pct" | "fixed", value: number) => {
    if (type === "pct") setOrder((p) => rebuildOrderTotals({ ...p, order_discount_pct: value }, lines));
    else setOrder((p) => rebuildOrderTotals({ ...p, order_discount_fixed: value }, lines));
    writeAudit("manual_promo", "order", order.id, `Manual promo: ${type} ${value}`, cashierId, cashierName);
  }, [order.id, lines, cashierId, cashierName]);

  // ── #23 Switch price level ──────────────────────────────────────────────────
  const switchPriceLevel = useCallback((level: number) => {
    setOrder((prev) => ({ ...prev, price_level: level }));
    // Recompute all line unit prices for the new level
    // (in practice we'd need product catalog; lines keep their last computed price)
    writeAudit("price_level", "order", order.id, `Switched to level ${level}`, cashierId, cashierName);
  }, [order.id, cashierId, cashierName]);

  // ── #24 Remove discount ─────────────────────────────────────────────────────
  const removeDiscount = useCallback(() => {
    if (selectedLine) {
      const newLines = lines.map((l) =>
        l.id === selectedLine.id ? removeLineDiscount(l) : l
      );
      updateLines(newLines);
    } else {
      // Remove order-level discount
      setOrder((prev) =>
        rebuildOrderTotals({ ...prev, order_discount_pct: 0, order_discount_fixed: 0 }, lines)
      );
    }
  }, [lines, selectedLine, updateLines]);

  // ── #25 Tax override ────────────────────────────────────────────────────────
  const setTaxOverride = useCallback((vatRate: number) => {
    if (!selectedLine) return;
    const newLines = lines.map((l) =>
      l.id === selectedLine.id ? setLineTaxOverride(l, vatRate) : l
    );
    updateLines(newLines);
    writeAudit("tax_override", "order_line", selectedLine.id, `VAT set to ${vatRate}%`, cashierId, cashierName);
  }, [lines, selectedLine, updateLines, cashierId, cashierName]);

  // ── #26 Apply timed prices from inbox ───────────────────────────────────────
  const applyTimedPrices = useCallback((overrides: Map<string, number>) => {
    timedPricesRef.current = overrides;
    // Recompute lines that have an active timed price
    const newLines = lines.map((l) => {
      if (!l.product_id) return l;
      const timedPrice = overrides.get(l.product_id);
      if (timedPrice == null) return l;
      return setLinePriceOverride(l, timedPrice);
    });
    updateLines(newLines);
  }, [lines, updateLines]);

  // ── Complete order ──────────────────────────────────────────────────────────
  const completeOrder = useCallback(
    async (
      paymentMethod: string,
      amountTendered: number,
      cId: string,
      cName: string,
      paymentRef?: string
    ): Promise<Order> => {
      const orderNum = await nextOrderNumber(terminalPrefix);
      const changeDue = Math.max(0, amountTendered - order.total);
      const completed: Order = {
        ...order,
        order_number: orderNum,
        status: "completed",
        payment_method: paymentMethod,
        amount_tendered: amountTendered,
        change_due: changeDue,
        payment_ref: paymentRef,
        cashier_id: cId,
        cashier_name: cName,
      };
      await saveOrder(completed, lines);
      writeAudit("complete_order", "order", completed.id, `Order ${orderNum} — €${completed.total}`, cId, cName);
      clearOrder();
      return completed;
    },
    [order, lines, terminalPrefix, clearOrder]
  );

  return {
    order,
    lines,
    selectedLineId,
    numpadMode,
    lastLineId,
    addProduct,
    addQty,
    subtractQty,
    setQty,
    removeLine,
    voidLine,
    clearOrder,
    holdOrder,
    recallOrder,
    addLineNote,
    addOrderNote,
    repeatLastItem,
    priceCheck,
    voidOrder,
    selectLine: setSelectedLineId,
    setCustomer,
    setPriceOverride,
    setLinePct,
    setLineFixed,
    setOrderPct,
    setOrderFixed,
    applyPromoCode,
    applyManualPromo,
    switchPriceLevel,
    removeDiscount,
    setTaxOverride,
    applyTimedPrices,
    completeOrder,
    setNumpadMode,
  };
}
