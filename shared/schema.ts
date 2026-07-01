import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, numeric, boolean, timestamp, date, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email"),
  password: text("password").notNull(),
  role: text("role").notNull().default("staff"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at"),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  permissions: text("permissions").default("[]"),
});

export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  username: text("username"),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  description: text("description"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }),
  active: boolean("active").default(true).notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
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
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(10),
  volume: text("volume"),
  alcoholPercentage: numeric("alcohol_percentage", { precision: 4, scale: 1 }),
  brand: text("brand"),
  origin: text("origin"),
  vintage: text("vintage"),
  active: boolean("active").default(true).notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
});

export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  contactFirstName: text("contact_first_name"),
  contactLastName: text("contact_last_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  taxId: text("tax_id"),
  paymentTerms: text("payment_terms").notNull().default("cash"),
  creditLimit: numeric("credit_limit", { precision: 12, scale: 2 }).notNull().default("0"),
  currentBalance: numeric("current_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  openingBalance: numeric("opening_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  priceLevel: integer("price_level").notNull().default(1),
  notes: text("notes"),
  location: text("location"),
  portalAccessCode: text("portal_access_code"),
  active: boolean("active").default(true).notNull(),
  cashbackBalance: numeric("cashback_balance", { precision: 10, scale: 2 }).default("0"),
});

export const portalOrders = pgTable("portal_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull(),
  status: text("status").notNull().default("pending"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  cashbackApplied: numeric("cashback_applied", { precision: 10, scale: 2 }).default("0"),
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
  categoryId: varchar("category_id"),
  brand: text("brand"),
  categoryIds: text("category_ids").array().default([]),
  brands: text("brands").array().default([]),
  minQuantity: integer("min_quantity").default(0),
  purchaseGoal: numeric("purchase_goal", { precision: 12, scale: 2 }).default("0"),
  voucherType: text("voucher_type").default("percentage"),
  voucherValue: numeric("voucher_value", { precision: 10, scale: 2 }).default("0"),
  active: boolean("active").default(true).notNull(),
  source: text("source").default("manual"),
});

export const priceContractRules = pgTable("price_contract_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull(),
  categoryIds: text("rule_category_ids").array().default([]),
  brands: text("rule_brands").array().default([]),
  minQuantity: integer("rule_min_quantity").default(0),
  discountType: text("rule_discount_type").notNull().default("percentage"),
  discountValue: numeric("rule_discount_value", { precision: 10, scale: 2 }).notNull().default("0"),
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
  deliveryLocation: text("delivery_location"),
  linkedInvoiceId: varchar("linked_invoice_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const invoiceItems = pgTable("invoice_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull(),
  itemId: varchar("item_id"),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  saleUnit: text("sale_unit").notNull().default("pc"),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 10, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
});

export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id"),
  invoiceId: varchar("invoice_id"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"),
  reference: text("reference"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const suppliers = pgTable("suppliers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  contactPerson: text("contact_person"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  country: text("country").default("Cyprus"),
  taxId: text("tax_id"),
  iban: text("iban"),
  swift: text("swift"),
  bankName: text("bank_name"),
  paymentTerms: text("payment_terms").notNull().default("cash"),
  currentBalance: numeric("current_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  active: boolean("active").default(true).notNull(),
});

export const purchaseInvoices = pgTable("purchase_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceNumber: text("invoice_number").notNull(),
  supplierInvoiceRef: text("supplier_invoice_ref"),
  supplierId: varchar("supplier_id").notNull(),
  date: date("date").notNull(),
  dueDate: date("due_date"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const purchaseInvoiceItems = pgTable("purchase_invoice_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseInvoiceId: varchar("purchase_invoice_id").notNull(),
  itemId: varchar("item_id").notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  purchaseUnit: text("purchase_unit").notNull().default("pc"),
  unitCost: numeric("unit_cost", { precision: 10, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 10, scale: 2 }).notNull().default("0"),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("19"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
});

export const supplierPayments = pgTable("supplier_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  supplierId: varchar("supplier_id").notNull(),
  purchaseInvoiceId: varchar("purchase_invoice_id"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: text("payment_method").notNull().default("bank_transfer"),
  reference: text("reference"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const emailLogs = pgTable("email_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id"),
  customerId: varchar("customer_id"),
  customerName: text("customer_name"),
  toEmail: text("to_email").notNull(),
  fromEmail: text("from_email"),
  replyTo: text("reply_to"),
  subject: text("subject").notNull(),
  status: text("status").notNull().default("sent"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Accounting Module
export const accounts = pgTable("accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").notNull(), // asset, liability, equity, revenue, expense
  subtype: text("subtype"), // e.g. current_asset, fixed_asset, current_liability, etc.
  parentId: varchar("parent_id"),
  description: text("description"),
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  isSystem: boolean("is_system").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

export const journalEntries = pgTable("journal_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entryNumber: text("entry_number").notNull().unique(),
  date: date("date").notNull(),
  description: text("description").notNull(),
  reference: text("reference"),
  sourceType: text("source_type"), // manual, invoice, payment, purchase, supplier_payment, expense, credit_note
  sourceId: varchar("source_id"),
  status: text("status").notNull().default("posted"), // posted, draft
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const journalEntryLines = pgTable("journal_entry_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  journalEntryId: varchar("journal_entry_id").notNull(),
  accountId: varchar("account_id").notNull(),
  debit: numeric("debit", { precision: 12, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 12, scale: 2 }).notNull().default("0"),
  description: text("description"),
});

export const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: date("date").notNull(),
  expenseAccountId: varchar("expense_account_id").notNull(),
  paymentAccountId: varchar("payment_account_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  description: text("description").notNull(),
  reference: text("reference"),
  paymentMethod: text("payment_method").notNull().default("cash"),
  supplierId: varchar("supplier_id"),
  journalEntryId: varchar("journal_entry_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const accountingSnapshots = pgTable("accounting_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdByUsername: text("created_by_username"),
  accountBalances: text("account_balances").notNull(), // JSON: [{id,code,name,type,balance}]
  journalEntryCount: integer("journal_entry_count").notNull().default(0),
  lastEntryNumber: text("last_entry_number"),
  totalDebitVolume: numeric("total_debit_volume", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
});

// Insert schemas
export const insertAccountingSnapshotSchema = createInsertSchema(accountingSnapshots).omit({ id: true, createdAt: true });
export type InsertAccountingSnapshot = z.infer<typeof insertAccountingSnapshotSchema>;
export type AccountingSnapshot = typeof accountingSnapshots.$inferSelect;

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, lastLoginAt: true });
export const insertSystemSettingSchema = createInsertSchema(systemSettings).omit({ id: true });
export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export const insertItemSchema = createInsertSchema(items).omit({ id: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true }).extend({
  code: z.string().optional().default(""),
});
export const insertPriceContractSchema = createInsertSchema(priceContracts).omit({ id: true });
export const insertPriceContractRuleSchema = createInsertSchema(priceContractRules).omit({ id: true });
export const insertPriceContractItemSchema = createInsertSchema(priceContractItems).omit({ id: true });
export const insertSeasonalOfferSchema = createInsertSchema(seasonalOffers).omit({ id: true });
export const insertSeasonalOfferItemSchema = createInsertSchema(seasonalOfferItems).omit({ id: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true });
export const insertInvoiceItemSchema = createInsertSchema(invoiceItems).omit({ id: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true });
export const insertPortalOrderSchema = createInsertSchema(portalOrders).omit({ id: true, createdAt: true });
export const insertPortalOrderItemSchema = createInsertSchema(portalOrderItems).omit({ id: true });
export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true });
export const insertPurchaseInvoiceSchema = createInsertSchema(purchaseInvoices).omit({ id: true, createdAt: true });
export const insertPurchaseInvoiceItemSchema = createInsertSchema(purchaseInvoiceItems).omit({ id: true });
export const insertSupplierPaymentSchema = createInsertSchema(supplierPayments).omit({ id: true, createdAt: true });
export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({ id: true, createdAt: true });
export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true });
export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({ id: true, createdAt: true });
export const insertJournalEntryLineSchema = createInsertSchema(journalEntryLines).omit({ id: true });
export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true, createdAt: true });

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
export type InsertPriceContractRule = z.infer<typeof insertPriceContractRuleSchema>;
export type PriceContractRule = typeof priceContractRules.$inferSelect;
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
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliers.$inferSelect;
export type InsertPurchaseInvoice = z.infer<typeof insertPurchaseInvoiceSchema>;
export type PurchaseInvoice = typeof purchaseInvoices.$inferSelect;
export type InsertPurchaseInvoiceItem = z.infer<typeof insertPurchaseInvoiceItemSchema>;
export type PurchaseInvoiceItem = typeof purchaseInvoiceItems.$inferSelect;
export type InsertSupplierPayment = z.infer<typeof insertSupplierPaymentSchema>;
export type SupplierPayment = typeof supplierPayments.$inferSelect;
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type InsertJournalEntryLine = z.infer<typeof insertJournalEntryLineSchema>;
export type JournalEntryLine = typeof journalEntryLines.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expenses.$inferSelect;

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({ id: true, createdAt: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;

export const customerDeliveryLocations = pgTable("customer_delivery_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  lat: numeric("lat", { precision: 10, scale: 7 }),
  lng: numeric("lng", { precision: 10, scale: 7 }),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCustomerDeliveryLocationSchema = createInsertSchema(customerDeliveryLocations).omit({ id: true, createdAt: true });
export type InsertCustomerDeliveryLocation = z.infer<typeof insertCustomerDeliveryLocationSchema>;
export type CustomerDeliveryLocation = typeof customerDeliveryLocations.$inferSelect;

// ─── Version Control Snapshots ────────────────────────────────────────────────
export const versionSnapshots = pgTable("version_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").default(""),
  type: text("type").notNull().default("manual"), // "manual" | "publish"
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  dataSnapshot: text("data_snapshot"),
  appVersion: text("app_version").default("1.0"),
  tableCounts: text("table_counts").default("{}"),
});

export const insertVersionSnapshotSchema = createInsertSchema(versionSnapshots).omit({ id: true, createdAt: true });
export type InsertVersionSnapshot = z.infer<typeof insertVersionSnapshotSchema>;
export type VersionSnapshot = typeof versionSnapshots.$inferSelect;

// ─── GlobiPOS Tables ──────────────────────────────────────────────────────────
export const posLocations = pgTable("pos_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  address: text("address"),
  phone: text("phone"),
  timezone: text("timezone").notNull().default("Europe/Nicosia"),
  currencyCode: text("currency_code").notNull().default("EUR"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posTerminals = pgTable("pos_terminals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").notNull(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  description: text("description"),
  hardwareType: text("hardware_type").notNull().default("desktop"), // desktop | tablet | mobile
  layoutSetId: varchar("layout_set_id"),
  lastSeenAt: timestamp("last_seen_at"),
  lastSyncAt: timestamp("last_sync_at"),
  outboxQueueSize: integer("outbox_queue_size").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posLayoutSets = pgTable("pos_layout_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  locationId: varchar("location_id"),
  columns: integer("columns").notNull().default(4),
  rows: integer("rows").notNull().default(5),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posLayoutButtons = pgTable("pos_layout_buttons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  layoutSetId: varchar("layout_set_id").notNull(),
  position: integer("position").notNull(),
  label: text("label").notNull(),
  color: text("color").default("#6b7280"),
  icon: text("icon"),
  buttonType: text("button_type").notNull().default("item"), // item | category | action | empty
  itemId: varchar("item_id"),
  categoryId: varchar("category_id"),
  actionCode: text("action_code"),
});

export const posOrders = pgTable("pos_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderNumber: text("order_number").notNull().unique(),
  terminalId: varchar("terminal_id").notNull(),
  locationId: varchar("location_id").notNull(),
  shiftId: varchar("shift_id"),
  customerId: varchar("customer_id"),
  cashierId: text("cashier_id"),
  cashierName: text("cashier_name"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  paymentMethod: text("payment_method").notNull().default("cash"),
  amountTendered: numeric("amount_tendered", { precision: 12, scale: 2 }).default("0"),
  changeDue: numeric("change_due", { precision: 12, scale: 2 }).default("0"),
  status: text("status").notNull().default("completed"), // completed | voided | held
  notes: text("notes"),
  receiptPrinted: boolean("receipt_printed").notNull().default(false),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posOrderLines = pgTable("pos_order_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull(),
  itemId: varchar("item_id"),
  description: text("description").notNull(),
  sku: text("sku"),
  barcode: text("barcode"),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
});

export const posShifts = pgTable("pos_shifts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  terminalId: varchar("terminal_id").notNull(),
  locationId: varchar("location_id").notNull(),
  cashierId: text("cashier_id"),
  cashierName: text("cashier_name"),
  openedAt: timestamp("opened_at").notNull(),
  closedAt: timestamp("closed_at"),
  openingFloat: numeric("opening_float", { precision: 12, scale: 2 }).notNull().default("0"),
  closingCash: numeric("closing_cash", { precision: 12, scale: 2 }),
  totalSales: numeric("total_sales", { precision: 12, scale: 2 }).notNull().default("0"),
  totalCash: numeric("total_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  totalCard: numeric("total_card", { precision: 12, scale: 2 }).notNull().default("0"),
  totalVoids: numeric("total_voids", { precision: 12, scale: 2 }).notNull().default("0"),
  transactionCount: integer("transaction_count").notNull().default(0),
  status: text("status").notNull().default("open"), // open | closed
  notes: text("notes"),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posSyncConfig = pgTable("pos_sync_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ruleKey: text("rule_key").notNull().unique(), // e.g. loyalty_earn_offline, loyalty_redeem_offline
  label: text("label").notNull(),
  offlineBehavior: text("offline_behavior").notNull().default("allow"), // allow | block | warn_allow
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const posInbox = pgTable("pos_inbox", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  terminalId: varchar("terminal_id"), // null = all terminals
  locationId: varchar("location_id"), // null = all locations
  itemType: text("item_type").notNull(), // price_change | special_offer | layout_update | manager_message
  payload: text("payload").notNull(), // JSON
  startsAt: timestamp("starts_at"),
  expiresAt: timestamp("expires_at"),
  acknowledged: boolean("acknowledged").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// POS Insert schemas
export const insertPosLocationSchema = createInsertSchema(posLocations).omit({ id: true, createdAt: true });
export type InsertPosLocation = z.infer<typeof insertPosLocationSchema>;
export type PosLocation = typeof posLocations.$inferSelect;

export const insertPosTerminalSchema = createInsertSchema(posTerminals).omit({ id: true, createdAt: true, lastSeenAt: true, lastSyncAt: true });
export type InsertPosTerminal = z.infer<typeof insertPosTerminalSchema>;
export type PosTerminal = typeof posTerminals.$inferSelect;

export const insertPosLayoutSetSchema = createInsertSchema(posLayoutSets).omit({ id: true, createdAt: true });
export type InsertPosLayoutSet = z.infer<typeof insertPosLayoutSetSchema>;
export type PosLayoutSet = typeof posLayoutSets.$inferSelect;

export const insertPosLayoutButtonSchema = createInsertSchema(posLayoutButtons).omit({ id: true });
export type InsertPosLayoutButton = z.infer<typeof insertPosLayoutButtonSchema>;
export type PosLayoutButton = typeof posLayoutButtons.$inferSelect;

export const insertPosOrderSchema = createInsertSchema(posOrders).omit({ id: true, createdAt: true, syncedAt: true });
export type InsertPosOrder = z.infer<typeof insertPosOrderSchema>;
export type PosOrder = typeof posOrders.$inferSelect;

export const insertPosOrderLineSchema = createInsertSchema(posOrderLines).omit({ id: true });
export type InsertPosOrderLine = z.infer<typeof insertPosOrderLineSchema>;
export type PosOrderLine = typeof posOrderLines.$inferSelect;

export const insertPosShiftSchema = createInsertSchema(posShifts).omit({ id: true, createdAt: true, syncedAt: true });
export type InsertPosShift = z.infer<typeof insertPosShiftSchema>;
export type PosShift = typeof posShifts.$inferSelect;

export const insertPosSyncConfigSchema = createInsertSchema(posSyncConfig).omit({ id: true, updatedAt: true });
export type InsertPosSyncConfig = z.infer<typeof insertPosSyncConfigSchema>;
export type PosSyncConfig = typeof posSyncConfig.$inferSelect;

export const insertPosInboxSchema = createInsertSchema(posInbox).omit({ id: true, createdAt: true });
export type InsertPosInbox = z.infer<typeof insertPosInboxSchema>;
export type PosInbox = typeof posInbox.$inferSelect;

// ── POS Phase 3: Promotions, Container Deposits, Returns ──────────────────────

export const posPromotions = pgTable("pos_promotions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").references(() => posLocations.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  type: text("type").notNull().default("buy_n_get_m"), // buy_n_get_m | qty_threshold | meal_deal | coupon | mix_match
  productIds: text("product_ids").array().notNull().default(sql`'{}'`),
  categoryIds: text("category_ids").array().notNull().default(sql`'{}'`),
  thresholdQty: integer("threshold_qty").notNull().default(1),
  getQty: integer("get_qty").notNull().default(0),           // for buy_n_get_m
  thresholdPrice: numeric("threshold_price", { precision: 10, scale: 2 }).notNull().default("0"), // price/unit when qty threshold met
  bundlePrice: numeric("bundle_price", { precision: 10, scale: 2 }).notNull().default("0"),       // meal deal / mix-match total
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  discountFixed: numeric("discount_fixed", { precision: 10, scale: 2 }).notNull().default("0"),
  couponCode: text("coupon_code"),
  priority: integer("priority").notNull().default(0),
  stackable: boolean("stackable").notNull().default(false),
  validFrom: timestamp("valid_from"),
  validUntil: timestamp("valid_until"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const posContainerDeposits = pgTable("pos_container_deposits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 }).notNull(),
  productIds: text("product_ids").array().notNull().default(sql`'{}'`),  // specific items
  categoryIds: text("category_ids").array().notNull().default(sql`'{}'`), // all items in category
  depositSku: text("deposit_sku").notNull().default("DEPOSIT"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posReturnOrders = pgTable("pos_return_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  originalOrderId: varchar("original_order_id").references(() => posOrders.id, { onDelete: "set null" }),
  originalOrderNumber: text("original_order_number"),
  terminalId: varchar("terminal_id").references(() => posTerminals.id, { onDelete: "set null" }),
  locationId: varchar("location_id").references(() => posLocations.id, { onDelete: "set null" }),
  cashierId: varchar("cashier_id"),
  cashierName: text("cashier_name").notNull(),
  refundMethod: text("refund_method").notNull().default("cash"), // cash | card | store_credit | exchange
  refundTotal: numeric("refund_total", { precision: 12, scale: 2 }).notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("completed"), // completed | pending | voided
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posReturnOrderLines = pgTable("pos_return_order_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  returnOrderId: varchar("return_order_id").notNull().references(() => posReturnOrders.id, { onDelete: "cascade" }),
  originalOrderId: varchar("original_order_id"),
  originalLineId: varchar("original_line_id"),
  productId: varchar("product_id"),
  description: text("description").notNull(),
  qty: numeric("qty", { precision: 10, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  restocked: boolean("restocked").notNull().default(true),
});

// ── Customer PWA: Push Subscriptions, Loyalty, OTP tokens ────────────────────

export const customerPushSubscriptions = pgTable("customer_push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customerLoyaltyPoints = pgTable("customer_loyalty_points", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull(),
  points: integer("points").notNull(),
  type: text("type").notNull().default("earn"), // earn | redeem | adjust | expire
  reason: text("reason"),
  sourceType: text("source_type"), // invoice | portal_order | manual
  sourceId: varchar("source_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customerOtpTokens = pgTable("customer_otp_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull(),
  email: text("email").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCustomerPushSubscriptionSchema = createInsertSchema(customerPushSubscriptions).omit({ id: true, createdAt: true });
export type InsertCustomerPushSubscription = z.infer<typeof insertCustomerPushSubscriptionSchema>;
export type CustomerPushSubscription = typeof customerPushSubscriptions.$inferSelect;

export const insertCustomerLoyaltyPointSchema = createInsertSchema(customerLoyaltyPoints).omit({ id: true, createdAt: true });
export type InsertCustomerLoyaltyPoint = z.infer<typeof insertCustomerLoyaltyPointSchema>;
export type CustomerLoyaltyPoint = typeof customerLoyaltyPoints.$inferSelect;

// Insert schemas for Phase 3
export const insertPosPromotionSchema = createInsertSchema(posPromotions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPosPromotion = z.infer<typeof insertPosPromotionSchema>;
export type PosPromotion = typeof posPromotions.$inferSelect;

export const insertPosContainerDepositSchema = createInsertSchema(posContainerDeposits).omit({ id: true, createdAt: true });
export type InsertPosContainerDeposit = z.infer<typeof insertPosContainerDepositSchema>;
export type PosContainerDeposit = typeof posContainerDeposits.$inferSelect;

export const insertPosReturnOrderSchema = createInsertSchema(posReturnOrders).omit({ id: true, createdAt: true, syncedAt: true });
export type InsertPosReturnOrder = z.infer<typeof insertPosReturnOrderSchema>;
export type PosReturnOrder = typeof posReturnOrders.$inferSelect;

export const insertPosReturnOrderLineSchema = createInsertSchema(posReturnOrderLines).omit({ id: true });
export type InsertPosReturnOrderLine = z.infer<typeof insertPosReturnOrderLineSchema>;
export type PosReturnOrderLine = typeof posReturnOrderLines.$inferSelect;

// ── Phase 5: WhatsApp Chatbot & Voice Ordering ─────────────────────────────

export const chatConversations = pgTable("chat_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull(),
  channel: text("channel").notNull().default("portal"), // portal | whatsapp
  waPhoneNumber: text("wa_phone_number"),
  status: text("status").notNull().default("active"), // active | handoff | closed
  handoffStaffId: varchar("handoff_staff_id"),
  handoffAt: timestamp("handoff_at"),
  lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull(),
  role: text("role").notNull().default("user"), // user | bot | staff
  content: text("content").notNull(),
  channel: text("channel").notNull().default("portal"), // portal | whatsapp
  intent: text("intent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const faqEntries = pgTable("faq_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  keywords: text("keywords").array().default([]),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChatConversationSchema = createInsertSchema(chatConversations).omit({ id: true, createdAt: true, lastMessageAt: true });
export type InsertChatConversation = z.infer<typeof insertChatConversationSchema>;
export type ChatConversation = typeof chatConversations.$inferSelect;

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

export const insertFaqEntrySchema = createInsertSchema(faqEntries).omit({ id: true, createdAt: true });
export type InsertFaqEntry = z.infer<typeof insertFaqEntrySchema>;
export type FaqEntry = typeof faqEntries.$inferSelect;
