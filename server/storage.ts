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
  createPayment(data: InsertPayment): Promise<Payment>;

  getDashboardStats(): Promise<any>;
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
    return db.select().from(customers).orderBy(customers.name);
  }
  async getCustomer(id: string) {
    const [cust] = await db.select().from(customers).where(eq(customers.id, id));
    return cust;
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

  async createPayment(data: InsertPayment) {
    const [payment] = await db.insert(payments).values(data).returning();
    return payment;
  }

  async getDashboardStats() {
    const [itemCount] = await db.select({ count: sql<number>`count(*)` }).from(items).where(eq(items.active, true));
    const [custCount] = await db.select({ count: sql<number>`count(*)` }).from(customers).where(eq(customers.active, true));
    const [invCount] = await db.select({ count: sql<number>`count(*)` }).from(invoices).where(eq(invoices.type, "invoice"));
    const [overdueCount] = await db.select({ count: sql<number>`count(*)` }).from(invoices).where(and(eq(invoices.status, "overdue"), eq(invoices.type, "invoice")));
    const [revenue] = await db.select({ total: sql<string>`coalesce(sum(${invoices.total}::numeric), 0)` }).from(invoices).where(and(eq(invoices.type, "invoice"), eq(invoices.status, "paid")));

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
      totalRevenue: revenue?.total || "0",
      lowStockItems,
      recentInvoices: recentInvs.map(r => ({ ...r, customerName: r.customerName || "Unknown" })),
    };
  }

  async getSalesReport(from: string, to: string, customerId?: string) {
    let conditions = [
      eq(invoices.type, "invoice"),
      gte(invoices.date, from),
      lte(invoices.date, to),
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
    const statements = [];
    for (const cust of custs) {
      const allInvs = await db.select().from(invoices).where(eq(invoices.customerId, cust.id));
      const invs = allInvs.filter(i => i.type === "invoice");
      const cns = allInvs.filter(i => i.type === "credit_note");

      const totalInvoiced = invs.reduce((s, i) => s + parseFloat(i.total), 0);
      const totalCredits = cns.reduce((s, i) => s + parseFloat(i.total), 0);
      const paidInvs = invs.filter(i => i.status === "paid");
      const totalPaid = paidInvs.reduce((s, i) => s + parseFloat(i.total), 0);

      const invoiceList = allInvs.map(inv => {
        const total = parseFloat(inv.total);
        const paid = inv.status === "paid" ? total : 0;
        return {
          invoiceNumber: inv.invoiceNumber,
          date: inv.date,
          type: inv.type,
          status: inv.status,
          dueDate: inv.dueDate,
          total: total.toFixed(2),
          paid: paid.toFixed(2),
          balance: (total - paid).toFixed(2),
        };
      });

      statements.push({
        customerId: cust.id,
        customerName: cust.name,
        totalInvoiced: totalInvoiced.toFixed(2),
        totalCredits: totalCredits.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        balance: (totalInvoiced - totalCredits - totalPaid).toFixed(2),
        invoiceCount: allInvs.length,
        invoices: invoiceList,
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
        createdAt: supplierPayments.createdAt,
        supplierName: suppliers.name,
      })
      .from(supplierPayments)
      .leftJoin(suppliers, eq(supplierPayments.supplierId, suppliers.id))
      .orderBy(desc(supplierPayments.createdAt));

    if (supplierId) {
      query = query.where(eq(supplierPayments.supplierId, supplierId)) as any;
    }

    const result = await query;
    return result.map(r => ({ ...r, supplierName: r.supplierName || undefined }));
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
    return payment;
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
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(journalEntries);
    const num = (result?.count || 0) + 1;
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
      .select({
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
        type: accounts.type,
        balance: accounts.balance,
      })
      .from(accounts)
      .where(eq(accounts.active, true))
      .orderBy(accounts.code);

    let totalDebits = 0;
    let totalCredits = 0;
    const accts = allAccounts.map(a => {
      const bal = parseFloat(a.balance);
      let debit = "0.00";
      let credit = "0.00";
      if (a.type === "asset" || a.type === "expense") {
        if (bal >= 0) { debit = bal.toFixed(2); totalDebits += bal; }
        else { credit = Math.abs(bal).toFixed(2); totalCredits += Math.abs(bal); }
      } else {
        if (bal >= 0) { credit = bal.toFixed(2); totalCredits += bal; }
        else { debit = Math.abs(bal).toFixed(2); totalDebits += Math.abs(bal); }
      }
      return { ...a, debit, credit };
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
    const allAccounts = await db.select().from(accounts)
      .where(eq(accounts.active, true))
      .orderBy(accounts.code);

    const assetAccounts = allAccounts.filter(a => a.type === "asset");
    const liabilityAccounts = allAccounts.filter(a => a.type === "liability");
    const equityAccounts = allAccounts.filter(a => a.type === "equity");

    const totalAssets = assetAccounts.reduce((s, a) => s + parseFloat(a.balance), 0);
    const totalLiabilities = liabilityAccounts.reduce((s, a) => s + parseFloat(a.balance), 0);
    const totalEquity = equityAccounts.reduce((s, a) => s + parseFloat(a.balance), 0);

    return {
      assets: assetAccounts.filter(a => parseFloat(a.balance) !== 0),
      liabilities: liabilityAccounts.filter(a => parseFloat(a.balance) !== 0),
      equity: equityAccounts.filter(a => parseFloat(a.balance) !== 0),
      totalAssets: totalAssets.toFixed(2),
      totalLiabilities: totalLiabilities.toFixed(2),
      totalEquity: totalEquity.toFixed(2),
    };
  }
}

export const storage = new DatabaseStorage();
