import { db } from "./db";
import { eq, and, gte, lte, desc, sql, ilike, or } from "drizzle-orm";
import {
  users, categories, items, customers, priceContracts, priceContractItems, priceContractRules,
  seasonalOffers, seasonalOfferItems, invoices, invoiceItems, payments,
  portalOrders, portalOrderItems, systemSettings,
  suppliers, purchaseInvoices, purchaseInvoiceItems, supplierPayments,
  emailLogs,
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
  getNextPurchaseInvoiceNumber(): Promise<string>;

  getSupplierPayments(supplierId?: string): Promise<(SupplierPayment & { supplierName?: string })[]>;
  createSupplierPayment(data: InsertSupplierPayment): Promise<SupplierPayment>;

  getEmailLogs(): Promise<EmailLog[]>;
  getEmailLogsByCustomer(customerId: string): Promise<EmailLog[]>;
  createEmailLog(data: InsertEmailLog): Promise<EmailLog>;
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
    const invoiceNumber = await this.getNextInvoiceNumber(data.type);
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

    const totalSales = invs.reduce((s, i) => s + parseFloat(i.total), 0);
    const totalTax = invs.reduce((s, i) => s + parseFloat(i.taxAmount), 0);

    return {
      invoices: invs.map(r => ({ ...r, customerName: r.customerName || "Unknown" })),
      totalSales: totalSales.toFixed(2),
      totalTax: totalTax.toFixed(2),
      invoiceCount: invs.length,
    };
  }

  async getCustomerStatements() {
    const custs = await db.select().from(customers).where(eq(customers.active, true));
    const statements = [];
    for (const cust of custs) {
      const invs = await db.select().from(invoices).where(and(eq(invoices.customerId, cust.id), eq(invoices.type, "invoice")));
      const totalInvoiced = invs.reduce((s, i) => s + parseFloat(i.total), 0);
      const paidInvs = invs.filter(i => i.status === "paid");
      const totalPaid = paidInvs.reduce((s, i) => s + parseFloat(i.total), 0);

      statements.push({
        customerId: cust.id,
        customerName: cust.name,
        totalInvoiced: totalInvoiced.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        balance: (totalInvoiced - totalPaid).toFixed(2),
        invoiceCount: invs.length,
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
}

export const storage = new DatabaseStorage();
