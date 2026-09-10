import type { PrintReceiptLine } from "../hooks/useHardware";
import type { Order, OrderLine, ReceiptConfig } from "../types";

export interface ReceiptSaleContext {
  terminalCode: string;
  cashierName: string;
  order: Order;
  lines: OrderLine[];
  paymentMethod: string;
  paymentRef?: string;
  totalTendered?: number;
  changeDue?: number;
  language?: "en" | "el";
  currency: (value: number) => string;
  width?: number;
}

type Labels = {
  terminal: string; cashier: string; order: string; date: string; description: string;
  amount: string; subtotal: string; vat: string; total: string; items: string;
  payment: string; tendered: string; change: string; cardRef: string; rate: string;
  net: string; tax: string;
};

const LABELS: Record<"en" | "el", Labels> = {
  en: { terminal: "Terminal", cashier: "Cashier", order: "Receipt", date: "Date", description: "Description", amount: "Amount", subtotal: "Subtotal", vat: "VAT", total: "TOTAL", items: "Items", payment: "Payment", tendered: "Tendered", change: "Change", cardRef: "Card reference", rate: "Rate", net: "Net", tax: "VAT" },
  el: { terminal: "Ταμείο", cashier: "Ταμίας", order: "Απόδειξη", date: "Ημερομηνία", description: "Περιγραφή", amount: "Ποσό", subtotal: "Υποσύνολο", vat: "ΦΠΑ", total: "ΣΥΝΟΛΟ", items: "Είδη", payment: "Πληρωμή", tendered: "Δόθηκε", change: "Ρέστα", cardRef: "Αναφορά κάρτας", rate: "Συντελ.", net: "Καθαρά", tax: "ΦΠΑ" },
};

const divider = (width: number): PrintReceiptLine => ({ text: "-".repeat(width), divider: true });
const rightPair = (left: string, right: string, width: number) =>
  `${left.slice(0, Math.max(1, width - right.length - 1))}${" ".repeat(Math.max(1, width - left.length - right.length))}${right}`;

export function buildReceiptLines(config: ReceiptConfig, ctx: ReceiptSaleContext): PrintReceiptLine[] {
  const width = Math.max(24, Math.min(80, Math.round(ctx.width ?? 42)));
  const t = LABELS[ctx.language ?? "en"];
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const lines: PrintReceiptLine[] = [
    { text: clean(config.header_title) || ctx.terminalCode, align: "center", bold: true, size: "big" },
    ...config.header_lines.filter((line) => line.trim()).map((text) => ({ text: clean(text), align: "center" as const })),
    divider(width),
  ];
  const metadata = [
    config.show_terminal ? `${t.terminal}: ${ctx.terminalCode}` : "",
    config.show_cashier ? `${t.cashier}: ${ctx.cashierName}` : "",
  ].filter(Boolean);
  if (metadata.length) lines.push({ text: metadata.join("  ") });
  if (config.show_order_number || config.show_datetime) {
    lines.push({ text: [
      config.show_order_number ? `${t.order}: ${ctx.order.order_number}` : "",
      config.show_datetime ? `${t.date}: ${new Date(ctx.order.created_at).toLocaleString()}` : "",
    ].filter(Boolean).join("  ") });
  }
  lines.push(divider(width), { text: rightPair(t.description, t.amount, width), bold: true });

  const saleLines = ctx.lines.filter((line) => !line.voided);
  saleLines.forEach((line) => {
    const amount = ctx.currency(line.line_total);
    lines.push({ text: clean(line.description).slice(0, width) });
    lines.push({ text: rightPair(`  ${line.qty} x ${ctx.currency(line.unit_price)}`, amount, width) });
  });
  lines.push(divider(width));
  if (config.show_subtotal) lines.push({ text: rightPair(t.subtotal, ctx.currency(ctx.order.subtotal), width) });
  if (config.show_vat) {
    lines.push({ text: rightPair(t.vat, ctx.currency(ctx.order.vat_amount), width) });
    const vatGroups = new Map<number, { net: number; tax: number }>();
    saleLines.forEach((line) => {
      const current = vatGroups.get(line.vat_rate) ?? { net: 0, tax: 0 };
      current.tax += line.vat_amount;
      current.net += line.line_total - line.vat_amount;
      vatGroups.set(line.vat_rate, current);
    });
    vatGroups.forEach((group, rate) => {
      const label = `${t.rate} ${rate}%  ${t.net} ${ctx.currency(group.net)}`;
      lines.push({ text: rightPair(label, ctx.currency(group.tax), width) });
    });
  }
  lines.push({ text: rightPair(t.total, ctx.currency(ctx.order.total), width), bold: true, size: "big" });
  lines.push({ text: rightPair(t.items, String(saleLines.reduce((sum, line) => sum + line.qty, 0)), width) }, divider(width));
  if (config.show_payment_method) lines.push({ text: `${t.payment}: ${ctx.paymentMethod.replace("card_", "Card ").replace("_", " ").toUpperCase()}` });
  if (config.show_tendered_change && (ctx.totalTendered ?? 0) > 0) {
    lines.push({ text: rightPair(t.tendered, ctx.currency(ctx.totalTendered ?? 0), width) });
    lines.push({ text: rightPair(t.change, ctx.currency(ctx.changeDue ?? 0), width) });
  }
  if (config.show_card_ref && ctx.paymentRef) lines.push({ text: `${t.cardRef}: ${ctx.paymentRef}` });
  const footer = config.footer_lines.filter((line) => line.trim());
  if (footer.length) lines.push(divider(width), ...footer.map((text) => ({ text: clean(text), align: "center" as const })));
  return lines;
}