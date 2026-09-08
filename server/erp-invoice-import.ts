import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { accounts, invoiceItems, invoices, items, journalEntries, journalEntryLines } from "@shared/schema";

export function erpInvoiceJournalLines(total: number, tax: number, totalCost: number) {
  const net = total - tax;
  return [
    { code: "1100", debit: total, credit: 0, description: "Accounts Receivable" },
    { code: "4000", debit: 0, credit: net, description: "Sales Revenue" },
    ...(tax ? [{ code: "2100", debit: 0, credit: tax, description: "VAT Payable" }] : []),
    ...(totalCost ? [{ code: "5000", debit: totalCost, credit: 0, description: "Cost of Goods Sold" }, { code: "1200", debit: 0, credit: totalCost, description: "Inventory" }] : []),
  ];
}
export function invoiceInventoryDelta(adjustInventory: boolean, oldQuantity: number, newQuantity: number) {
  return adjustInventory ? oldQuantity - newQuantity : 0;
}
export function accountBalanceAfterJournalLine(balance: number, accountType: string, debit: number, credit: number, direction: "apply" | "reverse" = "apply") {
  const normalImpact = accountType === "asset" || accountType === "expense" ? debit - credit : credit - debit;
  return balance + normalImpact * (direction === "apply" ? 1 : -1);
}

/** Applies an ERP posted invoice as one atomic business operation. */
export async function importErpPostedInvoice(header: any, lines: any[], existingId?: string, after?: (invoice: any, tx: any) => Promise<void>, adjustInventory = true) {
  return db.transaction(async tx => {
    const itemPlans: Array<{ line: any; item: typeof items.$inferSelect; quantity: number }> = [];
    let totalCost = 0;
    for (const line of lines) if (line.itemId) {
      const [item] = await tx.select().from(items).where(eq(items.id, line.itemId)).limit(1);
      if (!item) throw new Error("DEPENDENCY");
      const quantity = Number(line.quantity) * (line.saleUnit === "pack" ? item.packSize || 1 : 1);
      totalCost += Number(item.costPrice) / (item.packSize || 1) * quantity;
      itemPlans.push({ line, item, quantity });
    }
    const total = Number(header.total), tax = Number(header.taxAmount);
    const needed = ["1100", "4000", ...(tax ? ["2100"] : []), ...(totalCost ? ["5000", "1200"] : [])];
    const accountRows = await tx.select().from(accounts);
    const accountByCode = Object.fromEntries(accountRows.map(row => [row.code, row])) as Record<string, typeof accounts.$inferSelect>;
    const accountById = new Map(accountRows.map(row => [row.id, row]));
    if (needed.some(code => !accountByCode[code]?.active)) throw new Error("ACCOUNTING_SETUP_REQUIRED");
    const oldEntries = existingId ? await tx.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.sourceType, "invoice"), eq(journalEntries.sourceId, existingId))) : [];
    const oldJournalLines = oldEntries.length ? await tx.select().from(journalEntryLines).where(inArray(journalEntryLines.journalEntryId, oldEntries.map(entry => entry.id))) : [];
    if (oldJournalLines.some(line => !accountById.has(line.accountId))) throw new Error("ACCOUNTING_SETUP_REQUIRED");
    const balances = new Map(accountRows.map(row => [row.id, Number(row.balance)]));
    const changeBalance = async (account: typeof accounts.$inferSelect, debit: number, credit: number, direction: "apply" | "reverse") => {
      const next = accountBalanceAfterJournalLine(balances.get(account.id) ?? Number(account.balance), account.type, debit, credit, direction);
      balances.set(account.id, next);
      await tx.update(accounts).set({ balance: next.toFixed(2) }).where(eq(accounts.id, account.id));
    };
    let invoice: any;
    if (existingId) {
      const oldLines = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, existingId));
      for (const line of oldLines) if (adjustInventory && line.itemId) {
        await tx.update(items).set({ stockQuantity: sql`${items.stockQuantity} + ${Number(line.quantity)}` }).where(eq(items.id, line.itemId));
      }
      await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, existingId));
      [invoice] = await tx.update(invoices).set(header).where(eq(invoices.id, existingId)).returning();
    } else {
      [invoice] = await tx.insert(invoices).values(header).returning();
    }
    if (!invoice) throw new Error("UPSERT");
    if (lines.length) await tx.insert(invoiceItems).values(lines.map(line => ({ ...line, invoiceId: invoice.id })));
    for (const plan of itemPlans) {
      if (adjustInventory) await tx.update(items).set({ stockQuantity: sql`${items.stockQuantity} - ${plan.quantity}` }).where(eq(items.id, plan.item.id));
    }
    for (const line of oldJournalLines) await changeBalance(accountById.get(line.accountId)!, Number(line.debit), Number(line.credit), "reverse");
    for (const entry of oldEntries) await tx.delete(journalEntryLines).where(eq(journalEntryLines.journalEntryId, entry.id));
    if (oldEntries.length) await tx.delete(journalEntries).where(and(eq(journalEntries.sourceType, "invoice"), eq(journalEntries.sourceId, invoice.id)));
    const journalLines = erpInvoiceJournalLines(total, tax, totalCost).map(line => ({ ...line, accountId: accountByCode[line.code].id }));
    const debit = journalLines.reduce((sum, line) => sum + line.debit, 0);
    const credit = journalLines.reduce((sum, line) => sum + line.credit, 0);
    if (Math.abs(debit - credit) > 0.01) throw new Error("ACCOUNTING_IMBALANCE");
    const [entry] = await tx.insert(journalEntries).values({
      entryNumber: `ERP-${invoice.id}`, date: invoice.date, description: `Sales Invoice ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber, sourceType: "invoice", sourceId: invoice.id, status: "posted", totalAmount: debit.toFixed(2),
    }).returning();
    await tx.insert(journalEntryLines).values(journalLines.map(line => ({ ...line, journalEntryId: entry.id, debit: line.debit.toFixed(2), credit: line.credit.toFixed(2) })));
    for (const line of journalLines) await changeBalance(accountById.get(line.accountId)!, line.debit, line.credit, "apply");
    await after?.(invoice, tx);
    return invoice;
  });
}