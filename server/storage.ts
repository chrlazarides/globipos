import { db } from "./db";
import { eq, and, gte, lte, desc, sql, ilike, or } from "drizzle-orm";
import {
  users, categories, items, customers, priceContracts, priceContractItems,
  seasonalOffers, seasonalOfferItems, invoices, invoiceItems, payments,
  portalOrders, portalOrderItems,
  type InsertUser, type User, type InsertCategory, type Category,
  type InsertItem, type Item, type InsertCustomer, type Customer,
  type InsertPriceContract, type PriceContract,
  type InsertPriceContractItem, type PriceContractItem,
  type InsertSeasonalOffer, type SeasonalOffer,
  type InsertSeasonalOfferItem, type SeasonalOfferItem,
  type InsertInvoice, type Invoice, type InsertInvoiceItem, type InvoiceItem,
  type InsertPayment, type Payment,
  type InsertPortalOrder, type PortalOrder,
  type InsertPortalOrderItem, type PortalOrderItem,
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

  getPriceContracts(): Promise<(PriceContract & { customerName?: string })[]>;
  getPriceContract(id: string): Promise<PriceContract | undefined>;
  createPriceContract(data: InsertPriceContract): Promise<PriceContract>;

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

  getCustomerByCode(code: string): Promise<Customer | undefined>;
  getCustomerInvoices(customerId: string): Promise<(Invoice & { items: InvoiceItem[] })[]>;
  getPortalOrders(customerId: string): Promise<(PortalOrder & { items: PortalOrderItem[] })[]>;
  createPortalOrder(data: InsertPortalOrder, lineItems: InsertPortalOrderItem[]): Promise<PortalOrder>;
  getAvailableItems(): Promise<Item[]>;
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
        minQuantity: priceContracts.minQuantity,
        active: priceContracts.active,
        customerName: customers.name,
      })
      .from(priceContracts)
      .leftJoin(customers, eq(priceContracts.customerId, customers.id))
      .orderBy(desc(priceContracts.startDate));
    return result.map(r => ({ ...r, customerName: r.customerName || undefined }));
  }
  async getPriceContract(id: string) {
    const [contract] = await db.select().from(priceContracts).where(eq(priceContracts.id, id));
    return contract;
  }
  async createPriceContract(data: InsertPriceContract) {
    const [contract] = await db.insert(priceContracts).values(data).returning();
    return contract;
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
    const prefix = type === "credit_note" ? "CN" : type === "proforma" ? "PF" : "INV";
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(eq(invoices.type, type));
    const num = (result?.count || 0) + 1;
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
}

export const storage = new DatabaseStorage();
