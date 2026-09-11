import type { OrderLine, Product } from "../types";

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function effectivePrice(product: Product, priceLevel: number): number {
  const level = Math.min(5, Math.max(1, Math.trunc(priceLevel || 1))) as 1 | 2 | 3 | 4 | 5;
  if (level === 1 && product.timed_price != null) return roundMoney(product.timed_price);
  return roundMoney(product[`price${level}`]);
}

export function calculateLine(line: OrderLine, quantity: number): OrderLine {
  const qty = Math.max(1, quantity);
  const lineTotal = roundMoney(qty * line.unit_price);
  const vatAmount = line.vat_rate > 0
    ? roundMoney(lineTotal - lineTotal / (1 + line.vat_rate / 100))
    : 0;
  return { ...line, qty, line_total: lineTotal, vat_amount: vatAmount };
}

export function createOrderLine(product: Product, priceLevel: number, id: string): OrderLine {
  const unitPrice = effectivePrice(product, priceLevel);
  return calculateLine({
    id,
    order_id: "",
    product_id: product.id,
    description: product.name,
    sku: product.sku,
    qty: 1,
    unit_price: unitPrice,
    line_discount_pct: 0,
    line_discount_fixed: 0,
    line_surcharge_pct: 0,
    vat_rate: product.vat_rate,
    line_total: 0,
    vat_amount: 0,
    voided: false,
  }, 1);
}

export function parseValidCashTender(value: string, total: number): number | null {
  if (!value.trim()) return null;
  const tender = Number(value);
  if (!Number.isFinite(tender) || tender < 0 || tender < total) return null;
  return roundMoney(tender);
}

export function createOrderNumber(terminalCode: string, now: number, nonce: string): string {
  const terminal = terminalCode.replace(/[^A-Za-z0-9_-]/g, "").toUpperCase() || "TERMINAL";
  const uniquePart = nonce.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  return `POS-${terminal}-${now}-${uniquePart}`;
}