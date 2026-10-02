import { pgTable, varchar, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customers, invoices, posOrders, posTerminals } from "./schema";

export const customerCreditProfiles = pgTable("customer_credit_profiles", {
  customerId: varchar("customer_id").primaryKey().references(() => customers.id, { onDelete: "cascade" }),
  approvalStatus: text("approval_status").notNull().default("pending"),
  updatedBy: varchar("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const customerCreditHistory = pgTable("customer_credit_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  actorId: varchar("actor_id").notNull(),
  actorName: text("actor_name").notNull(),
  reason: text("reason").notNull(),
  previous: jsonb("previous").notNull(),
  next: jsonb("next").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const posInvoiceSales = pgTable("pos_invoice_sales", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  terminalId: varchar("terminal_id").notNull().references(() => posTerminals.id),
  requestKey: text("request_key").notNull().unique(),
  requestHash: text("request_hash").notNull(),
  invoiceId: varchar("invoice_id").notNull().unique().references(() => invoices.id),
  orderId: varchar("order_id").notNull().unique().references(() => posOrders.id),
  mode: text("mode").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});