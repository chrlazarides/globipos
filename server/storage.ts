import { db } from "./db";
import { eq, and, gte, lte, lt, desc, sql, ilike, or } from "drizzle-orm";
import {
  users, categories, items, customers, priceContracts, priceContractItems, priceContractRules,
  seasonalOffers, seasonalOfferItems, invoices, invoiceItems, payments,
  portalOrders, portalOrderItems, systemSettings,
  suppliers, purchaseInvoices, purchaseInvoiceItems, supplierPayments,
  emailLogs, accounts, journalEntries, journalEntryLines, expenses,
  type InsertUser, type User, type InsertCategory, type Category,
  type InsertItem, type Item, type InsertCustomer, type Customer,
  type InsertPriceContract, type PriceContract,
  type InsertPriceContractRule, type PriceContractRule,
  type InsertPriceContractItem, type PriceContractItem,
  type InsertSeasonalOffer, type SeasonalOffer,
  type InsertSeasonalOfferItem, type SeasonalOfferItem,
  type InsertInvoice, type Invoice, type InsertInvoiceItem, type InvoiceItem,
  type InsertPayment, type Payment,
  type InsertPortalOrder, type PortalOrder,
  type InsertPortalOrderItem, type PortalOrderItem,
  type SystemSetting,
  type InsertSupplier, type Supplier,
  type InsertPurchaseInvoice, type PurchaseInvoice,
  type InsertPurchaseInvoiceItem, type PurchaseInvoiceItem,
  type InsertSupplierPayment, type SupplierPayment,
  type InsertEmailLog, type EmailLog,
  type InsertAccount, type Account,
  type InsertJournalEntry, type JournalEntry,
  type InsertJournalEntryLine, type JournalEntryLine,
  type InsertExpense, type Expense,
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getCategories(): Promise<Category[]>;
  getCategory(id: string): Promise<Category | undefined>;
  createCategory(data: InsertCategory): Promise<Category>;
  updateCategory(id: string, data: Partial<InsertCategory>): Promise<Category | undefined>;

  getItems(): Promise<Item[]>;
  getItem(id: string): Promise<Item | undefined>;
  getItemByBarcode(barcode: string): Promise<Item | undefined>;
  createItem(data: InsertItem): Promise<Item>;
  updateItem(id: string, data: Partial<InsertItem>): Promise<Item | undefined>;

  getCustomers(): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | undefined>;
  getNextCustomerCode(): Promise<string>;
  findDuplicateCustomer(name: string, email?: string | null, taxId?: string | null, excludeId?: string): Promise<Customer[]>;
  createCustomer(data: InsertCustomer): Promise<Customer>;
  updateCustomer(id: string, data: Partial<InsertCustomer>): Promise<Customer | undefined>;

  getPriceContracts(): Promise<(PriceContract & { customerName?: string; priceLevel?: number })[]>;
  getPriceContract(id: string): Promise<PriceContract | undefined>;
  createPriceContract(data: InsertPriceContract): Promise<PriceContract>;
  updatePriceContract(id: string, data: Partial<InsertPriceContract>): Promise<PriceContract | undefined>;
  getContractRules(contractId: string): Promise<PriceContractRule[]>;
  setContractRules(contractId: string, rules: InsertPriceContractRule[]): Promise<PriceContractRule[]>;

  getSeasonalOffers(): Promise<SeasonalOffer[]>;
  getSeasonalOffer(id: string): Promise<SeasonalOffer | undefined>;
  createSeasonalOffer(data: InsertSeasonalOffer): Promise<SeasonalOffer>;

  getInvoices(type?: string): Promise<(Invoice & { customerName: string })[]>;
  getInvoice(id: string): Promise<(Invoice & { items: InvoiceItem[]; customerName: string }) | undefined>;
  createInvoice(data: InsertInvoice, lineItems: InsertInvoiceItem[]): Promise<Invoice>;
  updateInvoice(id: string, data: Partial<InsertInvoice>, lineItems?: InsertInvoiceItem[]): Promise<Invoice | undefined>;
  getNextInvoiceNumber(type: string): Promise<string>;

  getPayments(invoiceId: string): Promise<Payment[]>;
  getAllPayments(): Promise<(Payment & { invoiceNumber?: string; customerName?: string; invoiceTotal?: string })[]>;
  createPayment(data: InsertPayment): Promise<Payment>;
  updatePayment(id: string, data: Partial<InsertPayment>): Promise<Payment>;
  deletePayment(id: string): Promise<void>;
  autoMarkOverdue(): Promise<void>;

  getDashboardStats(): Promise<any>;
  getDashboardCharts(): Promise<any>;
  getSalesReport(from: string, to: string, customerId?: string): Promise<any>;
  getCustomerStatements(): Promise<any[]>;

  getSettings(): Promise<SystemSetting[]>;
  getSetting(key: string): Promise<SystemSetting | undefined>;
  upsertSetting(key: string, value: string, label: string, group: string): Promise<SystemSetting>;

  getCustomerByCode(code: string): Promise<Customer | undefined>;
  getCustomerInvoices(customerId: string): Promise<(Invoice & { items: InvoiceItem[] })[]>;
  getPortalOrders(customerId: string): Promise<(PortalOrder & { items: PortalOrderItem[] })[]>;
  createPortalOrder(data: InsertPortalOrder, lineItems: InsertPortalOrderItem[]): Promise<PortalOrder>;
  getAvailableItems(): Promise<Item[]>;

  getSuppliers(): Promise<Supplier[]>;
  getSupplier(id: string): Promise<Supplier | undefined>;
  createSupplier(data: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: string, data: Partial<InsertSupplier>): Promise<Supplier | undefined>;

  getPurchaseInvoices(): Promise<(PurchaseInvoice & { supplierName: string })[]>;
  getPurchaseInvoice(id: string): Promise<(PurchaseInvoice & { items: PurchaseInvoiceItem[]; supplierName: string }) | undefined>;
  createPurchaseInvoice(data: InsertPurchaseInvoice, lineItems: InsertPurchaseInvoiceItem[]): Promise<PurchaseInvoice>;
  updatePurchaseInvoice(id: string, data: Partial<InsertPurchaseInvoice>): Promise<PurchaseInvoice | undefined>;
  deletePurchaseInvoiceItems(purchaseInvoiceId: string): Promise<void>;
  createPurchaseInvoiceItems(lineItems: InsertPurchaseInvoiceItem[]): Promise<void>;
  getNextPurchaseInvoiceNumber(): Promise<string>;
  getLastPurchaseCosts(): Promise<Record<string, { unitCost: string; date: string }>>;

  getSupplierPayments(supplierId?: string): Promise<(SupplierPayment & { supplierName?: string })[]>;
  createSupplierPayment(data: InsertSupplierPayment): Promise<SupplierPayment>;
  updateSupplierPayment(id: string, data: Partial<InsertSupplierPayment>): Promise<SupplierPayment>;

  getEmailLogs(): Promise<EmailLog[]>;
  getEmailLogsByCustomer(customerId: string): Promise<EmailLog[]>;
  createEmailLog(data: InsertEmailLog): Promise<EmailLog>;

  // Accounting
  getAccounts(): Promise<Account[]>;
  getAccount(id: string): Promise<Account | undefined>;
  getAccountByCode(code: string): Promise<Account | undefined>;
  createAccount(data: InsertAccount): Promise<Account>;
  updateAccount(id: string, data: Partial<InsertAccount>): Promise<Account | undefined>;

  getJournalEntries(): Promise<JournalEntry[]>;
  getJournalEntry(id: string): Promise<(JournalEntry & { lines: (JournalEntryLine & { accountName?: string; accountCode?: string })[] }) | undefined>;
  createJournalEntry(data: InsertJournalEntry, lines: InsertJournalEntryLine[]): Promise<JournalEntry>;
  getNextJournalEntryNumber(): Promise<string>;

  getExpenses(): Promise<(Expense & { expenseAccountName?: string; paymentAccountName?: string; supplierName?: string })[]>;
  createExpense(data: InsertExpense): Promise<Expense>;

  getGeneralLedger(accountId: string, from: string, to: string): Promise<{ entries: any[]; openingBalance: string }>;
  getTrialBalance(): Promise<{ accounts: any[]; totalDebits: string; totalCredits: string }>;
  getProfitAndLoss(from: string, to: string): Promise<{ revenue: any[]; expenses: any[]; totalRevenue: string; totalExpenses: string; netIncome: string }>;
  getBalanceSheet(asOf: string): Promise<{ assets: any[]; liabilities: any[]; equity: any[]; totalAssets: string; totalLiabilities: string; totalEquity: string }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
  async getUserByUsername(username: string) {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }
  async createUser(data: InsertUser) {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async getCategories() {
    return db.select().from(categories).where(eq(categories.active, true));
  }
  async getCategory(id: string) {
    const [cat] = await db.select().from(categories).where(eq(categories.id, id));
    return cat;
  }
  async createCategory(data: InsertCategory) {
    const [cat] = await db.insert(categories).values(data).returning();
    return cat;
  }
  async updateCategory(id: string, data: Partial<InsertCategory>) {
    const [cat] = await db.update(categories).set(data).where(eq(categories.id, id)).returning();
    return cat;
  }

  async getItems() {
    return db.select().from(items).orderBy(items.name);
  }
  async getItem(id: string) {
    const [item] = await db.select().from(items).where(eq(items.id, id));
    return item;
  }
  async getItemByBarcode(barcode: string) {
    const [item] = await db.select().from(items).where(eq(items.barcode, barcode));
    return item;
  }
  async createItem(data: InsertItem) {
    const [item] = await db.insert(items).values(data).returning();
    return item;
  }
  async updateItem(id: string, data: Partial<InsertItem>) {
    const [item] = await db.update(items).set(data).where(eq(items.id, id)).returning();
    return item;
  }

  async getCustomers() {
    const custs = await db.select().from(customers).orderBy(customers.name);

    // Compute live balance per customer from invoices (all statuses incl. draft) and payments
    const allInvs = await db.select({
      customerId: invoices.customerId,
      total: invoices.total,
      type: invoices.type,
      id: invoices.id,
      status: invoices.status,
    }).from(invoices);

    const allPayments = await db.select({
      customerId: payments.customerId,
      invoiceId: payments.invoiceId,
      amount: payments.amount,
    }).from(payments);

    const paymentsByInvoice = new Map<string, number>();
    for (const p of allPayments) {
      paymentsByInvoice.set(p.invoiceId, (paymentsByInvoice.get(p.invoiceId) || 0) + parseFloat(p.amount));
    }

    return custs.map(c => {
      const custInvs = allInvs.filter(i => i.customerId === c.id && i.type === "invoice");
      const custCns = allInvs.filter(i => i.customerId === c.id && i.type === "credit_note");
      const totalInvoiced = custInvs.reduce((s, i) => s + parseFloat(i.total), 0);
      const totalCredits = custCns.reduce((s, i) => s + parseFloat(i.total), 0);
      const totalPaid = custInvs.reduce((s, i) => {
        const pmts = paymentsByInvoice.get(i.id) || 0;
        if (pmts > 0) return s + Math.min(pmts, parseFloat(i.total));
        if (i.status === "paid") return s + parseFloat(i.total);
        return s;
      }, 0);
      const liveBalance = Math.max(0, totalInvoiced - totalCredits - totalPaid);
      return { ...c, currentBalance: liveBalance.toFixed(2) };
    });
  }
  async getCustomer(id: string) {
    const [cust] = await db.select().from(customers).where(eq(customers.id, id));
    return cust;
  }
  async getNextCustomerCode() {
    const [result] = await db
      .select({ maxNum: sql<string>`MAX(CAST(NULLIF(REGEXP_REPLACE(code, '[^0-9]', '', 'g'), '') AS INTEGER))` })
      .from(customers);
    const num = (parseInt(result?.maxNum || "0") || 0) + 1;
    return `CUST${String(num).padStart(4, "0")}`;
  }

  async findDuplicateCustomer(name: string, email?: string | null, taxId?: string | null, excludeId?: string) {
    const conditions = [];
    conditions.push(ilike(customers.name, name.trim()));
    if (email && email.trim()) {
      conditions.push(ilike(customers.email, email.trim()));
    }
    if (taxId && taxId.trim()) {
      conditions.push(ilike(customers.taxId, taxId.trim()));
    }
    let query = db.select().from(customers).where(or(...conditions));
    const results = await query;
    return results.filter(c => !excludeId || c.id !== excludeId);
  }

  async createCustomer(data: InsertCustomer) {
    const [cust] = await db.insert(customers).values(data).returning();
    return cust;
  }
  async updateCustomer(id: string, data: Partial<InsertCustomer>) {
    const [cust] = await db.update(customers).set(data).where(eq(customers.id, id)).returning();
    return cust;
  }

  async getPriceContracts() {
    const result = await db
      .select({
        id: priceContracts.id,
        customerId: priceContracts.customerId,
        name: priceContracts.name,
        startDate: priceContracts.startDate,
        endDate: priceContracts.endDate,
        discountType: priceContracts.discountType,
        discountValue: priceContracts.discountValue,
        categoryId: priceContracts.categoryId,
        brand: priceContracts.brand,
        categoryIds: priceContracts.categoryIds,
        brands: priceContracts.brands,
        minQuantity: priceContracts.minQuantity,
        purchaseGoal: priceContracts.purchaseGoal,
        voucherType: priceContracts.voucherType,
        voucherValue: priceContracts.voucherValue,
        active: priceContracts.active,
        customerName: customers.name,
        priceLevel: customers.priceLevel,
      })
      .from(priceContracts)
      .leftJoin(customers, eq(priceContracts.customerId, customers.id))
      .orderBy(desc(priceContracts.startDate));
    return result.map(r => ({ ...r, customerName: r.customerName || undefined, priceLevel: r.priceLevel || 1 }));
  }
  async getPriceContract(id: string) {
    const [contract] = await db.select().from(priceContracts).where(eq(priceContracts.id, id));
    return contract;
  }
  async createPriceContract(data: InsertPriceContract) {
    const [contract] = await db.insert(priceContracts).values(data).returning();
    return contract;
  }
  async updatePriceContract(id: string, data: Partial<InsertPriceContract>) {
    const [contract] = await db.update(priceContracts).set(data).where(eq(priceContracts.id, id)).returning();
    return contract;
  }
  async getContractRules(contractId: string) {
    return db.select().from(priceContractRules).where(eq(priceContractRules.contractId, contractId));
  }
  async setContractRules(contractId: string, rules: InsertPriceContractRule[]) {
    await db.delete(priceContractRules).where(eq(priceContractRules.contractId, contractId));
    if (rules.length === 0) return [];
    const inserted = await db.insert(priceContractRules).values(rules.map(r => ({ ...r, contractId }))).returning();
    return inserted;
  }

  async getSeasonalOffers() {
    return db.select().from(seasonalOffers).orderBy(desc(seasonalOffers.startDate));
  }
  async getSeasonalOffer(id: string) {
    const [offer] = await db.select().from(seasonalOffers).where(eq(seasonalOffers.id, id));
    return offer;
  }
  async createSeasonalOffer(data: InsertSeasonalOffer) {
    const [offer] = await db.insert(seasonalOffers).values(data).returning();
    return offer;
  }

  async getInvoices(type?: string) {
    let query = db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        type: invoices.type,
        customerId: invoices.customerId,
        date: invoices.date,
        dueDate: invoices.dueDate,
        subtotal: invoices.subtotal,
        taxRate: invoices.taxRate,
        taxAmount: invoices.taxAmount,
        discountAmount: invoices.discountAmount,
        total: invoices.total,
        status: invoices.status,
        notes: invoices.notes,
        linkedInvoiceId: invoices.linkedInvoiceId,
        createdAt: invoices.createdAt,
        customerName: customers.name,
      })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .orderBy(desc(invoices.createdAt));

    if (type) {
      query = query.where(eq(invoices.type, type)) as any;
    }

    const result = await query;
    return result.map(r => ({ ...r, customerName: r.customerName || "Unknown" }));
  }

  async getInvoice(id: string) {
    const [inv] = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        type: invoices.type,
        customerId: invoices.customerId,
        date: invoices.date,
        dueDate: invoices.dueDate,
        subtotal: invoices.subtotal,
        taxRate: invoices.taxRate,
        taxAmount: invoices.taxAmount,
        discountAmount: invoices.discountAmount,
        total: invoices.total,
        status: invoices.status,
        notes: invoices.notes,
        linkedInvoiceId: invoices.linkedInvoiceId,
        createdAt: invoices.createdAt,
        customerName: customers.name,
      })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(invoices.id, id));

    if (!inv) return undefined;

    const lineItems = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    return { ...inv, customerName: inv.customerName || "Unknown", items: lineItems };
  }

  async getNextInvoiceNumber(type: string) {
    const prefix = type === "credit_note" ? "CN" : type === "proforma" ? "PF" : type === "quotation" ? "QT" : "INV";
    const [result] = await db
      .select({ maxNum: sql<string>`MAX(CAST(NULLIF(SUBSTRING(invoice_number FROM '[0-9]+$'), '') AS INTEGER))` })
      .from(invoices)
      .where(eq(invoices.type, type));
    const num = (parseInt(result?.maxNum || "0") || 0) + 1;
    return `${prefix}-${String(num).padStart(5, "0")}`;
  }

  async createInvoice(data: InsertInvoice, lineItems: InsertInvoiceItem[]) {
    const invoiceNumber = await this.getNextInvoiceNumber(data.type as string);
    const [inv] = await db.insert(invoices).values({ ...data, invoiceNumber }).returning();
    if (lineItems.length > 0) {
      await db.insert(invoiceItems).values(lineItems.map((li) => ({ ...li, invoiceId: inv.id })));
    }
    return inv;
  }

  async updateInvoice(id: string, data: Partial<InsertInvoice>, lineItems?: InsertInvoiceItem[]) {
    const { ...updateData } = data;
    const [inv] = await db.update(invoices).set(updateData).where(eq(invoices.id, id)).returning();
    if (lineItems) {
      await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
      if (lineItems.length > 0) {
        await db.insert(invoiceItems).values(lineItems.map((li) => ({ ...li, invoiceId: id })));
      }
    }
    return inv;
  }

  async getPayments(invoiceId: string) {
    return db.select().from(payments).where(eq(payments.invoiceId, invoiceId)).orderBy(desc(payments.paymentDate));
  }

  async getAllPayments() {
    const rows = await db
      .select({
        id: payments.id,
        customerId: payments.customerId,
        invoiceId: payments.invoiceId,
        amount: payments.amount,
        paymentDate: payments.paymentDate,
        paymentMethod: payments.paymentMethod,
        reference: payments.reference,
        notes: payments.notes,
        createdAt: payments.createdAt,
        invoiceNumber: invoices.invoiceNumber,
        invoiceTotal: invoices.total,
        customerName: customers.name,
      })
      .from(payments)
      .leftJoin(invoices, eq(payments.invoiceId, invoices.id))
      .leftJoin(customers, sql`${customers.id} = COALESCE(${payments.customerId}, ${invoices.customerId})`)
      .orderBy(desc(payments.createdAt));
    return rows.map(r => ({
      ...r,
      invoiceNumber: r.invoiceNumber || undefined,
      invoiceTotal: r.invoiceTotal || undefined,
      customerName: r.customerName || undefined,
    }));
  }

  private async recalcInvoiceStatus(invoiceId: string) {
    const inv = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!inv[0]) return;
    // Only auto-manage status for actual invoices; never touch cancelled
    if (inv[0].type !== "invoice") return;
    if (inv[0].status === "cancelled") return;

    const allPmts = await this.getPayments(invoiceId);
    const totalPaid = allPmts.reduce((s, p) => s + parseFloat(String(p.amount)), 0);
    const invoiceTotal = parseFloat(String(inv[0].total));
    const currentStatus = inv[0].status;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = inv[0].dueDate ? new Date(inv[0].dueDate) : null;
    const isPastDue = dueDate ? dueDate < today : false;

    let newStatus: string = currentStatus;

    if (totalPaid >= invoiceTotal && invoiceTotal > 0) {
      newStatus = "paid";
    } else if (totalPaid > 0) {
      // Partially paid — always mark as partial (promotes out of draft too)
      newStatus = "partial";
    } else {
      // No payments
      if (currentStatus === "paid" || currentStatus === "partial") {
        // All payments removed — fall back based on due date
        newStatus = isPastDue ? "overdue" : "sent";
      } else if (currentStatus === "sent" && isPastDue) {
        newStatus = "overdue";
      }
      // draft stays draft; overdue stays overdue (no payments, still past due)
    }

    if (newStatus !== currentStatus) {
      await db.update(invoices).set({ status: newStatus }).where(eq(invoices.id, invoiceId));
    }
  }

  // Sweep all non-draft, non-paid, non-cancelled invoices past their due date → mark overdue
  async autoMarkOverdue() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];
    await db.update(invoices).set({ status: "overdue" }).where(
      and(
        eq(invoices.type, "invoice"),
        sql`${invoices.status} IN ('sent', 'partial')`,
        sql`${invoices.dueDate} IS NOT NULL`,
        sql`${invoices.dueDate} < ${todayStr}`,
      )
    );
  }

  async createPayment(data: InsertPayment) {
    const [payment] = await db.insert(payments).values(data).returning();

    if (data.invoiceId) {
      // Payment against a specific invoice → update its status
      await this.recalcInvoiceStatus(data.invoiceId);
    } else if (data.customerId) {
      // Balance payment → apply remaining amount to oldest outstanding invoices
      let remaining = parseFloat(String(data.amount));
      const outstanding = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.customerId, data.customerId),
            sql`${invoices.status} NOT IN ('paid', 'cancelled')`,
            eq(invoices.type, "invoice"),
          )
        )
        .orderBy(invoices.date);

      for (const inv of outstanding) {
        if (remaining <= 0) break;
        const existingPmts = await this.getPayments(inv.id);
        const alreadyPaid = existingPmts.reduce((s, p) => s + parseFloat(String(p.amount)), 0);
        const invTotal = parseFloat(String(inv.total));
        const owed = invTotal - alreadyPaid;
        if (owed <= 0) continue;
        const applying = Math.min(remaining, owed);
        // Record a sub-payment linked to this invoice
        await db.insert(payments).values({
          customerId: data.customerId,
          invoiceId: inv.id,
          amount: applying.toFixed(2),
          paymentDate: data.paymentDate,
          paymentMethod: data.paymentMethod,
          reference: data.reference,
          notes: `Applied from balance payment ${payment.id}`,
        });
        await this.recalcInvoiceStatus(inv.id);
        remaining -= applying;
      }
    }

    return payment;
  }

  async updatePayment(id: string, data: Partial<InsertPayment>) {
    const [updated] = await db.update(payments).set(data).where(eq(payments.id, id)).returning();
    if (!updated) throw new Error("Payment not found");
    if (updated.invoiceId) {
      await this.recalcInvoiceStatus(updated.invoiceId);
    }
    return updated;
  }

  async deletePayment(id: string) {
    const [pmt] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!pmt) throw new Error("Payment not found");
    // Also delete any child split-payments created by a balance payment
    await db.delete(payments).where(sql`${payments.notes} LIKE ${'Applied from balance payment ' + id + '%'}`);
    await db.delete(payments).where(eq(payments.id, id));
    if (pmt.invoiceId) {
      await this.recalcInvoiceStatus(pmt.invoiceId);
    } else if (pmt.customerId) {
      // Balance payment: recalc status for all invoices of this customer that may have been affected
      const custInvs = await db.select({ id: invoices.id }).from(invoices)
        .where(and(eq(invoices.customerId, pmt.customerId), eq(invoices.type, "invoice")));
      for (const inv of custInvs) {
        await this.recalcInvoiceStatus(inv.id);
      }
    }
  }

  async getDashboardStats() {
    const [itemCount] = await db.select({ count: sql<number>`count(*)` }).from(items).where(eq(items.active, true));
    const [custCount] = await db.select({ count: sql<number>`count(*)` }).from(customers).where(eq(customers.active, true));
    const [invCount] = await db.select({ count: sql<number>`count(*)` }).from(invoices).where(eq(invoices.type, "invoice"));
    // Dynamic overdue count: unpaid/partial invoices past their due date
    const todayStr = new Date().toISOString().split("T")[0];
    const [overdueCount] = await db.select({ count: sql<number>`count(*)` }).from(invoices).where(
      and(
        eq(invoices.type, "invoice"),
        sql`${invoices.status} IN ('sent', 'partial', 'overdue')`,
        sql`${invoices.dueDate} IS NOT NULL`,
        sql`${invoices.dueDate} < ${todayStr}`,
      )
    );
    // Revenue: total collected (sum of payments received)
    const [revenueRow] = await db.select({ total: sql<string>`coalesce(sum(amount::numeric), 0)` }).from(payments)
      .leftJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(sql`${invoices.type} = 'invoice' OR ${payments.invoiceId} IS NULL`);

    const lowStockItems = await db.select().from(items)
      .where(and(eq(items.active, true), sql`${items.stockQuantity} <= ${items.reorderLevel}`))
      .orderBy(items.stockQuantity)
      .limit(10);

    const recentInvs = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        type: invoices.type,
        customerId: invoices.customerId,
        date: invoices.date,
        dueDate: invoices.dueDate,
        subtotal: invoices.subtotal,
        taxRate: invoices.taxRate,
        taxAmount: invoices.taxAmount,
        discountAmount: invoices.discountAmount,
        total: invoices.total,
        status: invoices.status,
        notes: invoices.notes,
        linkedInvoiceId: invoices.linkedInvoiceId,
        createdAt: invoices.createdAt,
        customerName: customers.name,
      })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(invoices.type, "invoice"))
      .orderBy(desc(invoices.createdAt))
      .limit(5);

    return {
      totalItems: itemCount?.count || 0,
      totalCustomers: custCount?.count || 0,
      totalInvoices: invCount?.count || 0,
      overdueInvoices: overdueCount?.count || 0,
      totalRevenue: revenueRow?.total || "0",
      lowStockItems,
      recentInvoices: recentInvs.map(r => ({ ...r, customerName: r.customerName || "Unknown" })),
    };
  }

  async getDashboardCharts() {
    // Last 6 full months + current month = 7 data points
    const now = new Date();
    const months: { label: string; from: string; to: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const label = d.toLocaleString("en-GB", { month: "short", year: "2-digit" });
      months.push({ label, from, to });
    }

    // Fetch all sales invoices (non-cancelled) with their items + item cost prices in date range
    const sixMonthsAgo = months[0].from;
    const allInvs = await db
      .select({
        id: invoices.id,
        date: invoices.date,
        subtotal: invoices.subtotal,
        discountAmount: invoices.discountAmount,
      })
      .from(invoices)
      .where(and(
        eq(invoices.type, "invoice"),
        gte(invoices.date, sixMonthsAgo),
        sql`${invoices.status} != 'cancelled'`,
      ));

    const allInvIds = allInvs.map(i => i.id);

    // Get all invoice items with cost price (pack-size adjusted) matching getSalesReport logic
    let itemCostMap: Record<string, number> = {};
    let itemPackMap: Record<string, number> = {};
    let invItemCosts: Record<string, number> = {};
    if (allInvIds.length > 0) {
      const invItemRows = await db
        .select({
          invoiceId: invoiceItems.invoiceId,
          quantity: invoiceItems.quantity,
          itemId: invoiceItems.itemId,
          saleUnit: invoiceItems.saleUnit,
        })
        .from(invoiceItems)
        .where(sql`${invoiceItems.invoiceId} = ANY(ARRAY[${sql.raw(allInvIds.map(id => `'${id}'`).join(","))}]::text[])`);

      const allItemIds = [...new Set(invItemRows.map(r => r.itemId).filter(Boolean))] as string[];
      if (allItemIds.length > 0) {
        const itemRows = await db
          .select({ id: items.id, costPrice: items.costPrice, packSize: items.packSize })
          .from(items)
          .where(sql`${items.id} = ANY(ARRAY[${sql.raw(allItemIds.map(id => `'${id}'`).join(","))}]::text[])`);
        itemCostMap = Object.fromEntries(itemRows.map(r => [r.id, parseFloat(r.costPrice || "0")]));
        itemPackMap = Object.fromEntries(itemRows.map(r => [r.id, r.packSize || 1]));
      }

      for (const row of invItemRows) {
        const qty = parseFloat(String(row.quantity || 0));
        const cost = row.itemId ? (itemCostMap[row.itemId] || 0) : 0;
        const packSize = row.itemId ? (itemPackMap[row.itemId] || 1) : 1;
        // Match getSalesReport: if sold in packs, multiply qty by packSize for cost
        const effectiveQty = row.saleUnit === "pack" ? qty * packSize : qty;
        const lineCost = effectiveQty * cost;
        invItemCosts[row.invoiceId] = (invItemCosts[row.invoiceId] || 0) + lineCost;
      }
    }

    // Build monthly buckets — revenue = subtotal - discount (ex-VAT), matching sales report
    const monthlySales = months.map(m => {
      const monthInvs = allInvs.filter(i => i.date >= m.from && i.date <= m.to);
      const revenue = monthInvs.reduce((s, i) => s + parseFloat(i.subtotal) - parseFloat(i.discountAmount || "0"), 0);
      const cost = monthInvs.reduce((s, i) => s + (invItemCosts[i.id] || 0), 0);
      const profit = revenue - cost;
      return { month: m.label, endDate: m.to, revenue: Math.round(revenue * 100) / 100, profit: Math.round(profit * 100) / 100, invoices: monthInvs.length };
    });

    // Top 5 customers by net revenue ex-VAT (all time, non-cancelled)
    const custRevRows = await db
      .select({
        customerId: invoices.customerId,
        customerName: customers.name,
        subtotal: invoices.subtotal,
        discountAmount: invoices.discountAmount,
      })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(and(eq(invoices.type, "invoice"), sql`${invoices.status} != 'cancelled'`));

    const custTotals: Record<string, { name: string; revenue: number }> = {};
    for (const r of custRevRows) {
      if (!r.customerId) continue;
      if (!custTotals[r.customerId]) custTotals[r.customerId] = { name: r.customerName || "Unknown", revenue: 0 };
      custTotals[r.customerId].revenue += parseFloat(r.subtotal) - parseFloat(r.discountAmount || "0");
    }
    const topCustomers = Object.values(custTotals)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map(c => ({ name: c.name.length > 18 ? c.name.slice(0, 18) + "…" : c.name, revenue: Math.round(c.revenue * 100) / 100 }));

    // Pareto: all customers sorted descending by revenue with cumulative %
    const paretoAll = Object.values(custTotals)
      .filter(c => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15);
    const paretoTotal = paretoAll.reduce((s, c) => s + c.revenue, 0);
    let cumRev = 0;
    const paretoCustomers = paretoAll.map(c => {
      cumRev += c.revenue;
      return {
        name: c.name.length > 13 ? c.name.slice(0, 13) + "…" : c.name,
        revenue: Math.round(c.revenue * 100) / 100,
        cumPct: paretoTotal > 0 ? Math.round(cumRev / paretoTotal * 1000) / 10 : 0,
      };
    });

    // Invoice status breakdown
    const statusRows = await db
      .select({ status: invoices.status, total: invoices.total })
      .from(invoices)
      .where(eq(invoices.type, "invoice"));
    const statusMap: Record<string, { count: number; amount: number }> = {};
    for (const r of statusRows) {
      if (!statusMap[r.status]) statusMap[r.status] = { count: 0, amount: 0 };
      statusMap[r.status].count++;
      statusMap[r.status].amount += parseFloat(r.total);
    }
    const invoiceStatus = Object.entries(statusMap).map(([status, v]) => ({
      status,
      count: v.count,
      amount: Math.round(v.amount * 100) / 100,
    }));

    return { monthlySales, topCustomers, invoiceStatus, paretoCustomers };
  }

  async getSalesReport(from: string, to: string, customerId?: string) {
    let conditions = [
      eq(invoices.type, "invoice"),
      gte(invoices.date, from),
      lte(invoices.date, to),
      sql`${invoices.status} != 'cancelled'`,
    ];
    if (customerId && customerId !== "all") {
      conditions.push(eq(invoices.customerId, customerId));
    }

    const invs = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        type: invoices.type,
        customerId: invoices.customerId,
        date: invoices.date,
        dueDate: invoices.dueDate,
        subtotal: invoices.subtotal,
        taxRate: invoices.taxRate,
        taxAmount: invoices.taxAmount,
        discountAmount: invoices.discountAmount,
        total: invoices.total,
        status: invoices.status,
        notes: invoices.notes,
        linkedInvoiceId: invoices.linkedInvoiceId,
        createdAt: invoices.createdAt,
        customerName: customers.name,
      })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(and(...conditions))
      .orderBy(desc(invoices.date));

    const invoicesWithCost = await Promise.all(invs.map(async (inv) => {
      const lineItems = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
      let totalCost = 0;
      for (const li of lineItems) {
        if (li.itemId) {
          const item = await db.select({ costPrice: items.costPrice, packSize: items.packSize }).from(items).where(eq(items.id, li.itemId)).limit(1);
          if (item.length > 0) {
            const costPerUnit = parseFloat(item[0].costPrice);
            const saleInPacks = li.saleUnit === "pack" ? li.quantity * (item[0].packSize || 1) : li.quantity;
            totalCost += costPerUnit * saleInPacks;
          }
        }
      }
      const revenue = parseFloat(inv.subtotal) - parseFloat(inv.discountAmount || "0");
      const profit = revenue - totalCost;
      const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
      return {
        ...inv,
        customerName: inv.customerName || "Unknown",
        costTotal: totalCost.toFixed(2),
        profit: profit.toFixed(2),
        marginPct: marginPct.toFixed(1),
      };
    }));

    const totalSales = invoicesWithCost.reduce((s, i) => s + parseFloat(i.total), 0);
    const totalTax = invoicesWithCost.reduce((s, i) => s + parseFloat(i.taxAmount), 0);
    const totalCost = invoicesWithCost.reduce((s, i) => s + parseFloat(i.costTotal), 0);
    const totalProfit = invoicesWithCost.reduce((s, i) => s + parseFloat(i.profit), 0);
    const totalRevenue = invoicesWithCost.reduce((s, i) => s + parseFloat(i.subtotal) - parseFloat(i.discountAmount || "0"), 0);
    const overallMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    const customerMap: Record<string, { name: string; revenue: number; cost: number; profit: number; invoiceCount: number }> = {};
    for (const inv of invoicesWithCost) {
      if (!customerMap[inv.customerId]) {
        customerMap[inv.customerId] = { name: inv.customerName, revenue: 0, cost: 0, profit: 0, invoiceCount: 0 };
      }
      const c = customerMap[inv.customerId];
      c.revenue += parseFloat(inv.subtotal) - parseFloat(inv.discountAmount || "0");
      c.cost += parseFloat(inv.costTotal);
      c.profit += parseFloat(inv.profit);
      c.invoiceCount += 1;
    }
    const customerProfits = Object.entries(customerMap).map(([id, c]) => ({
      customerId: id,
      customerName: c.name,
      revenue: c.revenue.toFixed(2),
      cost: c.cost.toFixed(2),
      profit: c.profit.toFixed(2),
      marginPct: c.revenue > 0 ? ((c.profit / c.revenue) * 100).toFixed(1) : "0.0",
      invoiceCount: c.invoiceCount,
    })).sort((a, b) => parseFloat(b.profit) - parseFloat(a.profit));

    return {
      invoices: invoicesWithCost,
      totalRevenue: totalRevenue.toFixed(2),
      totalSales: totalSales.toFixed(2),
      totalTax: totalTax.toFixed(2),
      totalCost: totalCost.toFixed(2),
      totalProfit: totalProfit.toFixed(2),
      overallMargin: overallMargin.toFixed(1),
      invoiceCount: invoicesWithCost.length,
      customerProfits,
    };
  }

  async getCustomerStatements() {
    const custs = await db.select().from(customers).where(eq(customers.active, true));

    // Load ALL payments at once and build a lookup map: invoiceId -> total paid
    const allPayments = await db.select().from(payments);
    const paymentsByInvoice = new Map<string, number>();
    for (const pmt of allPayments) {
      const prev = paymentsByInvoice.get(pmt.invoiceId) || 0;
      paymentsByInvoice.set(pmt.invoiceId, prev + parseFloat(String(pmt.amount)));
    }

    // Helper: get actual paid amount for an invoice
    const getPaid = (inv: { id: string; total: string; status: string }) => {
      const pmtTotal = paymentsByInvoice.get(inv.id) || 0;
      if (pmtTotal > 0) return Math.min(pmtTotal, parseFloat(inv.total));
      if (inv.status === "paid") return parseFloat(inv.total);
      return 0;
    };

    // Helper: days credit given for a payment terms string
    const termDays = (terms: string | null): number => {
      if (terms === "credit_30") return 30;
      if (terms === "credit_60") return 60;
      if (terms === "credit_90") return 90;
      return 0;
    };

    // Helper: parse a YYYY-MM-DD string as a LOCAL midnight Date (avoids UTC-offset day shift)
    const parseLocalDate = (s: string): Date => {
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    };

    // Helper: compute effective due date for an invoice given customer terms
    const effectiveDueDate = (inv: { date: string; dueDate: string | null }, creditDays: number): Date => {
      if (inv.dueDate) {
        return parseLocalDate(inv.dueDate);
      }
      const d = parseLocalDate(inv.date);
      d.setDate(d.getDate() + creditDays);
      return d;
    };

    const statements = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Last day of the current month
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    for (const cust of custs) {
      const allInvs = await db.select().from(invoices).where(eq(invoices.customerId, cust.id));
      const invs = allInvs.filter(i => i.type === "invoice" && i.status !== "cancelled");
      const cns = allInvs.filter(i => i.type === "credit_note" && i.status !== "cancelled");

      const totalInvoiced = invs.reduce((s, i) => s + parseFloat(i.total), 0);
      const totalCredits = cns.reduce((s, i) => s + parseFloat(i.total), 0);
      const totalPaid = invs.reduce((s, i) => s + getPaid(i), 0);

      const creditDays = termDays(cust.paymentTerms);

      // Terms-aware aging buckets:
      // withinTermsFuture: not yet due AND due date is after end of this month
      // dueThisMonth:      not yet due AND due date falls within this calendar month
      // overdue1_30:       1–30 days past due date
      // overdue31_60:      31–60 days past due date
      // overdue60plus:     60+ days past due date
      const aging = { withinTermsFuture: 0, dueThisMonth: 0, overdue1_30: 0, overdue31_60: 0, overdue60plus: 0 };

      for (const inv of invs) {
        const paid = getPaid(inv);
        const balance = parseFloat(inv.total) - paid;
        if (balance <= 0) continue;
        const dueDate = effectiveDueDate(inv, creditDays);
        if (dueDate >= today) {
          // Not yet overdue
          if (dueDate <= endOfMonth) {
            aging.dueThisMonth += balance;
          } else {
            aging.withinTermsFuture += balance;
          }
        } else {
          // Overdue
          const daysLate = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysLate <= 30) aging.overdue1_30 += balance;
          else if (daysLate <= 60) aging.overdue31_60 += balance;
          else aging.overdue60plus += balance;
        }
      }

      // Apply credit notes to oldest overdue buckets first
      let creditsRemaining = totalCredits;
      for (const bucket of ["overdue60plus", "overdue31_60", "overdue1_30", "dueThisMonth", "withinTermsFuture"] as const) {
        if (creditsRemaining <= 0) break;
        const reduction = Math.min(creditsRemaining, aging[bucket]);
        aging[bucket] = Math.max(0, aging[bucket] - reduction);
        creditsRemaining -= reduction;
      }

      // Total overdue = everything past due date
      const totalOverdue = aging.overdue1_30 + aging.overdue31_60 + aging.overdue60plus;

      // Break outstanding balances into last-month (prevMonth) and month-before-last invoice totals
      const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const prevMonthYM = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
      const prevPrevMonthDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      const prevPrevMonthYM = `${prevPrevMonthDate.getFullYear()}-${String(prevPrevMonthDate.getMonth() + 1).padStart(2, "0")}`;
      let dueByEomCurrentMonth = 0;
      let dueByEomPrevMonth = 0;
      for (const inv of invs) {
        const paid = getPaid(inv);
        const balance = parseFloat(inv.total) - paid;
        if (balance <= 0) continue;
        const invYM = inv.date.substring(0, 7);
        if (invYM === prevMonthYM) dueByEomCurrentMonth += balance;
        else if (invYM === prevPrevMonthYM) dueByEomPrevMonth += balance;
      }
      // "Due by" = outstanding from last month + month before last
      const dueByEndOfMonth = dueByEomCurrentMonth + dueByEomPrevMonth;

      // Balance as of the last day of the previous month:
      // Sum all invoices (and credit notes) whose invoice date falls on or before prevMonthEnd,
      // minus all payments received on or before prevMonthEnd.
      const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0); // last day of prev month
      prevMonthEnd.setHours(23, 59, 59, 999);
      const prevMonthEndStr = `${prevMonthEnd.getFullYear()}-${String(prevMonthEnd.getMonth() + 1).padStart(2, "0")}-${String(prevMonthEnd.getDate()).padStart(2, "0")}`;
      const prevMonthEndLabel = prevMonthEnd.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

      let balanceAsOfPrevMonthEnd = 0;
      for (const inv of allInvs) {
        if (inv.status === "cancelled") continue;
        if (String(inv.date) > prevMonthEndStr) continue;
        const total = parseFloat(inv.total);
        if (inv.type === "invoice") balanceAsOfPrevMonthEnd += total;
        else if (inv.type === "credit_note") balanceAsOfPrevMonthEnd -= total;
      }
      // Subtract payments received on or before prevMonthEnd
      const custInvIdsSet = new Set(allInvs.map(i => i.id));
      for (const pmt of allPayments) {
        const belongsToCust = (pmt.invoiceId && custInvIdsSet.has(pmt.invoiceId)) ||
          (!pmt.invoiceId && pmt.customerId === cust.id && !(pmt.notes || "").startsWith("Applied from balance payment"));
        if (!belongsToCust) continue;
        const pmtDate = String(pmt.paymentDate || "");
        if (pmtDate > prevMonthEndStr) continue;
        balanceAsOfPrevMonthEnd -= parseFloat(String(pmt.amount));
      }
      balanceAsOfPrevMonthEnd = Math.max(0, balanceAsOfPrevMonthEnd);

      const invById = new Map(allInvs.map(i => [i.id, i]));

      const invoiceList = allInvs.map(inv => {
        const total = parseFloat(inv.total);
        const paid = getPaid(inv);
        const outstanding = Math.max(0, total - paid);
        let daysOverdue: number | null = null;
        let effectiveDue: string | null = null;
        if (inv.type === "invoice" && outstanding > 0) {
          const dueDate = effectiveDueDate(inv, creditDays);
          effectiveDue = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}-${String(dueDate.getDate()).padStart(2, "0")}`;
          daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        }
        return {
          invoiceNumber: inv.invoiceNumber,
          date: inv.date,
          type: inv.type,
          status: inv.status,
          dueDate: inv.dueDate,
          effectiveDueDate: effectiveDue,
          total: total.toFixed(2),
          paid: paid.toFixed(2),
          balance: outstanding.toFixed(2),
          daysOverdue,
        };
      });

      const custInvIds = new Set(allInvs.map(i => i.id));
      const paymentList = allPayments
        .filter(p => {
          if (p.invoiceId && custInvIds.has(p.invoiceId)) return true;
          if (!p.invoiceId && p.customerId === cust.id && !(p.notes || "").startsWith("Applied from balance payment")) return true;
          return false;
        })
        .sort((a, b) => String(a.paymentDate).localeCompare(String(b.paymentDate)))
        .map(p => {
          const inv = p.invoiceId ? invById.get(p.invoiceId) : null;
          return {
            date: p.paymentDate,
            amount: parseFloat(String(p.amount)).toFixed(2),
            paymentMethod: p.paymentMethod,
            reference: p.reference || null,
            notes: p.notes || null,
            invoiceNumber: inv ? inv.invoiceNumber : null,
          };
        });

      const totalBalance = aging.withinTermsFuture + aging.dueThisMonth + aging.overdue1_30 + aging.overdue31_60 + aging.overdue60plus;

      statements.push({
        customerId: cust.id,
        customerName: cust.name,
        paymentTerms: cust.paymentTerms || "cash",
        totalInvoiced: totalInvoiced.toFixed(2),
        totalCredits: totalCredits.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        balance: totalBalance.toFixed(2),
        balanceAsOfPrevMonthEnd: balanceAsOfPrevMonthEnd.toFixed(2),
        prevMonthEndLabel,
        dueByEndOfMonth: dueByEndOfMonth.toFixed(2),
        dueByEomCurrentMonth: dueByEomCurrentMonth.toFixed(2),
        dueByEomPrevMonth: dueByEomPrevMonth.toFixed(2),
        totalOverdue: totalOverdue.toFixed(2),
        invoiceCount: allInvs.length,
        invoices: invoiceList,
        payments: paymentList,
        aging: {
          withinTermsFuture: aging.withinTermsFuture.toFixed(2),
          dueThisMonth: aging.dueThisMonth.toFixed(2),
          overdue1_30: aging.overdue1_30.toFixed(2),
          overdue31_60: aging.overdue31_60.toFixed(2),
          overdue60plus: aging.overdue60plus.toFixed(2),
        },
      });
    }
    return statements;
  }

  async getSettings() {
    return db.select().from(systemSettings).orderBy(systemSettings.group, systemSettings.key);
  }

  async getSetting(key: string) {
    const [setting] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
    return setting;
  }

  async upsertSetting(key: string, value: string, label: string, group: string) {
    const existing = await this.getSetting(key);
    if (existing) {
      const [updated] = await db.update(systemSettings).set({ value, label, group }).where(eq(systemSettings.key, key)).returning();
      return updated;
    }
    const [created] = await db.insert(systemSettings).values({ key, value, label, group }).returning();
    return created;
  }

  async getCustomerByCode(code: string) {
    const [cust] = await db.select().from(customers).where(eq(customers.code, code));
    return cust;
  }

  async getCustomerInvoices(customerId: string) {
    const invs = await db.select().from(invoices)
      .where(eq(invoices.customerId, customerId))
      .orderBy(desc(invoices.createdAt));
    const result = [];
    for (const inv of invs) {
      const lineItems = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
      result.push({ ...inv, items: lineItems });
    }
    return result;
  }

  async getPortalOrders(customerId: string) {
    const orders = await db.select().from(portalOrders)
      .where(eq(portalOrders.customerId, customerId))
      .orderBy(desc(portalOrders.createdAt));
    const result = [];
    for (const order of orders) {
      const items = await db.select().from(portalOrderItems).where(eq(portalOrderItems.orderId, order.id));
      result.push({ ...order, items });
    }
    return result;
  }

  async createPortalOrder(data: InsertPortalOrder, lineItems: InsertPortalOrderItem[]) {
    const [order] = await db.insert(portalOrders).values(data).returning();
    if (lineItems.length > 0) {
      await db.insert(portalOrderItems).values(lineItems.map(li => ({ ...li, orderId: order.id })));
    }
    return order;
  }

  async getAvailableItems() {
    return db.select().from(items)
      .where(and(eq(items.active, true), sql`${items.stockQuantity} > 0`))
      .orderBy(items.name);
  }

  async getSuppliers() {
    return db.select().from(suppliers).orderBy(suppliers.name);
  }
  async getSupplier(id: string) {
    const [sup] = await db.select().from(suppliers).where(eq(suppliers.id, id));
    return sup;
  }
  async createSupplier(data: InsertSupplier) {
    const [sup] = await db.insert(suppliers).values(data).returning();
    return sup;
  }
  async updateSupplier(id: string, data: Partial<InsertSupplier>) {
    const [sup] = await db.update(suppliers).set(data).where(eq(suppliers.id, id)).returning();
    return sup;
  }

  async getPurchaseInvoices() {
    const result = await db
      .select({
        id: purchaseInvoices.id,
        invoiceNumber: purchaseInvoices.invoiceNumber,
        supplierInvoiceRef: purchaseInvoices.supplierInvoiceRef,
        supplierId: purchaseInvoices.supplierId,
        date: purchaseInvoices.date,
        dueDate: purchaseInvoices.dueDate,
        subtotal: purchaseInvoices.subtotal,
        vatAmount: purchaseInvoices.vatAmount,
        total: purchaseInvoices.total,
        status: purchaseInvoices.status,
        notes: purchaseInvoices.notes,
        createdAt: purchaseInvoices.createdAt,
        supplierName: suppliers.name,
      })
      .from(purchaseInvoices)
      .leftJoin(suppliers, eq(purchaseInvoices.supplierId, suppliers.id))
      .orderBy(desc(purchaseInvoices.createdAt));
    return result.map(r => ({ ...r, supplierName: r.supplierName || "Unknown" }));
  }

  async getPurchaseInvoice(id: string) {
    const [inv] = await db
      .select({
        id: purchaseInvoices.id,
        invoiceNumber: purchaseInvoices.invoiceNumber,
        supplierInvoiceRef: purchaseInvoices.supplierInvoiceRef,
        supplierId: purchaseInvoices.supplierId,
        date: purchaseInvoices.date,
        dueDate: purchaseInvoices.dueDate,
        subtotal: purchaseInvoices.subtotal,
        vatAmount: purchaseInvoices.vatAmount,
        total: purchaseInvoices.total,
        status: purchaseInvoices.status,
        notes: purchaseInvoices.notes,
        createdAt: purchaseInvoices.createdAt,
        supplierName: suppliers.name,
      })
      .from(purchaseInvoices)
      .leftJoin(suppliers, eq(purchaseInvoices.supplierId, suppliers.id))
      .where(eq(purchaseInvoices.id, id));
    if (!inv) return undefined;
    const lineItems = await db.select().from(purchaseInvoiceItems).where(eq(purchaseInvoiceItems.purchaseInvoiceId, id));
    return { ...inv, supplierName: inv.supplierName || "Unknown", items: lineItems };
  }

  async getNextPurchaseInvoiceNumber() {
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(purchaseInvoices);
    const num = (result?.count || 0) + 1;
    return `PI-${String(num).padStart(5, "0")}`;
  }

  async createPurchaseInvoice(data: InsertPurchaseInvoice, lineItems: InsertPurchaseInvoiceItem[]) {
    const invoiceNumber = await this.getNextPurchaseInvoiceNumber();
    const [inv] = await db.insert(purchaseInvoices).values({ ...data, invoiceNumber }).returning();
    if (lineItems.length > 0) {
      await db.insert(purchaseInvoiceItems).values(lineItems.map(li => ({ ...li, purchaseInvoiceId: inv.id })));
    }
    return inv;
  }

  async getLastPurchaseCosts(): Promise<Record<string, { unitCost: string; date: string }>> {
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (pii.item_id)
        pii.item_id,
        pii.unit_cost,
        pi.date
      FROM purchase_invoice_items pii
      JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
      ORDER BY pii.item_id, pi.date DESC, pi.created_at DESC
    `);
    const result: Record<string, { unitCost: string; date: string }> = {};
    for (const row of rows.rows) {
      const r = row as any;
      result[r.item_id] = { unitCost: r.unit_cost, date: r.date };
    }
    return result;
  }

  async updatePurchaseInvoice(id: string, data: Partial<InsertPurchaseInvoice>) {
    const [inv] = await db.update(purchaseInvoices).set(data).where(eq(purchaseInvoices.id, id)).returning();
    return inv;
  }

  async deletePurchaseInvoiceItems(purchaseInvoiceId: string) {
    await db.delete(purchaseInvoiceItems).where(eq(purchaseInvoiceItems.purchaseInvoiceId, purchaseInvoiceId));
  }

  async createPurchaseInvoiceItems(lineItems: InsertPurchaseInvoiceItem[]) {
    if (lineItems.length > 0) {
      await db.insert(purchaseInvoiceItems).values(lineItems);
    }
  }

  async getSupplierPayments(supplierId?: string) {
    let query = db
      .select({
        id: supplierPayments.id,
        supplierId: supplierPayments.supplierId,
        purchaseInvoiceId: supplierPayments.purchaseInvoiceId,
        amount: supplierPayments.amount,
        paymentDate: supplierPayments.paymentDate,
        paymentMethod: supplierPayments.paymentMethod,
        reference: supplierPayments.reference,
        notes: supplierPayments.notes,
        createdAt: supplierPayments.createdAt,
        supplierName: suppliers.name,
        purchaseInvoiceNumber: purchaseInvoices.invoiceNumber,
        purchaseInvoiceTotal: purchaseInvoices.total,
        purchaseInvoiceRef: purchaseInvoices.supplierInvoiceRef,
      })
      .from(supplierPayments)
      .leftJoin(suppliers, eq(supplierPayments.supplierId, suppliers.id))
      .leftJoin(purchaseInvoices, eq(supplierPayments.purchaseInvoiceId, purchaseInvoices.id))
      .orderBy(desc(supplierPayments.createdAt));

    if (supplierId) {
      query = query.where(eq(supplierPayments.supplierId, supplierId)) as any;
    }

    const result = await query;
    return result.map(r => ({
      ...r,
      supplierName: r.supplierName || undefined,
      purchaseInvoiceNumber: r.purchaseInvoiceNumber || undefined,
      purchaseInvoiceTotal: r.purchaseInvoiceTotal || undefined,
      purchaseInvoiceRef: r.purchaseInvoiceRef || undefined,
    }));
  }

  async createSupplierPayment(data: InsertSupplierPayment) {
    const [payment] = await db.insert(supplierPayments).values(data).returning();
    if (data.supplierId) {
      const supplier = await this.getSupplier(data.supplierId);
      if (supplier) {
        const newBalance = parseFloat(supplier.currentBalance) - parseFloat(String(data.amount));
        await this.updateSupplier(data.supplierId, { currentBalance: newBalance.toFixed(2) });
      }
    }
    // If linked to a purchase invoice, check if fully paid and mark it "paid"
    if (data.purchaseInvoiceId) {
      const paymentsForPI = await db
        .select()
        .from(supplierPayments)
        .where(eq(supplierPayments.purchaseInvoiceId, data.purchaseInvoiceId));
      const totalPaid = paymentsForPI.reduce((s, p) => s + parseFloat(String(p.amount)), 0);
      const [pi] = await db.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, data.purchaseInvoiceId));
      if (pi && totalPaid >= parseFloat(String(pi.total))) {
        await db.update(purchaseInvoices).set({ status: "paid" }).where(eq(purchaseInvoices.id, data.purchaseInvoiceId));
      }
    }
    return payment;
  }

  async updateSupplierPayment(id: string, data: Partial<InsertSupplierPayment>) {
    const [existing] = await db.select().from(supplierPayments).where(eq(supplierPayments.id, id));
    if (!existing) throw new Error("Payment not found");
    const [updated] = await db.update(supplierPayments).set(data).where(eq(supplierPayments.id, id)).returning();
    if (data.amount !== undefined && existing.supplierId) {
      const oldAmount = parseFloat(String(existing.amount));
      const newAmount = parseFloat(String(data.amount));
      const diff = newAmount - oldAmount;
      if (diff !== 0) {
        const supplier = await this.getSupplier(existing.supplierId);
        if (supplier) {
          const newBalance = parseFloat(supplier.currentBalance) + diff;
          await this.updateSupplier(existing.supplierId, { currentBalance: Math.max(0, newBalance).toFixed(2) });
        }
      }
    }
    return updated;
  }

  async getEmailLogs() {
    return db.select().from(emailLogs).orderBy(desc(emailLogs.createdAt));
  }

  async getEmailLogsByCustomer(customerId: string) {
    return db.select().from(emailLogs).where(eq(emailLogs.customerId, customerId)).orderBy(desc(emailLogs.createdAt));
  }

  async createEmailLog(data: InsertEmailLog) {
    const [log] = await db.insert(emailLogs).values(data).returning();
    return log;
  }

  // Accounting
  async getAccounts() {
    return db.select().from(accounts).orderBy(accounts.code);
  }

  async getAccount(id: string) {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
    return account;
  }

  async getAccountByCode(code: string) {
    const [account] = await db.select().from(accounts).where(eq(accounts.code, code));
    return account;
  }

  async createAccount(data: InsertAccount) {
    const [account] = await db.insert(accounts).values(data).returning();
    return account;
  }

  async updateAccount(id: string, data: Partial<InsertAccount>) {
    const [account] = await db.update(accounts).set(data).where(eq(accounts.id, id)).returning();
    return account;
  }

  async getJournalEntries() {
    return db.select().from(journalEntries).orderBy(desc(journalEntries.date), desc(journalEntries.createdAt));
  }

  async getJournalEntry(id: string) {
    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
    if (!entry) return undefined;

    const lines = await db
      .select({
        id: journalEntryLines.id,
        journalEntryId: journalEntryLines.journalEntryId,
        accountId: journalEntryLines.accountId,
        debit: journalEntryLines.debit,
        credit: journalEntryLines.credit,
        description: journalEntryLines.description,
        accountName: accounts.name,
        accountCode: accounts.code,
      })
      .from(journalEntryLines)
      .leftJoin(accounts, eq(journalEntryLines.accountId, accounts.id))
      .where(eq(journalEntryLines.journalEntryId, id));

    return { ...entry, lines };
  }

  async createJournalEntry(data: InsertJournalEntry, lines: InsertJournalEntryLine[]) {
    const [entry] = await db.insert(journalEntries).values(data).returning();

    if (lines.length > 0) {
      const linesWithEntry = lines.map(l => ({ ...l, journalEntryId: entry.id }));
      await db.insert(journalEntryLines).values(linesWithEntry);
    }

    for (const line of lines) {
      const debitAmt = parseFloat(String(line.debit || "0"));
      const creditAmt = parseFloat(String(line.credit || "0"));
      if (debitAmt === 0 && creditAmt === 0) continue;

      const [acct] = await db.select().from(accounts).where(eq(accounts.id, line.accountId));
      if (!acct) continue;

      const currentBal = parseFloat(acct.balance);
      let newBal = currentBal;
      if (acct.type === "asset" || acct.type === "expense") {
        newBal += debitAmt - creditAmt;
      } else {
        newBal += creditAmt - debitAmt;
      }
      await db.update(accounts).set({ balance: newBal.toFixed(2) }).where(eq(accounts.id, line.accountId));
    }

    return entry;
  }

  async getNextJournalEntryNumber() {
    const [result] = await db.select({
      maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(entry_number FROM 4) AS INTEGER)), 0)`
    }).from(journalEntries);
    const num = (result?.maxNum || 0) + 1;
    return `JE-${String(num).padStart(5, "0")}`;
  }

  async getExpenses() {
    const result = await db
      .select({
        id: expenses.id,
        date: expenses.date,
        expenseAccountId: expenses.expenseAccountId,
        paymentAccountId: expenses.paymentAccountId,
        amount: expenses.amount,
        vatAmount: expenses.vatAmount,
        description: expenses.description,
        reference: expenses.reference,
        paymentMethod: expenses.paymentMethod,
        supplierId: expenses.supplierId,
        journalEntryId: expenses.journalEntryId,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .orderBy(desc(expenses.date), desc(expenses.createdAt));

    const allAccts = await this.getAccounts();
    const allSuppliers = await this.getSuppliers();
    const acctMap = Object.fromEntries(allAccts.map(a => [a.id, a.name]));
    const supplierMap = Object.fromEntries(allSuppliers.map(s => [s.id, s.name]));

    return result.map(r => ({
      ...r,
      expenseAccountName: acctMap[r.expenseAccountId],
      paymentAccountName: acctMap[r.paymentAccountId],
      supplierName: r.supplierId ? supplierMap[r.supplierId] : undefined,
    }));
  }

  async createExpense(data: InsertExpense) {
    const [expense] = await db.insert(expenses).values(data).returning();
    return expense;
  }

  async getGeneralLedger(accountId: string, from: string, to: string) {
    const openingLines = await db
      .select({
        debit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), '0')`,
        credit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), '0')`,
      })
      .from(journalEntryLines)
      .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
      .where(and(
        eq(journalEntryLines.accountId, accountId),
        lt(journalEntries.date, from),
        eq(journalEntries.status, "posted"),
      ));

    const [acct] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    const debitTotal = parseFloat(openingLines[0]?.debit || "0");
    const creditTotal = parseFloat(openingLines[0]?.credit || "0");
    let openingBalance = 0;
    if (acct && (acct.type === "asset" || acct.type === "expense")) {
      openingBalance = debitTotal - creditTotal;
    } else {
      openingBalance = creditTotal - debitTotal;
    }

    const entries = await db
      .select({
        date: journalEntries.date,
        entryNumber: journalEntries.entryNumber,
        description: journalEntries.description,
        reference: journalEntries.reference,
        debit: journalEntryLines.debit,
        credit: journalEntryLines.credit,
        lineDescription: journalEntryLines.description,
        journalEntryId: journalEntries.id,
      })
      .from(journalEntryLines)
      .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
      .where(and(
        eq(journalEntryLines.accountId, accountId),
        gte(journalEntries.date, from),
        lte(journalEntries.date, to),
        eq(journalEntries.status, "posted"),
      ))
      .orderBy(journalEntries.date, journalEntries.createdAt);

    return { entries, openingBalance: openingBalance.toFixed(2) };
  }

  async getTrialBalance() {
    const allAccounts = await db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
      .from(accounts)
      .where(eq(accounts.active, true))
      .orderBy(accounts.code);

    const lineTotals = await db.select({
      accountId: journalEntryLines.accountId,
      totalDebit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), '0')`,
      totalCredit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), '0')`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(eq(journalEntries.status, "posted"))
    .groupBy(journalEntryLines.accountId);

    const totalsMap = new Map(lineTotals.map(r => [r.accountId, { d: parseFloat(r.totalDebit), c: parseFloat(r.totalCredit) }]));

    let totalDebits = 0;
    let totalCredits = 0;
    const accts = allAccounts.map(a => {
      const t = totalsMap.get(a.id) || { d: 0, c: 0 };
      let debit = "0.00";
      let credit = "0.00";
      if (t.d > t.c) {
        debit = (t.d - t.c).toFixed(2);
        totalDebits += t.d - t.c;
      } else if (t.c > t.d) {
        credit = (t.c - t.d).toFixed(2);
        totalCredits += t.c - t.d;
      }
      return { ...a, balance: (t.d - t.c).toFixed(2), debit, credit };
    }).filter(a => a.debit !== "0.00" || a.credit !== "0.00");

    return { accounts: accts, totalDebits: totalDebits.toFixed(2), totalCredits: totalCredits.toFixed(2) };
  }

  async getProfitAndLoss(from: string, to: string) {
    const revenueAccounts = await db.select().from(accounts)
      .where(and(eq(accounts.type, "revenue"), eq(accounts.active, true)))
      .orderBy(accounts.code);

    const expenseAccounts = await db.select().from(accounts)
      .where(and(eq(accounts.type, "expense"), eq(accounts.active, true)))
      .orderBy(accounts.code);

    const getAccountPeriodBalance = async (accountId: string, type: string) => {
      const [result] = await db.select({
        debit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), '0')`,
        credit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), '0')`,
      })
      .from(journalEntryLines)
      .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
      .where(and(
        eq(journalEntryLines.accountId, accountId),
        gte(journalEntries.date, from),
        lte(journalEntries.date, to),
        eq(journalEntries.status, "posted"),
      ));

      const d = parseFloat(result?.debit || "0");
      const c = parseFloat(result?.credit || "0");
      if (type === "revenue") return (c - d).toFixed(2);
      return (d - c).toFixed(2);
    };

    const revenue = await Promise.all(revenueAccounts.map(async a => ({
      ...a,
      periodBalance: await getAccountPeriodBalance(a.id, "revenue"),
    })));

    const expensesList = await Promise.all(expenseAccounts.map(async a => ({
      ...a,
      periodBalance: await getAccountPeriodBalance(a.id, "expense"),
    })));

    const totalRevenue = revenue.reduce((s, a) => s + parseFloat(a.periodBalance), 0);
    const totalExpenses = expensesList.reduce((s, a) => s + parseFloat(a.periodBalance), 0);

    return {
      revenue: revenue.filter(a => parseFloat(a.periodBalance) !== 0),
      expenses: expensesList.filter(a => parseFloat(a.periodBalance) !== 0),
      totalRevenue: totalRevenue.toFixed(2),
      totalExpenses: totalExpenses.toFixed(2),
      netIncome: (totalRevenue - totalExpenses).toFixed(2),
    };
  }

  async getBalanceSheet(asOf: string) {
    const allAccounts = await db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
      .from(accounts)
      .where(eq(accounts.active, true))
      .orderBy(accounts.code);

    // Compute balances from journal entry lines up to asOf date
    const lineTotals = await db.select({
      accountId: journalEntryLines.accountId,
      totalDebit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), '0')`,
      totalCredit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), '0')`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(and(eq(journalEntries.status, "posted"), lte(journalEntries.date, asOf)))
    .groupBy(journalEntryLines.accountId);

    const totalsMap = new Map(lineTotals.map(r => [r.accountId, { d: parseFloat(r.totalDebit), c: parseFloat(r.totalCredit) }]));

    const getBalance = (accountId: string, type: string): number => {
      const t = totalsMap.get(accountId) || { d: 0, c: 0 };
      if (type === "asset" || type === "expense") return t.d - t.c;
      return t.c - t.d; // liability, equity, revenue: credit-normal
    };

    const assetAccounts = allAccounts.filter(a => a.type === "asset")
      .map(a => ({ ...a, balance: getBalance(a.id, "asset").toFixed(2) }))
      .filter(a => parseFloat(a.balance) !== 0);

    const liabilityAccounts = allAccounts.filter(a => a.type === "liability")
      .map(a => ({ ...a, balance: getBalance(a.id, "liability").toFixed(2) }))
      .filter(a => parseFloat(a.balance) !== 0);

    const equityAccounts = allAccounts.filter(a => a.type === "equity")
      .map(a => ({ ...a, balance: getBalance(a.id, "equity").toFixed(2) }))
      .filter(a => parseFloat(a.balance) !== 0);

    // Net income (revenue - expenses) must be included in equity to balance the sheet
    const revenueTotal = allAccounts.filter(a => a.type === "revenue")
      .reduce((s, a) => s + getBalance(a.id, "revenue"), 0);
    const expenseTotal = allAccounts.filter(a => a.type === "expense")
      .reduce((s, a) => s + getBalance(a.id, "expense"), 0);
    const netIncome = revenueTotal - expenseTotal;

    const totalAssets = assetAccounts.reduce((s, a) => s + parseFloat(a.balance), 0);
    const totalLiabilities = liabilityAccounts.reduce((s, a) => s + parseFloat(a.balance), 0);
    const totalEquityAccounts = equityAccounts.reduce((s, a) => s + parseFloat(a.balance), 0);
    const totalEquity = totalEquityAccounts + netIncome;

    return {
      assets: assetAccounts,
      liabilities: liabilityAccounts,
      equity: equityAccounts,
      netIncome: netIncome.toFixed(2),
      totalAssets: totalAssets.toFixed(2),
      totalLiabilities: totalLiabilities.toFixed(2),
      totalEquity: totalEquity.toFixed(2),
    };
  }
}

export const storage = new DatabaseStorage();
