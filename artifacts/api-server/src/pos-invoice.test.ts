import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool, customers, items, posLocations, posTerminals, invoices, payments, posOrders, customerCreditHistory, users, posLayoutSets, posLayoutButtons, posCashiers } from "@workspace/db";
import { pool as legacyPool } from "./db";
import { creditBalance, requireAvailableCredit, priceInvoiceLine, dueDate } from "./pos-invoice-pricing";
import { checkoutPosInvoice, quotePosInvoice, getCustomerCredit, saveCustomerCredit } from "./pos-invoice-service";
import { canApproveCustomerCredit, creditUpdateSchema, invoiceCheckoutSchema } from "./pos-invoice-routes";
import { isPublicPath, signToken } from "./auth";

after(async () => { await pool.end(); await legacyPool.end(); });

test("credit counts posted invoices, payments and credit notes, not drafts or Cash Back", () => {
  const credit = creditBalance({ openingBalance: "10", cashbackBalance: "999" }, [
    { id: "old", type: "invoice", status: "sent", total: "100", date: "2026-01-01", dueDate: "2026-01-31" },
    { id: "draft", type: "invoice", status: "draft", total: "500", date: "2026-01-01" },
    { id: "paid", type: "invoice", status: "paid", total: "20", date: "2026-01-01" },
    { id: "cn", type: "credit_note", status: "sent", total: "15" },
  ], [{ invoiceId: "old", amount: "25" }, { invoiceId: null, amount: "5" }], "2026-02-01");
  assert.equal(credit.balanceCents, 6500);
  assert.equal(credit.overdueCents, 6500);
});

test("overdue warns, but limits and suspended/unapproved status still block", () => {
  assert.doesNotThrow(() => requireAvailableCredit({ approvalStatus: "approved", availableCents: 100, hasOverdue: true }, 100));
  assert.throws(() => requireAvailableCredit({ approvalStatus: "approved", availableCents: 100 }, 101), /exceeds/);
  for (const approvalStatus of ["pending", "suspended"]) assert.throws(() => requireAvailableCredit({ approvalStatus, availableCents: 100 }, 1), /not approved/);
  assert.equal(dueDate("2026-12-20", "credit_30"), "2027-01-19");
});

test("pricing snapshots mixed VAT, fixed contracts and pack inventory quantities", () => {
  const item = { id: "i", name: "Item", price1: "10", price2: "8", vatRate: "19", packSize: 6, costPrice: "12" };
  const contracts = [{ id: "c", discountType: "percentage", discountValue: "30", minQuantity: 2 }];
  assert.equal(priceInvoiceLine(item, null, { quantity: 2 }, 2, contracts, [], []).totalCents, 1400);
  const fixed = priceInvoiceLine(item, null, { quantity: 2, saleUnit: "pack" }, 2, contracts, [], [{ contractId: "c", itemId: "i", specialPrice: "5" }]);
  assert.equal(fixed.totalCents, 1000);
  assert.equal(fixed.vatCents, 190);
  assert.equal(fixed.stockQuantity, 12);
  assert.equal(fixed.costCents, 2400);
});

test("contracts are strict, authentication cannot be smuggled and credit routes are terminal-public only where guarded", () => {
  assert.equal(isPublicPath("/api/pos/customer-invoices/checkout"), true);
  assert.equal(isPublicPath("/api/customer-credit/customer"), false);
  assert.equal(creditUpdateSchema.safeParse({ approvalStatus: "approved", creditLimit: "-5", paymentTerms: "credit_30", reason: "x" }).success, false);
  assert.equal(creditUpdateSchema.safeParse({ approvalStatus: "approved", creditLimit: "10", paymentTerms: "credit_30", reason: "" }).success, false);
  assert.equal(invoiceCheckoutSchema.safeParse({ customerId: "x", unitPrice: 0 }).success, false);
});

test("database checkout, credit approval and concurrent credit limits", async t => {
  const suffix = randomUUID();
  const [location] = await db.insert(posLocations).values({ name: `Invoice test ${suffix}`, code: `I-${suffix}` }).returning();
  const [terminal] = await db.insert(posTerminals).values({ name: "Invoice test", code: `IT-${suffix}`, locationId: location.id }).returning();
  const [customer] = await db.insert(customers).values({ name: "Invoice fixture", code: `IC-${suffix}`, priceLevel: 2, creditLimit: "0", paymentTerms: "cash" }).returning();
  const [item] = await db.insert(items).values({ name: "Invoice fixture item", sku: `II-${suffix}`, price1: "10", price2: "8", costPrice: "2", vatRate: "19", stockQuantity: 100 }).returning();
  await db.execute(sql`INSERT INTO item_location_stock (item_id, location_id, quantity) VALUES (${item.id}, ${location.id}, 100)`);
  const [manager] = await db.insert(users).values({ username: `invoice-manager-${suffix}`, password: "disabled-test-login", role: "staff", permissions: '["customer_credit_approve"]' }).returning();
  const cashier = { id: `cashier-${suffix}`, name: "Invoice fixture cashier" };
  const actor = { id: manager.id, username: manager.username };
  let httpLayoutId: string | undefined, httpCashierId: string | undefined;
  const cart = { customerId: customer.id, mode: "retail" as const, lines: [{ itemId: item.id, quantity: 1 }] };
  const makeInput = async (method: "cash" | "card" | "account_credit" = "account_credit") => {
    const quote = await quotePosInvoice(cart, terminal);
    return { ...cart, orderId: randomUUID(), quoteHash: quote.quoteHash, expectedTotalCents: quote.totalCents,
      paymentMethod: method, amountTenderedCents: method === "cash" ? 2000 : 0, ...(method === "card" ? { cardReference: `approved-${randomUUID()}` } : {}) };
  };
  const cleanup = async () => {
    await db.transaction(async tx => {
      const ownJournal = sql`SELECT je.id FROM journal_entries je WHERE
        (je.source_type = 'invoice' AND je.source_id IN (SELECT id FROM invoices WHERE customer_id = ${customer.id})) OR
        (je.source_type = 'payment' AND je.source_id IN (SELECT id FROM payments WHERE customer_id = ${customer.id}))`;
      const deltas = await tx.execute(sql`SELECT a.id, a.type, SUM(jl.debit - jl.credit)::text AS delta
        FROM journal_entry_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id IN (${ownJournal}) GROUP BY a.id, a.type`);
      for (const row of deltas.rows as any[]) {
        const delta = Number(row.delta) * (["asset", "expense"].includes(row.type) ? 1 : -1);
        await tx.execute(sql`UPDATE accounts SET balance = balance - ${delta}::numeric WHERE id = ${row.id}`);
      }
      await tx.execute(sql`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (${ownJournal})`);
      await tx.execute(sql`DELETE FROM journal_entries WHERE id IN (${ownJournal})`);
      await tx.execute(sql`DELETE FROM pos_invoice_sales WHERE terminal_id = ${terminal.id}`);
      await tx.execute(sql`DELETE FROM pos_order_lines WHERE order_id IN (SELECT id FROM pos_orders WHERE terminal_id = ${terminal.id})`);
      await tx.delete(posOrders).where(eq(posOrders.terminalId, terminal.id));
      await tx.delete(payments).where(eq(payments.customerId, customer.id));
      await tx.delete(invoices).where(eq(invoices.customerId, customer.id));
      await tx.delete(customers).where(eq(customers.id, customer.id));
      await tx.execute(sql`DELETE FROM item_location_stock WHERE item_id = ${item.id}`);
      await tx.delete(items).where(eq(items.id, item.id));
      await tx.delete(posTerminals).where(eq(posTerminals.id, terminal.id));
      if (httpLayoutId) {
        await tx.delete(posLayoutButtons).where(eq(posLayoutButtons.layoutSetId, httpLayoutId));
        await tx.delete(posLayoutSets).where(eq(posLayoutSets.id, httpLayoutId));
      }
      if (httpCashierId) await tx.delete(posCashiers).where(eq(posCashiers.id, httpCashierId));
      await tx.delete(posLocations).where(eq(posLocations.id, location.id));
      await tx.delete(users).where(eq(users.id, manager.id));
    });
  };
  try {
    await t.test("loyalty/retail credit keeps terminal prices, wholesale uses customer price level", async () => {
      assert.equal((await quotePosInvoice(cart, terminal)).totalCents, 1000);
      assert.equal((await quotePosInvoice({ ...cart, mode: "wholesale" }, terminal)).totalCents, 952);
    });
    await t.test("credit limit alone does not approve credit", async () => {
      await db.update(customers).set({ creditLimit: "100" }).where(eq(customers.id, customer.id));
      await assert.rejects(checkoutPosInvoice(await makeInput(), terminal, cashier), /not approved/);
      assert.equal((await db.select().from(invoices).where(eq(invoices.customerId, customer.id))).length, 0);
    });
    await t.test("explicit managers may approve; empty permissions, revoked permission and inactive accounts may not", async () => {
      assert.equal(await canApproveCustomerCredit(manager.id), true);
      await db.update(users).set({ permissions: "[]" }).where(eq(users.id, manager.id));
      assert.equal(await canApproveCustomerCredit(manager.id), false);
      await db.update(users).set({ permissions: '["customer_credit_approve"]', active: false }).where(eq(users.id, manager.id));
      assert.equal(await canApproveCustomerCredit(manager.id), false);
      await db.update(users).set({ active: true }).where(eq(users.id, manager.id));
      await saveCustomerCredit(customer.id, { approvalStatus: "approved", creditLimit: "100", paymentTerms: "credit_30", reason: "Fixture approval" }, actor);
      assert.equal((await db.select().from(customerCreditHistory).where(eq(customerCreditHistory.customerId, customer.id))).length, 1);
    });
    await t.test("one invoice, stock movement and journal; same-key retry changes nothing", async () => {
      const input = await makeInput();
      const before = (await db.select().from(items).where(eq(items.id, item.id)))[0].stockQuantity;
      const result = await checkoutPosInvoice(input, terminal, cashier);
      assert.equal(result.orderId, input.orderId);
      assert.equal(result.deduplicated, false);
      const replay = await checkoutPosInvoice(input, terminal, cashier);
      assert.equal(replay.invoiceId, result.invoiceId);
      assert.equal(replay.deduplicated, true);
      assert.equal((await db.select().from(items).where(eq(items.id, item.id)))[0].stockQuantity, before - 1);
      const entries = await db.execute(sql`SELECT COUNT(*)::int AS n FROM journal_entries WHERE source_type = 'invoice' AND source_id = ${result.invoiceId}`);
      assert.equal(entries.rows[0].n, 1);
      assert.equal((await getCustomerCredit(customer.id)).balanceCents, 1000);
      await assert.rejects(checkoutPosInvoice({ ...input, expectedTotalCents: input.expectedTotalCents + 1 }, terminal, cashier), /different purchase/);
    });
    await t.test("cash and recorded approved card invoices are settled and do not increase customer debt", async () => {
      for (const method of ["cash", "card"] as const) {
        const result = await checkoutPosInvoice(await makeInput(method), terminal, cashier);
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, result.invoiceId));
        assert.equal(invoice.status, "paid");
        assert.equal((await db.select().from(payments).where(eq(payments.invoiceId, invoice.id))).length, 1);
        const balance = await db.execute(sql`SELECT SUM(l.debit)::numeric = SUM(l.credit)::numeric AS balanced
          FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
          WHERE e.source_id = ${invoice.id} OR e.source_id IN (SELECT id FROM payments WHERE invoice_id = ${invoice.id})`);
        assert.equal(balance.rows[0].balanced, true);
      }
      assert.equal((await getCustomerCredit(customer.id)).balanceCents, 1000);
    });
    await t.test("a changed price rejects before creating any invoice", async () => {
      const input = await makeInput("cash");
      await db.update(items).set({ price1: "11" }).where(eq(items.id, item.id));
      await assert.rejects(checkoutPosInvoice(input, terminal, cashier), /Prices changed/);
      await db.update(items).set({ price1: "10" }).where(eq(items.id, item.id));
    });
    await t.test("overdue invoice warns but checkout succeeds within the limit", async () => {
      await db.update(invoices).set({ dueDate: "2020-01-01" }).where(eq(invoices.customerId, customer.id));
      assert.equal((await getCustomerCredit(customer.id)).hasOverdue, true);
      await checkoutPosInvoice(await makeInput(), terminal, cashier);
    });
    await t.test("two tills cannot both spend the same remaining credit", async () => {
      const credit = await getCustomerCredit(customer.id);
      await saveCustomerCredit(customer.id, { approvalStatus: "approved", creditLimit: ((credit.balanceCents + 1000) / 100).toFixed(2), paymentTerms: "credit_30", reason: "Fixture concurrent limit" }, actor);
      const [first, second] = await Promise.all([makeInput(), makeInput()]);
      const results = await Promise.allSettled([checkoutPosInvoice(first, terminal, cashier), checkoutPosInvoice(second, terminal, cashier)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
      assert.match(rejected.reason.message, /exceeds/);
      assert.equal((await getCustomerCredit(customer.id)).availableCents, 0);
    });
    await t.test("suspension blocks new credit but permits immediate cash payment", async () => {
      await saveCustomerCredit(customer.id, { approvalStatus: "suspended", creditLimit: "100", paymentTerms: "credit_30", reason: "Fixture suspension" }, actor);
      await assert.rejects(checkoutPosInvoice(await makeInput(), terminal, cashier), /not approved/);
      await checkoutPosInvoice(await makeInput("cash"), terminal, cashier);
    });
    if (process.env.POS_INVOICE_HTTP_SMOKE === "1") await t.test("live HTTP authentication, approval, quote, checkout, retry and document", async () => {
      const deviceKey = randomBytes(32).toString("base64url");
      const pin = "482961"; // Synthetic fixture PIN, never a real cashier credential.
      const [layout] = await db.insert(posLayoutSets).values({ name: `Invoice HTTP fixture ${suffix}` }).returning();
      httpLayoutId = layout.id;
      await db.insert(posLayoutButtons).values([
        { layoutSetId: layout.id, position: 0, label: "Invoice", buttonType: "action", actionCode: "WHOLESALE_INVOICE" },
        { layoutSetId: layout.id, position: 1, label: "Account", buttonType: "action", actionCode: "CUSTOMER_ACCOUNT" },
      ]);
      const [onlineCashier] = await db.insert(posCashiers).values({ name: "Invoice HTTP fixture", pin: createHash("sha256").update(pin).digest("hex"), locationId: location.id }).returning();
      httpCashierId = onlineCashier.id;
      await db.update(posTerminals).set({ layoutSetId: layout.id, voucherDeviceKeyHash: createHash("sha256").update(deviceKey).digest("hex") }).where(eq(posTerminals.id, terminal.id));
      const token = signToken({ id: manager.id, username: manager.username, email: null, role: "staff", permissions: ["customer_credit_approve"] });
      const headers = { "Content-Type": "application/json", "X-Terminal-Code": terminal.code, "X-Voucher-Device-Key": deviceKey };
      const auth = { cashierId: onlineCashier.id, pin };
      const api = async (path: string, body: any, extra = headers) => {
        const response = await fetch(`http://localhost:80${path}`, { method: "POST", headers: extra, body: JSON.stringify(body) });
        return { status: response.status, data: await response.json() };
      };
      const update = () => fetch(`http://localhost:80/api/customer-credit/${customer.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ approvalStatus: "approved", creditLimit: "100", paymentTerms: "credit_30", reason: "Synthetic HTTP fixture approval" }),
      });
      assert.equal((await update()).status, 200);
      await db.update(users).set({ permissions: "[]" }).where(eq(users.id, manager.id));
      assert.equal((await update()).status, 403, "Revoked permission must override the still-valid token");
      await db.update(users).set({ permissions: '["customer_credit_approve"]' }).where(eq(users.id, manager.id));
      assert.equal((await api("/api/pos/customer-invoices/quote", { ...cart, ...auth }, { ...headers, "X-Voucher-Device-Key": "wrong" })).status, 403);
      assert.equal((await api("/api/pos/customer-invoices/quote", { ...cart, ...auth, pin: "000000" })).status, 401);
      const quote = await api("/api/pos/customer-invoices/quote", { ...cart, ...auth });
      assert.equal(quote.status, 200, JSON.stringify(quote.data));
      assert.equal(quote.data.totalCents, 1000);
      const checkout = { ...cart, ...auth, orderId: randomUUID(), expectedTotalCents: quote.data.totalCents, quoteHash: quote.data.quoteHash, paymentMethod: "account_credit", amountTenderedCents: 0 };
      const issued = await api("/api/pos/customer-invoices/checkout", checkout);
      assert.equal(issued.status, 201, JSON.stringify(issued.data));
      assert.equal(issued.data.orderId, checkout.orderId);
      assert.equal((await api("/api/pos/customer-invoices/checkout", checkout)).data.deduplicated, true);
      const document = await fetch(`http://localhost:80/api/pos/customer-invoices/${issued.data.invoiceId}/document`, { headers });
      assert.equal(document.status, 200);
      assert.match(await document.text(), new RegExp(issued.data.invoiceNumber));
      assert.equal((await api(`/api/pos/customer-invoices/${issued.data.invoiceId}/email`, auth)).status, 400, "Do not send test emails to external recipients");
    });
  } finally { await cleanup(); }
});