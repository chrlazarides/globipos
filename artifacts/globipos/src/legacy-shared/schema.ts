import { z } from "zod";

// The original app shared these browser-facing types and form schemas with its
// server. Keeping this compatibility module local prevents the frontend from
// importing the database package while preserving the existing page contracts.
type LegacyRecord = Record<string, any>;

export type Account = LegacyRecord;
export type Category = LegacyRecord;
export type Color = LegacyRecord;
export type Customer = LegacyRecord;
export type CustomerDeliveryLocation = LegacyRecord;
export type EmailLog = LegacyRecord;
export type Expense = LegacyRecord;
export type InsertSignageMedia = LegacyRecord;
export type InsertSignagePlaylist = LegacyRecord;
export type InsertSignageScreen = LegacyRecord;
export type InventoryInLine = LegacyRecord;
export type Invoice = LegacyRecord;
export type InvoiceItem = LegacyRecord;
export type Item = LegacyRecord;
export type ItemBarcode = LegacyRecord;
export type ItemLocationStock = LegacyRecord;
export type ItemVariant = LegacyRecord;
export type JournalEntry = LegacyRecord;
export type JournalEntryLine = LegacyRecord;
export type Payment = LegacyRecord;
export type PosCashier = LegacyRecord;
export type PosLayoutButton = LegacyRecord;
export type PosLayoutSet = LegacyRecord;
export type PosLocation = LegacyRecord;
export type PosOrder = LegacyRecord;
export type PosOrderLine = LegacyRecord;
export type PosPromotion = LegacyRecord;
export type PosReturnOrder = LegacyRecord;
export type PosTerminal = LegacyRecord;
export type PriceContract = LegacyRecord;
export type PriceContractItem = LegacyRecord;
export type PriceContractRule = LegacyRecord;
export type ProductFamily = LegacyRecord;
export type PurchaseInvoice = LegacyRecord;
export type PurchaseInvoiceItem = LegacyRecord;
export type SeasonalOffer = LegacyRecord;
export type SignageMedia = LegacyRecord;
export type SignagePlaylist = LegacyRecord;
export type SignagePlaylistItem = LegacyRecord;
export type SignageScreen = LegacyRecord;
export type Size = LegacyRecord;
export type StockTransfer = LegacyRecord;
export type StockTransferItem = LegacyRecord;
export type Supplier = LegacyRecord;
export type SupplierPayment = LegacyRecord;
export type SystemSetting = LegacyRecord;
export type VariantTemplate = LegacyRecord;

const insertSchema = z.object({}).passthrough();

export const insertAccountSchema = insertSchema;
export const insertCategorySchema = insertSchema;
export const insertCustomerSchema = insertSchema;
export const insertExpenseSchema = insertSchema;
export const insertItemSchema = insertSchema;
export const insertItemVariantSchema = insertSchema;
export const insertPosLayoutSetSchema = insertSchema;
export const insertPosLocationSchema = insertSchema;
export const insertPosTerminalSchema = insertSchema;
export const insertSeasonalOfferSchema = insertSchema;
export const insertSignageMediaSchema = insertSchema;
export const insertSignagePlaylistSchema = insertSchema;
export const insertSignageScreenSchema = insertSchema;
export const insertSupplierSchema = insertSchema;