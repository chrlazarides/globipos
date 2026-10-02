import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, customers, invoices, invoiceItems, payments, items, itemVariants, priceContracts,
  priceContractRules, priceContractItems, posOrders, posOrderLines, posShifts,
  accounts, journalEntries, journalEntryLines, customerCreditProfiles, customerCreditHistory, posInvoiceSales,
} from "@workspace/db";
import { consumeLocationStockInTransaction } from "./inventory-reservations";
import { cents, money, localDate, dueDate, hash, creditBalance, priceInvoiceLine, requireAvailableCredit, PosInvoiceError } from "./pos-invoice-pricing";

export type InvoiceCart = {
  customerId: string; mode: "retail" | "wholesale";
  lines: { itemId: string; variantId?: string | null; quantity: number; saleUnit?: "pc" | "pack" }[];
};
export type InvoiceCheckout = InvoiceCart & {
  orderId: string; expectedTotalCents: number; quoteHash: string;
  paymentMethod: "cash" | "card" | "account_credit"; amountTenderedCents: number; cardReference?: string;
};
export const CREDIT_PERMISSION = "customer_credit_approve";

export async function getCustomerCredit(customerId: string, tx: any = db, lockedCustomer?: any) {
  const customer = lockedCustomer || (await tx.select().from(customers).where(eq(customers.id, customerId)))[0];
  if (!customer) throw new PosInvoiceError("Customer not found.", 404, "CUSTOMER_NOT_FOUND");
  const [profile] = await tx.select().from(customerCreditProfiles).where(eq(customerCreditProfiles.customerId, customerId));
  const documents = await tx.select().from(invoices).where(eq(invoices.customerId, customerId));
  const customerPayments = await tx.select().from(payments).where(sql`${payments.customerId} = ${customerId} OR ${payments.invoiceId} IN (SELECT id FROM invoices WHERE customer_id = ${customerId})`);
  const balance = creditBalance(customer, documents, customerPayments);
  const limitCents = Math.max(0, cents(customer.creditLimit));
  const approvalStatus = profile?.approvalStatus || "pending";
  return {
    approvalStatus, limitCents, ...balance,
    availableCents: approvalStatus === "approved" ? Math.max(0, limitCents - balance.balanceCents) : 0,
    paymentTerms: customer.paymentTerms,
  };
}

export async function saveCustomerCredit(customerId: string, data: { approvalStatus: string; creditLimit: string; paymentTerms: string; reason: string }, actor: { id: string; username: string }) {
  return db.transaction(async tx => {
    const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId)).for("update");
    if (!customer) throw new PosInvoiceError("Customer not found.", 404);
    const previous = await getCustomerCredit(customerId, tx, customer);
    const [updated] = await tx.update(customers).set({ creditLimit: data.creditLimit, paymentTerms: data.paymentTerms }).where(eq(customers.id, customerId)).returning();
    await tx.insert(customerCreditProfiles).values({
      customerId, approvalStatus: data.approvalStatus, updatedBy: actor.id, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: customerCreditProfiles.customerId,
      set: { approvalStatus: data.approvalStatus, updatedBy: actor.id, updatedAt: new Date() },
    });
    const next = await getCustomerCredit(customerId, tx, updated);
    await tx.insert(customerCreditHistory).values({ customerId, actorId: actor.id, actorName: actor.username, reason: data.reason, previous, next });
    return next;
  });
}

async function buildQuote(tx: any, cart: InvoiceCart, terminal: any, customer: any) {
  if (!customer?.active) throw new PosInvoiceError("Customer is inactive or missing.", 409, "CUSTOMER_UNAVAILABLE");
  const today = localDate();
  const contracts = cart.mode === "wholesale"
    ? await tx.select().from(priceContracts).where(and(
      eq(priceContracts.customerId, customer.id), eq(priceContracts.active, true),
      sql`${priceContracts.startDate} <= ${today} AND ${priceContracts.endDate} >= ${today}`,
    )).orderBy(priceContracts.id) : [];
  const ids = contracts.map((c: any) => c.id);
  const rules = ids.length ? await tx.select().from(priceContractRules).where(inArray(priceContractRules.contractId, ids)) : [];
  const fixed = ids.length ? await tx.select().from(priceContractItems).where(inArray(priceContractItems.contractId, ids)).orderBy(priceContractItems.id) : [];
  const level = Math.min(5, Math.max(1, Number(cart.mode === "wholesale" ? customer.priceLevel : terminal.priceLevel) || 1));
  const priced = [];
  // Aggregate duplicate item/variant/unit rows so quantity-based contracts see
  // the complete scanned quantity and cannot be manipulated by splitting rows.
  const grouped = new Map<string, InvoiceCart["lines"][number]>();
  for (const line of cart.lines) {
    const key = JSON.stringify([line.itemId, line.variantId || null, line.saleUnit || "pc"]);
    const old = grouped.get(key);
    grouped.set(key, { ...line, saleUnit: line.saleUnit || "pc", quantity: (old?.quantity || 0) + line.quantity });
  }
  for (const line of [...grouped.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))) {
    const [item] = await tx.select().from(items).where(eq(items.id, line.itemId));
    if (!item?.active) throw new PosInvoiceError("A selected item is inactive or missing.", 409, "ITEM_UNAVAILABLE");
    const variant = line.variantId ? (await tx.select().from(itemVariants).where(eq(itemVariants.id, line.variantId)))[0] : null;
    if (line.variantId && (!variant?.active || variant.itemId !== item.id)) throw new PosInvoiceError("Selected variant is unavailable.", 409, "VARIANT_UNAVAILABLE");
    if (item.hasVariants && !variant) throw new PosInvoiceError("Select the item's variant.", 400, "VARIANT_REQUIRED");
    if (!item.hasVariants && variant) throw new PosInvoiceError("This item does not have variants.", 400);
    // Retail POS prices include VAT; wholesale invoice prices exclude it.
    // Switching a loyalty purchase to account credit must not add VAT twice.
    priced.push(priceInvoiceLine(item, variant, line, level, contracts, rules, fixed, cart.mode === "retail"));
  }
  const subtotalCents = priced.reduce((sum, line) => sum + line.totalCents, 0);
  const vatCents = priced.reduce((sum, line) => sum + line.vatCents, 0);
  const totalCents = subtotalCents + vatCents;
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || totalCents > 100_000_000) throw new PosInvoiceError("The sale total is outside the supported range.", 400);
  const result = {
    customer: { id: customer.id, name: customer.name, code: customer.code },
    credit: await getCustomerCredit(customer.id, tx, customer),
    lines: priced, subtotalCents, vatCents, totalCents,
    quoteHash: hash({ customerId: customer.id, mode: cart.mode, level, lines: priced.map(({ costCents, ...line }) => line), subtotalCents, vatCents }),
  };
  return result;
}

export async function quotePosInvoice(cart: InvoiceCart, terminal: any) {
  return db.transaction(async tx => {
    const [customer] = await tx.select().from(customers).where(eq(customers.id, cart.customerId)).for("update");
    return buildQuote(tx, cart, terminal, customer);
  });
}

async function postJournal(tx: any, invoice: any, quote: any, method: string) {
  if (quote.totalCents === 0) return;
  const codes = ["1100", "4000", "2100"];
  if (method !== "account_credit") codes.push(method === "cash" ? "1000" : "1010");
  const costs = quote.lines.reduce((sum: number, line: any) => sum + line.costCents, 0);
  if (costs > 0) codes.push("5000", "1200");
  const ledger = await tx.select().from(accounts).where(inArray(accounts.code, codes));
  const accountMap = new Map(ledger.map((account: any) => [account.code, account.id]));
  if (codes.some(code => !accountMap.has(code))) throw new PosInvoiceError("Required sales accounts are missing. Configure the chart of accounts before invoicing.", 409, "ACCOUNTING_NOT_CONFIGURED");
  const lines = [
    { code: "1100", debit: quote.totalCents, credit: 0 },
    { code: "4000", debit: 0, credit: quote.subtotalCents },
    { code: "2100", debit: 0, credit: quote.vatCents },
    ...(costs > 0 ? [{ code: "5000", debit: costs, credit: 0 }, { code: "1200", debit: 0, credit: costs }] : []),
  ].filter(line => line.debit || line.credit);
  const [entry] = await tx.insert(journalEntries).values({
    entryNumber: `POS-${invoice.invoiceNumber}`, date: invoice.date, description: `POS ${invoice.invoiceNumber}`,
    reference: invoice.invoiceNumber, sourceType: "invoice", sourceId: invoice.id, status: "posted",
    totalAmount: money(quote.totalCents + costs),
  }).returning();
  await tx.insert(journalEntryLines).values(lines.map(line => ({
    journalEntryId: entry.id, accountId: accountMap.get(line.code), debit: money(line.debit), credit: money(line.credit), description: invoice.invoiceNumber,
  })));
  if (method !== "account_credit") {
    const [payment] = await tx.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    if (!payment) throw new PosInvoiceError("Invoice payment record is missing.", 500);
    const [collection] = await tx.insert(journalEntries).values({
      entryNumber: `POS-PAY-${invoice.invoiceNumber}`, date: invoice.date, description: `POS collection ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber, sourceType: "payment", sourceId: payment.id, status: "posted", totalAmount: money(quote.totalCents),
    }).returning();
    await tx.insert(journalEntryLines).values([
      { journalEntryId: collection.id, accountId: accountMap.get(method === "cash" ? "1000" : "1010"), debit: money(quote.totalCents), credit: "0", description: invoice.invoiceNumber },
      { journalEntryId: collection.id, accountId: accountMap.get("1100"), debit: "0", credit: money(quote.totalCents), description: invoice.invoiceNumber },
    ]);
    lines.push({ code: method === "cash" ? "1000" : "1010", debit: quote.totalCents, credit: 0 });
    lines.push({ code: "1100", debit: 0, credit: quote.totalCents });
  }
  // Match the existing ledger's account balances, using atomic arithmetic
  // rather than read/modify/write so concurrent tills cannot lose an update.
  for (const account of [...ledger].sort((a: any, b: any) => a.code.localeCompare(b.code))) {
    const delta = lines.filter(line => line.code === account.code).reduce((sum, line) => sum + line.debit - line.credit, 0) *
      (account.type === "asset" || account.type === "expense" ? 1 : -1);
    if (delta) await tx.update(accounts).set({ balance: sql`${accounts.balance} + ${money(delta)}::numeric` }).where(eq(accounts.id, account.id));
  }
}

export async function checkoutPosInvoice(input: InvoiceCheckout, terminal: any, cashier: any) {
  const { orderId, expectedTotalCents, quoteHash, paymentMethod, amountTenderedCents } = input;
  const requestKey = `${terminal.id}:${orderId}`;
  const requestHash = hash({ ...input, lines: input.lines.map(line => ({ ...line, variantId: line.variantId || null, saleUnit: line.saleUnit || "pc" })) });
  return db.transaction(async tx => {
    // A durable database lock and unique request key protect retries and
    // different requests reusing an ID, including requests after a restart.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${requestKey}))`);
    const [existing] = await tx.select().from(posInvoiceSales).where(eq(posInvoiceSales.requestKey, requestKey));
    if (existing) {
      if (existing.requestHash !== requestHash) throw new PosInvoiceError("This checkout ID was already used for a different purchase.", 409, "CHECKOUT_KEY_REUSED");
      const [order] = await tx.select().from(posOrders).where(eq(posOrders.id, existing.orderId));
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, existing.invoiceId));
      if (!order || !invoice || order.cashierId !== cashier.id) throw new PosInvoiceError("Checkout does not belong to this cashier.", 403);
      return checkoutResult(order, invoice, true, input.orderId);
    }
    // All POS credit checkouts and approval changes lock this same customer
    // row. Credit is recomputed inside this transaction, never from a quote.
    const [customer] = await tx.select().from(customers).where(eq(customers.id, input.customerId)).for("update");
    const quote = await buildQuote(tx, input, terminal, customer);
    if (quote.totalCents !== expectedTotalCents || quote.quoteHash !== quoteHash) throw new PosInvoiceError("Prices changed. Review a fresh quote before confirming.", 409, "PRICE_CHANGED");
    if (paymentMethod === "account_credit") requireAvailableCredit(quote.credit, quote.totalCents);
    if (paymentMethod === "cash" && amountTenderedCents < quote.totalCents) throw new PosInvoiceError("Cash tender must cover the invoice total.", 400, "INSUFFICIENT_TENDER");
    if (paymentMethod !== "cash" && amountTenderedCents !== 0) throw new PosInvoiceError("Non-cash purchases cannot include a cash tender.", 400);
    if (paymentMethod === "card" && !input.cardReference?.trim()) throw new PosInvoiceError("An approved external card-payment reference is required.", 400);
    if (!terminal.locationId) throw new PosInvoiceError("Terminal has no inventory location.", 409);
    // Match the back-office lock order: customer, invoice numbering, stock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('invoice-number:invoice'))`);
    await consumeLocationStockInTransaction(tx, terminal.locationId, quote.lines.map(line => ({
      itemId: line.itemId, variantId: line.variantId, quantity: line.stockQuantity,
    })));
    const today = localDate();
    const sequence = await tx.execute(sql`SELECT COALESCE(MAX(CAST(NULLIF(SUBSTRING(invoice_number FROM '[0-9]+$'), '') AS INTEGER)), 0) + 1 AS n FROM invoices WHERE type = 'invoice'`);
    const invoiceNumber = `INV-${String(sequence.rows[0].n).padStart(5, "0")}`;
    const [invoice] = await tx.insert(invoices).values({
      invoiceNumber, type: "invoice", customerId: customer.id, date: today,
      dueDate: paymentMethod === "account_credit" ? dueDate(today, customer.paymentTerms) : today,
      subtotal: money(quote.subtotalCents), taxRate: "0", taxAmount: money(quote.vatCents), discountAmount: "0",
      total: money(quote.totalCents), status: paymentMethod === "account_credit" ? "sent" : "paid",
      inventoryLocationId: terminal.locationId, erpExternalRef: `POS-INVOICE:${requestKey}`,
      notes: `${input.mode === "wholesale" ? "Wholesale" : "Retail customer credit"} POS invoice. Cashier: ${cashier.name}. ${quote.credit.hasOverdue ? "Overdue account warning acknowledged." : ""}`,
    }).returning();
    await tx.insert(invoiceItems).values(quote.lines.map(line => ({
      invoiceId: invoice.id, itemId: line.itemId, variantId: line.variantId, description: line.description,
      quantity: String(line.quantity), saleUnit: line.saleUnit, unitPrice: line.unitPrice.toFixed(2),
      vatRate: line.vatRate.toFixed(2), discountPercent: "0", discount: "0", total: money(line.totalCents),
    })));
    const [shift] = await tx.select().from(posShifts).where(and(eq(posShifts.terminalId, terminal.id), eq(posShifts.status, "open"))).limit(1);
    const [order] = await tx.insert(posOrders).values({
      orderNumber: `POS-${invoiceNumber}`, terminalId: terminal.id, locationId: terminal.locationId,
      shiftId: shift?.id, customerId: customer.id, cashierId: cashier.id, cashierName: cashier.name,
      subtotal: money(quote.subtotalCents), vatAmount: money(quote.vatCents), discountAmount: "0",
      total: money(quote.totalCents), paymentMethod,
      amountTendered: money(paymentMethod === "cash" ? amountTenderedCents : paymentMethod === "card" ? quote.totalCents : 0),
      changeDue: money(paymentMethod === "cash" ? amountTenderedCents - quote.totalCents : 0),
      cardTerminalRef: input.cardReference || null, status: "completed", inventoryCommitted: true, syncedAt: new Date(),
      notes: `Invoice ${invoiceNumber}; ${input.mode}`,
    }).returning();
    if (shift) await tx.update(posShifts).set({
      totalSales: sql`${posShifts.totalSales} + ${money(quote.totalCents)}::numeric`,
      totalCash: sql`${posShifts.totalCash} + ${money(paymentMethod === "cash" ? quote.totalCents : 0)}::numeric`,
      totalCard: sql`${posShifts.totalCard} + ${money(paymentMethod === "card" ? quote.totalCents : 0)}::numeric`,
      transactionCount: sql`${posShifts.transactionCount} + 1`,
    }).where(eq(posShifts.id, shift.id));
    await tx.insert(posOrderLines).values(quote.lines.map(line => ({
      orderId: order.id, itemId: line.itemId, variantId: line.variantId, description: line.description,
      quantity: String(line.stockQuantity), unitPrice: money(Math.round(line.totalCents / line.stockQuantity)),
      vatRate: String(line.vatRate), discountPercent: "0", total: money(line.totalCents),
    })));
    if (paymentMethod !== "account_credit") await tx.insert(payments).values({
      invoiceId: invoice.id, customerId: customer.id, amount: money(quote.totalCents),
      paymentDate: today, paymentMethod, reference: input.cardReference || order.orderNumber, notes: "Collected at POS",
    });
    await postJournal(tx, invoice, quote, paymentMethod);
    await tx.insert(posInvoiceSales).values({ terminalId: terminal.id, requestKey, requestHash, invoiceId: invoice.id, orderId: order.id, mode: input.mode });
    return checkoutResult(order, invoice, false, input.orderId);
  });
}

function checkoutResult(order: any, invoice: any, deduplicated: boolean, requestOrderId: string) {
  return { orderId: requestOrderId, posOrderId: order.id, orderNumber: order.orderNumber, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
    totalCents: cents(order.total), changeDueCents: cents(order.changeDue), paymentMethod: order.paymentMethod, deduplicated };
}