import { createHash } from "node:crypto";

export class PosInvoiceError extends Error {
  constructor(message: string, public status = 409, public code = "INVOICE_REJECTED") { super(message); }
}

export const money = (cents: number) => (cents / 100).toFixed(2);
export function cents(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new PosInvoiceError("Invalid monetary value.", 400, "INVALID_AMOUNT");
  return Math.round(amount * 100);
}
export function localDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Nicosia", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function dueDate(date: string, terms: string): string {
  const days = /^credit_(\d+)$/.exec(terms)?.[1] || "0";
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + Number(days));
  return result.toISOString().slice(0, 10);
}
export function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function creditBalance(customer: any, documents: any[], payments: any[], today = localDate()) {
  const posted = documents.filter(inv => !["draft", "voided", "cancelled", "canceled"].includes(inv.status));
  const invoiceIds = new Set(documents.map(inv => inv.id));
  const applied = new Map<string, number>();
  let unallocated = 0;
  for (const payment of payments) {
    if (payment.invoiceId && invoiceIds.has(payment.invoiceId)) {
      applied.set(payment.invoiceId, (applied.get(payment.invoiceId) || 0) + cents(payment.amount));
    } else if (!payment.invoiceId) unallocated += cents(payment.amount);
  }
  let credits = posted.filter(inv => inv.type === "credit_note").reduce((sum, inv) => sum + cents(inv.total), unallocated);
  let opening = cents(customer.openingBalance || 0);
  if (opening < 0) { credits -= opening; opening = 0; }
  const openingCovered = Math.min(opening, Math.max(credits, 0));
  opening -= openingCovered; credits -= openingCovered;
  let debt = opening, overdue = 0;
  const invoices = posted.filter(inv => inv.type === "invoice")
    .sort((a, b) => String(a.dueDate || a.date).localeCompare(String(b.dueDate || b.date)) || a.id.localeCompare(b.id));
  for (const inv of invoices) {
    const paid = applied.get(inv.id) || 0;
    let remaining = Math.max(0, cents(inv.total) - (paid > 0 ? paid : inv.status === "paid" ? cents(inv.total) : 0));
    const covered = Math.min(remaining, Math.max(0, credits));
    remaining -= covered; credits -= covered;
    debt += remaining;
    if (inv.dueDate && inv.dueDate < today) overdue += remaining;
  }
  return { balanceCents: Math.max(0, debt), overdueCents: overdue, hasOverdue: overdue > 0 };
}
export function requireAvailableCredit(credit: any, totalCents: number) {
  if (credit.approvalStatus !== "approved") throw new PosInvoiceError("Customer credit is not approved or is suspended.", 403, "CREDIT_NOT_APPROVED");
  if (totalCents > credit.availableCents) throw new PosInvoiceError("This purchase exceeds the customer's available credit.", 409, "CREDIT_LIMIT_EXCEEDED");
  // Overdue debt is a warning only, as agreed; it never bypasses the limit.
}

export function priceInvoiceLine(item: any, variant: any, line: any, level: number, contracts: any[], rules: any[], fixed: any[], vatInclusive = false) {
  const packSize = Math.max(1, Number(item.packSize) || 1);
  const stockQuantity = Number(line.quantity) * (line.saleUnit === "pack" ? packSize : 1);
  if (!Number.isSafeInteger(stockQuantity) || stockQuantity <= 0) {
    throw new PosInvoiceError("Stock items require whole-unit quantities.", 400, "INVALID_QUANTITY");
  }
  const fallback = variant?.price1 ?? item.price1;
  const base = Number(variant?.[`price${level}`] ?? item[`price${level}`] ?? fallback);
  let effective = base;
  const activeIds = new Set(contracts.map(c => c.id));
  const specific = fixed.find(row => activeIds.has(row.contractId) && row.itemId === item.id && Number(row.specialPrice) > 0);
  if (specific) effective = Number(specific.specialPrice);
  else {
    const matches = (row: any) => {
      const categories = row.categoryIds?.length ? row.categoryIds : row.categoryId ? [row.categoryId] : [];
      const brands = row.brands?.length ? row.brands : row.brand ? [row.brand] : [];
      return (!categories.length || categories.includes(item.categoryId)) &&
        (!brands.length || brands.includes(item.brand)) && Number(line.quantity) >= Number(row.minQuantity || 0);
    };
    for (const contract of contracts) {
      if (!matches(contract)) continue;
      const applicable = rules.filter(row => row.contractId === contract.id);
      for (const rule of applicable.length ? applicable : [contract]) {
        if (!matches(rule)) continue;
        const amount = Number(rule.discountValue || 0);
        if (amount <= 0) continue;
        // Existing invoicing compares contracts against the standard price, not
        // cumulatively against an already-discounted customer price.
        const retail = Number(variant?.price1 ?? item.price1);
        const discounted = rule.discountType === "percentage" ? retail * (1 - amount / 100) : retail - amount;
        effective = Math.min(effective, Math.max(0, discounted));
      }
    }
  }
  // Catalog prices are per sale unit in existing invoices; pack quantities
  // change inventory units, not the catalog price.
  if (!Number.isFinite(effective) || effective < 0) throw new PosInvoiceError("The item price is invalid.");
  const vatRate = Number(item.vatRate || 0);
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) throw new PosInvoiceError("The item VAT rate is invalid.");
  const catalogUnitPrice = cents(effective) / 100;
  const catalogTotalCents = Math.round(catalogUnitPrice * Number(line.quantity) * 100);
  const vatCents = vatInclusive
    ? Math.round(catalogTotalCents - catalogTotalCents / (1 + vatRate / 100))
    : Math.round(catalogTotalCents * vatRate / 100);
  const totalCents = vatInclusive ? catalogTotalCents - vatCents : catalogTotalCents;
  const unitPrice = vatInclusive ? catalogUnitPrice / (1 + vatRate / 100) : catalogUnitPrice;
  return {
    itemId: item.id, variantId: variant?.id || null,
    description: variant ? `${item.name} (${[variant.option1Value, variant.option2Value, variant.option3Value].filter(Boolean).join(" / ")})` : item.name,
    quantity: Number(line.quantity), saleUnit: line.saleUnit || "pc", unitPrice, discountPercent: 0,
    totalCents, vatCents, vatRate, stockQuantity,
    costCents: Math.round(Number(item.costPrice || 0) / packSize * stockQuantity * 100),
  };
}