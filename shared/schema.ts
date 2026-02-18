import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, numeric, boolean, timestamp, date, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const systemSettings = pgTable("system_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  label: text("label").notNull(),
  group: text("group").notNull().default("general"),
});

export const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  parentId: varchar("parent_id"),
  active: boolean("active").default(true).notNull(),
});

export const items = pgTable("items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  barcode: text("barcode"),
  description: text("description"),
  categoryId: varchar("category_id"),
  unitType: text("unit_type").notNull().default("pc"),
  packSize: integer("pack_size").notNull().default(1),
  price1: numeric("price_1", { precision: 10, scale: 2 }).notNull().default("0"),
  price2: numeric("price_2", { precision: 10, scale: 2 }).notNull().default("0"),
  price3: numeric("price_3", { precision: 10, scale: 2 }).notNull().default("0"),
  price4: numeric("price_4", { precision: 10, scale: 2 }).notNull().default("0"),
  price5: numeric("price_5", { precision: 10, scale: 2 }).notNull().default("0"),
  costPrice: numeric("cost_price", { precision: 10, scale: 2 }).notNull().default("0"),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("19"),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(10),
  volume: text("volume"),
  alcoholPercentage: numeric("alcohol_percentage", { precision: 4, scale: 1 }),
  origin: text("origin"),
  vintage: text("vintage"),
  active: boolean("active").default(true).notNull(),
});

export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  taxId: text("tax_id"),
  paymentTerms: text("payment_terms").notNull().default("cash"),
  creditLimit: numeric("credit_limit", { precision: 12, scale: 2 }).notNull().default("0"),
  currentBalance: numeric("current_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  priceLevel: integer("price_level").notNull().default(1),
  notes: text("notes"),
  portalAccessCode: text("portal_access_code"),
  active: boolean("active").default(true).notNull(),
});

export const portalOrders = pgTable("portal_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull(),
  status: text("status").notNull().default("pending"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const portalOrderItems = pgTable("portal_order_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull(),
  itemId: varchar("item_id").notNull(),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
});

export const priceContracts = pgTable("price_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull(),
  name: text("name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  discountType: text("discount_type").notNull().default("percentage"),
  discountValue: numeric("discount_value", { precision: 10, scale: 2 }).notNull().default("0"),
  minQuantity: integer("min_quantity").default(0),
  active: boolean("active").default(true).notNull(),
});

export const priceContractItems = pgTable("price_contract_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull(),
  itemId: varchar("item_id").notNull(),
  specialPrice: numeric("special_price", { precision: 10, scale: 2 }).notNull(),
});

export const seasonalOffers = pgTable("seasonal_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  discountPercentage: numeric("discount_percentage", { precision: 5, scale: 2 }).notNull(),
  minItems: integer("min_items").default(1),
  mixMatch: boolean("mix_match").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
});

export const seasonalOfferItems = pgTable("seasonal_offer_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  offerId: varchar("offer_id").notNull(),
  itemId: varchar("item_id").notNull(),
  requiredQuantity: integer("required_quantity").default(1),
});

export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceNumber: text("invoice_number").notNull().unique(),
  type: text("type").notNull().default("invoice"),
  customerId: varchar("customer_id").notNull(),
  date: date("date").notNull(),
  dueDate: date("due_date"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  linkedInvoiceId: varchar("linked_invoice_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const invoiceItems = pgTable("invoice_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull(),
  itemId: varchar("item_id"),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  saleUnit: text("sale_unit").notNull().default("pc"),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 10, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
});

export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"),
  reference: text("reference"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true });
export const insertSystemSettingSchema = createInsertSchema(systemSettings).omit({ id: true });
export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export const insertItemSchema = createInsertSchema(items).omit({ id: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true });
export const insertPriceContractSchema = createInsertSchema(priceContracts).omit({ id: true });
export const insertPriceContractItemSchema = createInsertSchema(priceContractItems).omit({ id: true });
export const insertSeasonalOfferSchema = createInsertSchema(seasonalOffers).omit({ id: true });
export const insertSeasonalOfferItemSchema = createInsertSchema(seasonalOfferItems).omit({ id: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true });
export const insertInvoiceItemSchema = createInsertSchema(invoiceItems).omit({ id: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true });
export const insertPortalOrderSchema = createInsertSchema(portalOrders).omit({ id: true, createdAt: true });
export const insertPortalOrderItemSchema = createInsertSchema(portalOrderItems).omit({ id: true });

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;
export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;
export type InsertItem = z.infer<typeof insertItemSchema>;
export type Item = typeof items.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;
export type InsertPriceContract = z.infer<typeof insertPriceContractSchema>;
export type PriceContract = typeof priceContracts.$inferSelect;
export type InsertPriceContractItem = z.infer<typeof insertPriceContractItemSchema>;
export type PriceContractItem = typeof priceContractItems.$inferSelect;
export type InsertSeasonalOffer = z.infer<typeof insertSeasonalOfferSchema>;
export type SeasonalOffer = typeof seasonalOffers.$inferSelect;
export type InsertSeasonalOfferItem = z.infer<typeof insertSeasonalOfferItemSchema>;
export type SeasonalOfferItem = typeof seasonalOfferItems.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;
export type InsertPortalOrder = z.infer<typeof insertPortalOrderSchema>;
export type PortalOrder = typeof portalOrders.$inferSelect;
export type InsertPortalOrderItem = z.infer<typeof insertPortalOrderItemSchema>;
export type PortalOrderItem = typeof portalOrderItems.$inferSelect;
