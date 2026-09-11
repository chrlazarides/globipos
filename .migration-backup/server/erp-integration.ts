import type { Express } from "express";
import crypto from "crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { storage } from "./storage";
import { accounts, customers, erpIntegrationConfigs, erpRecordMappings, erpStockReconciliations, erpSyncAudits, erpSyncCursors, erpSyncRuns, invoiceItems, invoices, items, journalEntries, journalEntryLines, payments } from "@shared/schema";
import { requireAdmin } from "./auth";
import { importErpPostedInvoice } from "./erp-invoice-import";

export const ERP_RECORD_TYPES = ["customers", "items", "stock", "invoices", "payments"] as const;
export type RecordType = typeof ERP_RECORD_TYPES[number];
type Provider = "softone" | "sap-b1";
export type Credentials = {
  endpoint: string;
  username: string;
  password: string;
  company: string;
  apiKey?: string;
  appId?: string;
  branch?: string;
  module?: string;
  refId?: string;
  warehouse?: string;
};
type ExternalRecord = { id: string; version?: string; data: any };
type Page = { records: ExternalRecord[]; cursor?: string | null };
const providerSchema = z.enum(["softone", "sap-b1"]);
const recordTypeSchema = z.enum(ERP_RECORD_TYPES);
const policySchema = z.object({ enabled: z.boolean(), sourceOfTruth: z.enum(["globipos", "erp"]) }).strict();
const configSchema = z.object({ provider: providerSchema, enabled: z.boolean().default(false), policies: z.record(recordTypeSchema, policySchema).default({}) }).strict();

function prefix(provider: Provider) { return provider === "softone" ? "ERP_SOFTONE" : "ERP_SAP_B1"; }
function credentialsFor(provider: Provider): Credentials | null {
  const get = (key: string) => process.env[`${prefix(provider)}_${key}`];
  const endpoint = get("ENDPOINT"), username = get("USERNAME"), password = get("PASSWORD"), company = get("COMPANY");
  if (!endpoint || !username || !password || !company) return null;
  const appId = get("APP_ID");
  if (provider === "softone" && !appId) return null;
  try { const url = new URL(endpoint); if (url.username || url.password) return null; } catch { return null; }
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    username,
    password,
    company,
    apiKey: get("API_KEY"),
    appId,
    branch: get("BRANCH"),
    module: get("MODULE"),
    refId: get("REF_ID"),
    warehouse: get("WAREHOUSE"),
  };
}
export async function validateErpEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  const testMode = process.env.NODE_ENV === "test" && process.env.ERP_ALLOW_LOCALHOST_TEST === "true";
  if (url.username || url.password) throw new Error("Invalid ERP endpoint");
  if (url.protocol !== "https:" && !(testMode && url.protocol === "http:")) throw new Error("Invalid ERP endpoint");
  const allowedHosts = (process.env.ERP_ALLOWED_HOSTS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!testMode && (!allowedHosts.length || !allowedHosts.includes(url.hostname.toLowerCase()))) throw new Error("Invalid ERP endpoint");
  const records = await dns.lookup(url.hostname, { all: true });
  const privateAddress = (address: string) => address === "::" || address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:") || address.startsWith("::ffff:") || address.startsWith("127.") || address.startsWith("10.") || address.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(address) || address.startsWith("169.254.");
  if (!testMode && (url.hostname === "localhost" || records.some(record => privateAddress(record.address)))) throw new Error("Invalid ERP endpoint");
}
function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "SAP_UDF_GLOBIPOSKEY_REQUIRED") return { code: message, message: "SAP setup is incomplete: create and expose U_GlobiPOSKey on Business Partners, Items, inventory entries/exits, Invoices, and Incoming Payments." };
  if (/WAREHOUSE_REQUIRED/.test(message)) return { code: "ERP_WAREHOUSE_REQUIRED", message: "Configure the ERP warehouse secret before synchronizing stock." };
  if (/WAREHOUSE_BALANCE_MISSING/.test(message)) return { code: "ERP_WAREHOUSE_BALANCE_MISSING", message: "The configured ERP warehouse was not present in the item balance response." };
  if (message === "INVOICE_NUMBER_CONFLICT") return { code: message, message: "An existing invoice uses this number but is not linked to this ERP record." };
  if (/BALANCE_UNAVAILABLE/.test(message)) return { code: "ERP_BALANCE_UNAVAILABLE", message: "The ERP did not return a usable inventory balance." };
  return /timeout|abort/i.test(message) ? { code: "TIMEOUT", message: "The ERP service did not respond in time." } : { code: "PROVIDER_REQUEST_FAILED", message: "The ERP service rejected or could not complete the request." };
}
async function http(url: string, init: RequestInit) {
  await validateErpEndpoint(url);
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`ERP HTTP ${response.status}`);
  return response;
}

/** Deterministic provider payloads; no internal IDs are used as provider keys. */
export function toSapPayload(type: RecordType, row: any, lines: any[] = []) {
  if (type === "customers") return { CardCode: row.code, CardName: row.name, CardType: "cCustomer", FederalTaxID: row.taxId || undefined, EmailAddress: row.email || undefined, Phone1: row.phone || undefined, Address: row.address || undefined };
  if (type === "items") return { ItemCode: row.sku, ItemName: row.name, BarCode: row.barcode || undefined, SalesItem: "tYES", InventoryItem: "tYES", Valid: row.active ? "tYES" : "tNO", UoMGroupEntry: -1, ItemPrices: [{ PriceList: 1, Price: Number(row.price1) }] };
  if (type === "stock") return { stockDelta: Number(row.stockDelta ?? row.stockQuantity), DocumentLines: [{ ItemCode: row.sku, Quantity: Math.abs(Number(row.stockDelta ?? row.stockQuantity)), WarehouseCode: row.warehouseCode }] };
  if (type === "invoices") return { CardCode: row.customerCode, DocDate: row.date, DocDueDate: row.dueDate || row.date, NumAtCard: row.invoiceNumber, Comments: row.notes || undefined, DocumentLines: lines.map(line => ({ ItemCode: line.sku, ItemDescription: line.description, Quantity: Number(line.quantity), UnitPrice: Number(line.unitPrice), DiscountPercent: Number(line.discountPercent || 0) })) };
  const method = String(row.paymentMethod || "cash");
  const tender = method === "transfer" || method === "bank_transfer" ? { TransferSum: Number(row.amount) } : method.startsWith("card") ? { CreditSum: Number(row.amount) } : { CashSum: Number(row.amount) };
  return { CardCode: row.customerCode, DocDate: row.paymentDate, ...tender, Remarks: row.reference || undefined, PaymentInvoices: row.docEntry ? [{ DocEntry: row.docEntry, SumApplied: Number(row.amount) }] : [] };
}
export function softOneNumericId(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("SOFTONE_DEPENDENCY_ID");
  return parsed;
}
export function toSoftOnePayload(type: RecordType, row: any, lines: any[] = []) {
  const marker = `GlobiPOS:${row.externalKey}`;
  if (type === "customers") return { object: "CUSTOMER", externalKey: row.externalKey, data: { CUSTOMER: [{ CODE: row.code, NAME: row.name, AFM: row.taxId || "", EMAIL: row.email || "", PHONE01: row.phone || "", ADDRESS: row.address || "", CITY: row.city || "", REMARKS: marker }] } };
  if (type === "items") return { object: "ITEM", externalKey: row.externalKey, data: { ITEM: [{ CODE: row.sku, NAME: row.name, BARCODE: row.barcode || "", PRICER: Number(row.price1), VAT: Number(row.vatRate || 0), ISACTIVE: row.active ? 1 : 0, REMARKS: marker }] } };
  if (type === "stock") return { object: "MTRDOC", externalKey: row.externalKey, data: { MTRDOC: [{ TRNDATE: row.date, COMMENTS: `GlobiPOS:${row.externalKey}` }], MTRLINES: [{ MTRL: softOneNumericId(row.materialId), QTY1: Number(row.stockDelta ?? row.stockQuantity), WHOUSE: row.warehouseCode ? softOneNumericId(row.warehouseCode) : undefined }] } };
  if (type === "invoices") return { object: "SALDOC", externalKey: row.externalKey, data: { SALDOC: [{ TRDR: softOneNumericId(row.customerExternalId), TRNDATE: row.date, FINCODE: row.invoiceNumber, COMMENTS: [row.notes, marker].filter(Boolean).join(" | ") }], ITELINES: lines.map(line => ({ MTRL: softOneNumericId(line.externalItemId), QTY1: Number(line.quantity), PRICE: Number(line.unitPrice), DISC1PRC: Number(line.discountPercent || 0) })) } };
  return { object: "PAYDOC", externalKey: row.externalKey, data: {
    PAYDOC: [{ TRDR: softOneNumericId(row.customerExternalId), TRNDATE: row.paymentDate, SUMAMNT: Number(row.amount), COMMENTS: [row.reference, marker].filter(Boolean).join(" | ") }],
    PAYLINES: row.invoiceExternalId ? [{ APPLFINDOC: softOneNumericId(row.invoiceExternalId), SUMAMNT: Number(row.amount) }] : [],
  } };
}

export function canonicalSyncHash(value: unknown) {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function inboundPaymentMarker(configId: string, generation: number, externalId: string) {
  return `ERP:${configId}:${generation}:${externalId}`;
}
export function inboundInvoiceMarker(configId: string, generation: number, externalId: string) {
  return `ERP:${configId}:${generation}:${externalId}`;
}
export function stalePaymentExternalIds(parentDocEntry: string, existing: string[], expected: string[]) {
  const prefix = `${parentDocEntry}:`;
  const keep = new Set(expected);
  return existing.filter(id => id.startsWith(prefix) && !keep.has(id));
}

export function stockOperationIdentity(configId: string, generation: number, localId: string, cycle: number, target: number, observed: number, revision: string) {
  return keyFor(configId, generation, "stock", "outbound", localId, { cycle, target, observed, revision });
}

/** Soft1 getData returns named datasets; normalize their uppercase fields. */
export function softOneData(body: any, type: RecordType, warehouse?: string) {
  const names: Record<RecordType, string[]> = {
    customers: ["CUSTOMER", "TRDR"],
    items: ["ITEM", "MTRL"],
    stock: ["MTRBAL", "ITEM", "MTRL"],
    invoices: ["SALDOC", "FINDOC"],
    payments: ["PAYDOC", "FINDOC"],
  };
  const datasets = body?.data || body;
  let header = names[type].flatMap(name => datasets?.[name] || datasets?.[name.toLowerCase()] || []).find(Boolean);
  if (type === "stock") {
    if (!warehouse) throw new Error("SOFTONE_WAREHOUSE_REQUIRED");
    const balances = datasets?.MTRBAL || datasets?.mtrbal || [];
    header = balances.find((row: any) => String(row.WHOUSE ?? row.WAREHOUSE) === String(warehouse));
    if (!header) throw new Error("SOFTONE_WAREHOUSE_BALANCE_MISSING");
  }
  const row = Array.isArray(header) ? header[0] : header;
  const lines = type === "payments" ? (datasets?.PAYLINES || datasets?.paylines)
    : datasets?.ITELINES || datasets?.MTRLINES || datasets?.itelines;
  return { ...(row || {}), ...(lines ? { [type === "payments" ? "PAYLINES" : "ITELINES"]: lines } : {}) };
}

export function decodeSoftOneBrowser(infoBody: any, dataBody?: any) {
  const dataArray = Array.isArray(infoBody?.data) ? infoBody.data : [];
  const dataIsColumns = dataArray.length > 0 && dataArray.every((entry: any) => typeof entry === "string" || entry?.name || entry?.field);
  const info = !dataIsColumns && dataArray.length ? dataArray[0] : infoBody;
  const columns = infoBody?.columns || (dataIsColumns ? dataArray : undefined) || info?.columns || infoBody?.fields || [];
  const rawRows = dataBody?.rows || dataBody?.data || [];
  const rows = rawRows.map((row: any) => Array.isArray(row)
    ? Object.fromEntries(row.map((value, index) => [String(columns[index]?.name || columns[index]?.field || columns[index] || index).toUpperCase(), value]))
    : row);
  return {
    reqID: infoBody?.reqID || infoBody?.REQID || info?.reqID || info?.REQID,
    total: Number(dataBody?.totalcount ?? dataBody?.TOTALCOUNT ?? infoBody?.totalcount ?? infoBody?.TOTALCOUNT ?? info?.totalcount ?? info?.TOTALCOUNT ?? rows.length),
    rows,
  };
}

export function softOnePrimaryId(type: RecordType, row: any, object?: string) {
  const value = object === "MTRDOC" ? row.FINDOC : type === "customers" ? row.TRDR : type === "items" || type === "stock" ? row.MTRL : row.FINDOC;
  return String(value ?? row.ID ?? row.id ?? row.CODE ?? "");
}
export function parseSoftOneBalance(data: any) {
  const rawQuantity = data.QTY1 ?? data.BALANCE;
  if (rawQuantity === undefined || rawQuantity === null || rawQuantity === "") throw new Error("SOFTONE_BALANCE_UNAVAILABLE");
  const quantity = Number(rawQuantity);
  if (!Number.isFinite(quantity)) throw new Error("SOFTONE_BALANCE_UNAVAILABLE");
  return quantity;
}

export function sapPullSpec(type: RecordType) {
  if (type === "customers") return { entity: "BusinessPartners", select: "CardCode,CardName,FederalTaxID,EmailAddress,Phone1,Address,UpdateDate,UpdateTime" };
  if (type === "items") return { entity: "Items", select: "ItemCode,ItemName,BarCode,Valid,UpdateDate,UpdateTime,ItemPrices" };
  if (type === "stock") return { entity: "Items", select: "ItemCode,UpdateDate,UpdateTime,ItemWarehouseInfoCollection" };
  if (type === "invoices") return { entity: "Invoices", select: "DocEntry,DocNum,NumAtCard,CardCode,DocDate,DocDueDate,DocTotal,DocTotalBeforeDiscount,DiscountPercent,TotalDiscount,VatSum,RoundingDiffAmount,Cancelled,DocumentStatus,Comments,UpdateDate,UpdateTime,DocumentLines,DocumentAdditionalExpenses", expand: "DocumentLines,DocumentAdditionalExpenses" };
  return { entity: "IncomingPayments", select: "DocEntry,CardCode,DocDate,CashSum,TransferSum,CreditSum,CheckSum,Remarks,UpdateDate,UpdateTime,PaymentInvoices", expand: "PaymentInvoices" };
}
export function sapUdfEntities() {
  return ["BusinessPartners", "Items", "InventoryGenEntries", "InventoryGenExits", "Invoices", "IncomingPayments"];
}
export async function validateSapUdf(request: (entity: string) => Promise<unknown>) {
  try {
    for (const entity of sapUdfEntities()) await request(entity);
  } catch {
    throw new Error("SAP_UDF_GLOBIPOSKEY_REQUIRED");
  }
}
export function withSapCorrelation(payload: any, key: string) {
  return { ...payload, U_GlobiPOSKey: key };
}

export function expandSapRecords(type: RecordType, rows: any[], warehouse?: string): ExternalRecord[] {
  if (type === "stock") return rows.map(data => {
    if (!warehouse) throw new Error("SAP_WAREHOUSE_REQUIRED");
    const balances = data.ItemWarehouseInfoCollection || data.WarehouseStocks || [];
    const selected = balances.find((row: any) => String(row.WarehouseCode ?? row.WHOUSE) === String(warehouse));
    if (!selected) throw new Error("SAP_WAREHOUSE_BALANCE_MISSING");
    return { id: String(data.ItemCode), version: `${data.UpdateDate || ""}:${data.UpdateTime || ""}:${canonicalSyncHash(selected)}`, data: { ...data, Quantity: Number(selected.InStock ?? selected.Quantity), WarehouseCode: warehouse } };
  });
  if (type === "payments") return rows.flatMap(expandSapPayment);
  return rows.map(data => ({ id: String(data.DocEntry ?? data.CardCode ?? data.ItemCode), version: `${data.UpdateDate || ""}:${data.UpdateTime || ""}:${canonicalSyncHash(type === "invoices" ? data.DocumentLines : data)}`, data }));
}

export function expandSapPayment(data: any): ExternalRecord[] {
  let tenders = [
    { method: "cash", remaining: Number(data.CashSum || 0) },
    { method: "bank_transfer", remaining: Number(data.TransferSum || 0) },
    { method: "card", remaining: Number(data.CreditSum || 0) },
    { method: "cheque", remaining: Number(data.CheckSum || 0) },
  ].filter(tender => tender.remaining > 0.005);
  if (!tenders.length) {
    const allocatedTotal = (data.PaymentInvoices || []).reduce((sum: number, allocation: any) => sum + Number(allocation.SumApplied || 0), 0);
    if (allocatedTotal > 0.005) tenders = [{ method: "cash", remaining: allocatedTotal }];
  }
  const records: ExternalRecord[] = [];
  for (const [allocationIndex, allocation] of (data.PaymentInvoices || []).entries()) {
    let amount = Number(allocation.SumApplied || 0);
    for (const tender of tenders) {
      if (amount <= 0.005) break;
      const applied = Math.min(amount, tender.remaining);
      if (applied <= 0.005) continue;
      const id = `${data.DocEntry}:allocation:${allocation.LineNum ?? allocationIndex}:${tender.method}`;
      records.push({ id, version: `${data.UpdateDate || ""}:${data.UpdateTime || ""}:${canonicalSyncHash({ allocation, method: tender.method, applied })}`, data: { ...data, PaymentDocEntry: data.DocEntry, InvoiceDocEntry: allocation.DocEntry, AllocatedAmount: applied, paymentMethod: tender.method } });
      tender.remaining -= applied;
      amount -= applied;
    }
  }
  for (const tender of tenders) if (tender.remaining > 0.005) {
    const id = `${data.DocEntry}:on-account:${tender.method}`;
    records.push({ id, version: `${data.UpdateDate || ""}:${data.UpdateTime || ""}:${canonicalSyncHash({ method: tender.method, amount: tender.remaining })}`, data: { ...data, PaymentDocEntry: data.DocEntry, InvoiceDocEntry: undefined, AllocatedAmount: tender.remaining, OnAccount: true, paymentMethod: tender.method } });
  }
  const ids = records.map(record => record.id);
  for (const record of records) record.data.PaymentSetIds = ids;
  return records;
}

export function expandSoftOnePayment(data: any): ExternalRecord[] {
  const parent = String(data.FINDOC);
  const lines = data.PAYLINES || [];
  const records: ExternalRecord[] = lines.map((line: any, index: number) => {
    const id = `${parent}:allocation:${line.LINENUM ?? index}`;
    return { id, version: String(data.UPDDATE || canonicalSyncHash(line)), data: { ...data, PaymentDocEntry: parent, InvoiceDocEntry: line.APPLFINDOC ?? line.FINDOC, AllocatedAmount: line.SUMAMNT ?? line.AMOUNT, paymentMethod: data.paymentMethod || "cash" } };
  });
  if (!records.length) records.push({ id: `${parent}:on-account`, version: String(data.UPDDATE || canonicalSyncHash(data)), data: { ...data, PaymentDocEntry: parent, AllocatedAmount: data.SUMAMNT, OnAccount: true, paymentMethod: "cash" } });
  const ids = records.map(record => record.id);
  for (const record of records) record.data.PaymentSetIds = ids;
  return records;
}

export function calculateInboundInvoice(x: any, sourceLines: any[]) {
  let gross = 0;
  const amounts = sourceLines.map(line => {
    const quantity = Number(line.Quantity ?? line.QTY1 ?? line.quantity ?? 0);
    const unitPrice = Number(line.UnitPrice ?? line.PRICE ?? line.unitPrice ?? 0);
    const discountPercent = Number(line.DiscountPercent ?? line.DISC1PRC ?? line.discountPercent ?? 0);
    const lineGross = quantity * unitPrice;
    const lineDiscount = lineGross * discountPercent / 100;
    const lineNet = lineGross - lineDiscount;
    const taxRate = Number(line.TaxPercentagePerRow ?? line.VAT ?? line.taxRate ?? 0);
    gross += lineGross;
    return { quantity, unitPrice, discountPercent, discount: lineDiscount, net: lineNet, taxRate };
  });
  const headerDiscountPercent = Number(x.DiscountPercent ?? x.DISC1PRC ?? 0);
  if (headerDiscountPercent) for (const amount of amounts) {
    const extra = amount.net * headerDiscountPercent / 100;
    amount.discount += extra;
    amount.net -= extra;
  }
  const discount = amounts.reduce((sum, amount) => sum + amount.discount, 0);
  const net = amounts.reduce((sum, amount) => sum + amount.net, 0);
  const calculatedTax = amounts.reduce((sum, amount) => sum + amount.net * amount.taxRate / 100, 0);
  const tax = Number(x.VatSum ?? x.VATAMNT ?? x.taxAmount ?? calculatedTax);
  const expenses = (x.DocumentAdditionalExpenses || x.additionalExpenses || []).reduce((sum: number, expense: any) => sum + Number(expense.LineTotal ?? expense.LineTotalFC ?? expense.amount ?? 0), 0);
  const rounding = Number(x.RoundingDiffAmount ?? x.roundingDifference ?? 0);
  const total = net + tax + expenses + rounding;
  const stated = x.DocTotal ?? x.SUMAMNT ?? x.total;
  if (stated !== undefined && Math.abs(Number(stated) - total) > 0.02) throw new Error("INVOICE_TOTAL_MISMATCH");
  const statedDiscount = x.TotalDiscount;
  if (statedDiscount !== undefined && Math.abs(Number(statedDiscount) - discount) > 0.02) throw new Error("INVOICE_DISCOUNT_MISMATCH");
  return { lines: amounts, subtotal: net + expenses + rounding, discountAmount: discount, taxAmount: tax, total, gross, expenses, rounding };
}
export function inboundInvoiceNumber(x: any, externalId: string) {
  return String(x.NumAtCard || x.FINCODE || x.DocNum || x.invoiceNumber || externalId);
}
export function isInboundInvoiceEligible(data: any) {
  const cancelled = data.Cancelled ?? data.CANCELLED ?? data.CANCEL ?? data.ISCANCEL;
  if (cancelled === true || cancelled === 1 || ["1", "Y", "YES", "TYES", "TRUE"].includes(String(cancelled).toUpperCase())) return false;
  const status = String(data.DocumentStatus ?? data.status ?? data.STATUS ?? "").toLowerCase();
  return !status || !/(cancel|void|draft|unposted)/.test(status);
}

export interface Adapter {
  test(): Promise<void>;
  push(type: RecordType, payload: any, key: string, externalId?: string): Promise<string>;
  recover(type: RecordType, payload: any, key: string): Promise<string | undefined>;
  pull(type: RecordType, cursor?: string | null, heartbeat?: () => Promise<void>): Promise<Page>;
  stockBalance?(sku: string, warehouse?: string, externalId?: string): Promise<{ quantity: number; revision: string }>;
}
function softOneObject(type: RecordType) {
  return type === "customers" ? "CUSTOMER" : type === "items" ? "ITEM" : type === "stock" ? "MTRDOC" : type === "invoices" ? "SALDOC" : "PAYDOC";
}
export function createErpAdapter(provider: Provider, c: Credentials, request: (url: string, init: RequestInit) => Promise<Response> = http): Adapter {
  if (provider === "softone") {
    // Official Soft1 Web Services flow: login -> authenticate -> setData/getBrowserData.
    let clientId = "";
    const call = async (payload: Record<string, unknown>) => {
      const response = await request(c.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!body.success) throw new Error("SoftOne request failed");
      return body;
    };
    const login = async () => {
      if (clientId) return;
      const loggedIn = await call({ service: "login", username: c.username, password: c.password, appId: c.appId });
      const selection = (loggedIn.objs || []).find((item: any) => String(item.COMPANY) === c.company) || loggedIn.objs?.[0];
      if (!selection) throw new Error("SoftOne company unavailable");
      const authenticated = await call({
        service: "authenticate",
        clientID: loggedIn.clientID,
        COMPANY: c.company,
        BRANCH: c.branch || selection.BRANCH,
        MODULE: c.module || selection.MODULE,
        REFID: c.refId || selection.REFID,
      });
      clientId = authenticated.clientID;
    };
    const findCorrelation = async (object: string, key: string) => {
      const marker = `GlobiPOS:${key}`.replace(/'/g, "''");
      const correlationField = object === "CUSTOMER" || object === "ITEM" ? "REMARKS" : "COMMENTS";
      const rawInfo = await call({ service: "getBrowserInfo", clientID: clientId, appId: c.appId, OBJECT: object, LIST: "", FILTERS: `${correlationField} LIKE '%${marker}%'` });
      const meta = decodeSoftOneBrowser(rawInfo);
      if (!meta.reqID) return undefined;
      const rawData = await call({ service: "getBrowserData", clientID: clientId, reqID: meta.reqID, start: 0, limit: 1 });
      const row = decodeSoftOneBrowser(rawInfo, rawData).rows[0];
      return row ? softOnePrimaryId(object === "CUSTOMER" ? "customers" : object === "ITEM" ? "items" : object === "MTRDOC" ? "stock" : object === "SALDOC" ? "invoices" : "payments", row, object) : undefined;
    };
    return {
      test: login,
      recover: async (type, _payload, key) => { await login(); return findCorrelation(softOneObject(type), key); },
      push: async (type, payload, key, externalId) => {
        await login();
        const object = softOneObject(type);
        const recovered = externalId ? undefined : await findCorrelation(object, key);
        if (recovered) return recovered;
        const body = await call({ service: "setData", clientID: clientId, appId: c.appId, OBJECT: object, KEY: externalId || "", data: payload.data, locateinfo: `GlobiPOS:${key}` });
        return String(body.id || body.ID || body.TRDR || body.MTRL || body.FINDOC || payload.externalKey);
      },
      pull: async (type, cursor, heartbeat) => {
        await login();
        // Stock reads are current ITEM balances; stock writes are immutable
        // MTRDOC inventory movements.
        const object = type === "stock" ? "ITEM" : softOneObject(type);
        const checkpoint = new Date().toISOString();
        const info = await call({ service: "getBrowserInfo", clientID: clientId, appId: c.appId, OBJECT: object, LIST: "", FILTERS: cursor ? `UPDDATE>=${cursor}` : "" });
        const metadata = decodeSoftOneBrowser(info);
        if (!metadata.reqID) throw new Error("SoftOne browser request missing");
        const rows: any[] = [];
        for (let start = 0, total = Number.POSITIVE_INFINITY; start < total; start += 500) {
          await heartbeat?.();
          const body = await call({ service: "getBrowserData", clientID: clientId, reqID: metadata.reqID, start, limit: Math.min(500, total - start) });
          const decoded = decodeSoftOneBrowser(info, body);
          rows.push(...decoded.rows);
          total = decoded.total;
          if (!decoded.rows.length || decoded.rows.length < 500) break;
        }
        const records: ExternalRecord[] = [];
        for (const browserRow of rows) {
          await heartbeat?.();
          const id = softOnePrimaryId(type, browserRow);
          const hydrated = await call({ service: "getData", clientID: clientId, appId: c.appId, OBJECT: object, KEY: id });
          const data = softOneData(hydrated, type, type === "stock" ? c.warehouse : undefined);
          if (type === "payments") records.push(...expandSoftOnePayment(data));
          else records.push({ id, version: String(data.UPDDATE || browserRow.UPDDATE || canonicalSyncHash(data)), data });
        }
        return { records, cursor: checkpoint };
      },
      stockBalance: async (_sku, _warehouse, externalId) => {
        if (!externalId) throw new Error("DEPENDENCY");
        await login();
        const body = await call({ service: "getData", clientID: clientId, appId: c.appId, OBJECT: "ITEM", KEY: externalId });
        const data = softOneData(body, "stock", c.warehouse);
        const quantity = parseSoftOneBalance(data);
        return { quantity, revision: String(data.UPDDATE || canonicalSyncHash({ externalId, quantity })) };
      },
    };
  }
  let cookie = "";
  const login = async () => { if (!cookie) { const r = await request(`${c.endpoint}/b1s/v1/Login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ CompanyDB: c.company, UserName: c.username, Password: c.password }) }); cookie = r.headers.get("set-cookie") || ""; if (!cookie) throw new Error("SAP session missing"); } };
  const entity = (type: RecordType) => type === "customers" ? "BusinessPartners" : type === "items" ? "Items" : type === "invoices" ? "Invoices" : "IncomingPayments";
  const recover = async (type: RecordType, payload: any, key: string) => {
    await login();
    const stockDelta = type === "stock" ? Number(payload.stockDelta) : 0;
    const e = type === "stock" ? (stockDelta < 0 ? "InventoryGenExits" : "InventoryGenEntries") : entity(type);
    const filter = encodeURIComponent(`U_GlobiPOSKey eq '${key.replace(/'/g, "''")}'`);
    const keyField = type === "customers" ? "CardCode" : type === "items" ? "ItemCode" : "DocEntry";
    const found = await (await request(`${c.endpoint}/b1s/v1/${e}?$select=${keyField}&$filter=${filter}`, { headers: { Cookie: cookie } })).json() as any;
    return found.value?.[0]?.[keyField] != null ? String(found.value[0][keyField]) : undefined;
  };
  return {
    test: async () => {
      await login();
      await validateSapUdf(entityName => request(`${c.endpoint}/b1s/v1/${entityName}?$select=U_GlobiPOSKey&$top=1`, { headers: { Cookie: cookie } }));
    },
    recover,
    push: async (type, payload, key, externalId) => {
       await login();
       const stockDelta = type === "stock" ? Number(payload.stockDelta) : 0;
       const e = type === "stock" ? (stockDelta < 0 ? "InventoryGenExits" : "InventoryGenEntries") : entity(type);
      // Service Layer has no HTTP idempotency header; correlation UDF is queried
      // before every POST and PATCHed when an existing record is found.
       const keyField = type === "customers" ? "CardCode" : type === "items" ? "ItemCode" : "DocEntry";
       const recovered = await recover(type, payload, key);
       // Inventory movements are immutable. Only this delta's independent
       // correlation key may suppress its POST; an older movement mapping may not.
       const id = recovered ?? (type === "stock" ? undefined : externalId);
       if (type === "stock" && id) return String(id);
      const entityKey = id ? (type === "customers" || type === "items" ? `('${String(id).replace(/'/g, "''")}')` : `(${Number(id)})`) : "";
       const sendPayload = type === "stock" ? withSapCorrelation({ DocumentLines: payload.DocumentLines }, key) : withSapCorrelation(payload, key);
       const r = await request(`${c.endpoint}/b1s/v1/${e}${entityKey}`, { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(sendPayload) });
      const body = await r.json().catch(() => ({})); return String(body.DocEntry || body.CardCode || body.ItemCode || id || key);
    },
    pull: async (type, cursor, heartbeat) => {
      await login();
      const checkpoint = new Date().toISOString().slice(0, 10);
      const spec = sapPullSpec(type);
      const clauses = [`$select=${spec.select}`, cursor ? `$filter=UpdateDate ge '${cursor.replace(/'/g, "''")}'` : "", spec.expand ? `$expand=${spec.expand}` : ""].filter(Boolean);
      let url: string | null = `${c.endpoint}/b1s/v1/${spec.entity}?${clauses.join("&")}`;
      const rows: any[] = [];
      while (url) {
        await heartbeat?.();
        const body: any = await (await request(url, { headers: { Cookie: cookie } })).json();
        rows.push(...(body.value || []));
        const next: unknown = body["@odata.nextLink"] || body["odata.nextLink"];
        url = next ? (String(next).startsWith("http") ? String(next) : `${c.endpoint}/b1s/v1/${String(next).replace(/^\/?(?:b1s\/v1\/)?/, "")}`) : null;
      }
      return { records: expandSapRecords(type, rows, type === "stock" ? c.warehouse : undefined), cursor: checkpoint };
    },
    stockBalance: async (sku, warehouse) => {
      await login();
      const escaped = sku.replace(/'/g, "''");
      const body = await (await request(`${c.endpoint}/b1s/v1/Items('${escaped}')?$select=UpdateDate,UpdateTime,ItemWarehouseInfoCollection`, { headers: { Cookie: cookie } })).json();
      const balances = body.ItemWarehouseInfoCollection || [];
      const selected = balances.filter((row: any) => !warehouse || row.WarehouseCode === warehouse);
      return {
        quantity: selected.reduce((sum: number, row: any) => sum + Number(row.InStock || 0), 0),
        revision: `${body.UpdateDate || ""}:${body.UpdateTime || ""}:${canonicalSyncHash(selected)}`,
      };
    },
  };
}

async function mapping(configId: string, generation: number, type: RecordType, localId?: string, externalId?: string, executor: any = db): Promise<typeof erpRecordMappings.$inferSelect | undefined> {
  const column = localId ? erpRecordMappings.localId : erpRecordMappings.externalId;
  const value = localId || externalId!;
  const [row] = await executor.select().from(erpRecordMappings).where(and(eq(erpRecordMappings.configId, configId), eq(erpRecordMappings.generation, generation), eq(erpRecordMappings.recordType, type), eq(column, value)));
  return row || undefined;
}
async function saveMapping(configId: string, generation: number, type: RecordType, localId: string, externalId: string, version?: string, executor: any = db) {
  await executor.insert(erpRecordMappings).values({ configId, generation, recordType: type, localId, externalId, sourceVersion: version || null })
    .onConflictDoUpdate({ target: [erpRecordMappings.configId, erpRecordMappings.generation, erpRecordMappings.recordType, erpRecordMappings.localId], set: { externalId, sourceVersion: version || null, lastSyncedAt: new Date() } });
}
async function addAudit(configId: string, generation: number, key: string, type: RecordType, recordId: string, direction: "inbound" | "outbound", status: "succeeded" | "failed" | "skipped", values: Partial<{ externalId: string; errorCode: string; errorMessage: string }> = {}, executor: any = db) {
  const previous = await executor.select({ attempt: erpSyncAudits.attempt }).from(erpSyncAudits).where(eq(erpSyncAudits.idempotencyKey, key)).orderBy(desc(erpSyncAudits.attempt)).limit(1);
  await executor.insert(erpSyncAudits).values({ configId, generation, idempotencyKey: key, recordType: type, recordId, direction, status, attempt: (previous[0]?.attempt || 0) + 1, ...values });
}
function keyFor(configId: string, generation: number, type: RecordType, direction: string, id: string, version: unknown) { return crypto.createHash("sha256").update(`${configId}|${generation}|${type}|${direction}|${id}|${canonicalSyncHash(version)}`).digest("hex"); }
export function hasSucceededAttempt(rows: Array<{ status: string }>) { return rows.some(row => row.status === "succeeded"); }
export const OUTBOUND_INVOICE_STATUSES = ["posted", "sent", "paid", "partial", "overdue"] as const;
export function isOutboundInvoiceEligible(row: { type: string; status: string }) {
  return row.type === "invoice" && (OUTBOUND_INVOICE_STATUSES as readonly string[]).includes(row.status);
}

async function stockCycle(configId: string, generation: number, row: any, observation: { quantity: number; revision: string }) {
  return db.transaction(async tx => {
    const [latest] = await tx.select({ cycle: erpStockReconciliations.cycle }).from(erpStockReconciliations).where(and(
      eq(erpStockReconciliations.configId, configId),
      eq(erpStockReconciliations.generation, generation),
      eq(erpStockReconciliations.localId, row.id),
    )).orderBy(desc(erpStockReconciliations.cycle)).limit(1);
    const cycle = (latest?.cycle || 0) + 1;
    const correlationKey = stockOperationIdentity(configId, generation, row.id, cycle, Number(row.stockQuantity), observation.quantity, observation.revision);
    const [created] = await tx.insert(erpStockReconciliations).values({
      configId, generation, localId: row.id, cycle,
      targetQuantity: Number(row.stockQuantity), observedQuantity: observation.quantity,
      observedRevision: observation.revision, correlationKey,
    }).returning();
    return created;
  });
}

type StockCycleState = { correlationKey: string; targetQuantity: number; observedQuantity: number; observedRevision: string };
export async function driveStockReconciliation<T extends StockCycleState>(options: {
  target: number;
  observation: { quantity: number; revision: string };
  pending?: T;
  maxAttempts?: number;
  create(observation: { quantity: number; revision: string }): Promise<T>;
  recover(cycle: T): Promise<string | undefined>;
  push(cycle: T): Promise<string>;
  read(): Promise<{ quantity: number; revision: string }>;
  retire(cycle: T, status: "succeeded" | "superseded", externalId?: string): Promise<void>;
}) {
  let observation = options.observation;
  let pending = options.pending;
  for (let attempt = 0; attempt < (options.maxAttempts || 4); attempt++) {
    if (pending) {
      const recovered = await options.recover(pending);
      const fresh = await options.read();
      const unchanged = fresh.quantity === pending.observedQuantity && fresh.revision === pending.observedRevision;
      observation = fresh;
      if (recovered && fresh.quantity === options.target) {
        await options.retire(pending, "succeeded", recovered);
        return { status: "succeeded" as const, cycle: pending, externalId: recovered, observation: fresh };
      }
      if (recovered || !unchanged) {
        await options.retire(pending, "superseded", recovered);
        pending = undefined;
      }
    }
    if (observation.quantity === options.target) return { status: "skipped" as const, observation };
    const cycle = pending || await options.create(observation);
    const externalId = await options.push(cycle);
    const fresh = await options.read();
    if (fresh.quantity === options.target) {
      await options.retire(cycle, "succeeded", externalId);
      return { status: "succeeded" as const, cycle, externalId, observation: fresh };
    }
    await options.retire(cycle, "superseded", externalId);
    observation = fresh;
    pending = undefined;
  }
  throw new Error("STOCK_TARGET_MISMATCH");
}

async function reconcileOutboundStock(configId: string, generation: number, row: any, use: Adapter, provider: Provider, warehouse?: string) {
  if (provider === "sap-b1" && !warehouse) throw new Error("DEPENDENCY");
  const itemMap = await mapping(configId, generation, "items", row.id);
  if (!itemMap || !use.stockBalance) throw new Error("DEPENDENCY");
  const read = () => use.stockBalance!(row.sku, warehouse, itemMap.externalId);
  const observation = await read();
  const [pending] = await db.select().from(erpStockReconciliations).where(and(eq(erpStockReconciliations.configId, configId), eq(erpStockReconciliations.generation, generation), eq(erpStockReconciliations.localId, row.id), eq(erpStockReconciliations.status, "pending"))).orderBy(desc(erpStockReconciliations.cycle)).limit(1);
  const payloadFor = (cycle: StockCycleState) => {
    const data = { ...row, date: new Date().toISOString().slice(0, 10), materialId: itemMap.externalId, warehouseCode: warehouse, stockDelta: cycle.targetQuantity - cycle.observedQuantity };
    return provider === "sap-b1" ? toSapPayload("stock", data) : toSoftOnePayload("stock", { ...data, externalKey: cycle.correlationKey, version: cycle.observedRevision });
  };
  return driveStockReconciliation({
    target: Number(row.stockQuantity), observation, pending,
    create: fresh => stockCycle(configId, generation, row, fresh),
    recover: cycle => use.recover("stock", payloadFor(cycle), cycle.correlationKey),
    push: cycle => use.push("stock", payloadFor(cycle), cycle.correlationKey),
    read,
    retire: async (cycle: any, status, externalId) => {
      await db.transaction(async tx => {
        await tx.update(erpStockReconciliations).set({ status, finishedAt: new Date() }).where(eq(erpStockReconciliations.id, cycle.id));
        if (status === "succeeded") {
          await saveMapping(configId, generation, "stock", row.id, externalId!, cycle.observedRevision, tx);
          await addAudit(configId, generation, cycle.correlationKey, "stock", row.id, "outbound", "succeeded", { externalId }, tx);
        }
      });
    },
  });
}

async function outboundRow(configId: string, generation: number, type: RecordType, row: any, use: Adapter, provider: Provider, warehouse?: string) {
  let operationKey = keyFor(configId, generation, type, "outbound", row.id, canonicalSyncHash(row));
  if (type === "invoices" && !isOutboundInvoiceEligible(row)) {
    await addAudit(configId, generation, operationKey, type, row.id, "outbound", "skipped", { errorCode: "UNSUPPORTED_INVOICE_STATE", errorMessage: "Only finalized sales invoices can be synchronized." });
    return "skipped" as const;
  }
  try {
    let data = row, lines: any[] = [];
    if (type === "invoices") {
      const customer = await storage.getCustomer(row.customerId);
      const customerMap = await mapping(configId, generation, "customers", row.customerId);
      if (!customer || (provider === "softone" && !customerMap)) throw new Error("DEPENDENCY");
      data = { ...row, customerCode: customer.code, customerExternalId: customerMap?.externalId };
      const raw = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, row.id));
      lines = await Promise.all(raw.map(async line => {
        const item = line.itemId ? await storage.getItem(line.itemId) : undefined;
        const itemMap = line.itemId ? await mapping(configId, generation, "items", line.itemId) : undefined;
        return { ...line, sku: item?.sku, externalItemId: itemMap?.externalId };
      }));
      if (lines.some(line => !line.sku || (provider === "softone" && !line.externalItemId))) throw new Error("DEPENDENCY");
    }
    if (type === "payments") {
      const customer = row.customerId ? await storage.getCustomer(row.customerId) : undefined;
      const customerMap = row.customerId ? await mapping(configId, generation, "customers", row.customerId) : undefined;
      if (!customer) throw new Error("DEPENDENCY");
      const invoiceMap = row.invoiceId ? await mapping(configId, generation, "invoices", row.invoiceId) : undefined;
      if (row.invoiceId && !invoiceMap) throw new Error("DEPENDENCY");
      if (provider === "softone" && !customerMap) throw new Error("DEPENDENCY");
      data = { ...row, customerCode: customer.code, customerExternalId: customerMap?.externalId, invoiceExternalId: invoiceMap?.externalId, docEntry: invoiceMap?.externalId ? Number(invoiceMap.externalId) : undefined };
    }
    if (type === "stock") {
      const result = await reconcileOutboundStock(configId, generation, row, use, provider, warehouse);
      return result.status;
    }
    const version = canonicalSyncHash(type === "invoices" ? { row: data, lines } : data);
    operationKey = keyFor(configId, generation, type, "outbound", row.id, version);
    const prior = await db.select().from(erpSyncAudits).where(eq(erpSyncAudits.idempotencyKey, operationKey));
    if (hasSucceededAttempt(prior)) return "skipped" as const;
    const existing = await mapping(configId, generation, type, row.id);
    const externalId = await use.push(type, provider === "sap-b1" ? toSapPayload(type, data, lines) : toSoftOnePayload(type, { ...data, externalKey: operationKey, version }, lines), operationKey, existing?.externalId);
    await db.transaction(async tx => {
      await saveMapping(configId, generation, type, row.id, externalId, version, tx);
      await addAudit(configId, generation, operationKey, type, row.id, "outbound", "succeeded", { externalId }, tx);
    }); return "succeeded" as const;
  } catch (error) { const safe = safeError(error); await addAudit(configId, generation, operationKey, type, row.id, "outbound", "failed", { errorCode: safe.code, errorMessage: safe.message }); return "failed" as const; }
}

export function paymentSetAtomicSequence() {
  return ["validate_dependencies", "begin_transaction", "delete_stale", "upsert_current", "update_mappings", "recalculate_invoices", "write_audits", "commit"] as const;
}

export function erpPaymentJournalLines(paymentMethod: string, amount: number) {
  const tenderCode = paymentMethod.toLowerCase() === "cash" ? "1000" : "1010";
  return [
    { accountCode: tenderCode, debit: amount, credit: 0, description: tenderCode === "1000" ? "Cash" : "Bank" },
    { accountCode: "1100", debit: 0, credit: amount, description: "Accounts Receivable" },
  ];
}

async function deletePaymentJournalTx(tx: any, paymentId: string, resolvedAccounts?: Map<string, typeof accounts.$inferSelect>) {
  const entries = await tx.select().from(journalEntries).where(and(eq(journalEntries.sourceType, "payment"), eq(journalEntries.sourceId, paymentId)));
  for (const entry of entries) {
    const lines = await tx.select().from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, entry.id));
    for (const line of lines) {
      const [account] = await tx.select().from(accounts).where(eq(accounts.id, line.accountId)).limit(1);
      if (!account) continue;
      const delta = Number(line.debit) - Number(line.credit);
      const balance = Number(account.balance) - ((account.type === "asset" || account.type === "expense") ? delta : -delta);
      await tx.update(accounts).set({ balance: balance.toFixed(2) }).where(eq(accounts.id, account.id));
      if (resolvedAccounts) resolvedAccounts.set(account.code, { ...account, balance: balance.toFixed(2) });
    }
    await tx.delete(journalEntryLines).where(eq(journalEntryLines.journalEntryId, entry.id));
    await tx.delete(journalEntries).where(eq(journalEntries.id, entry.id));
  }
}

async function createPaymentJournalTx(tx: any, payment: typeof payments.$inferSelect, resolvedAccounts: Map<string, typeof accounts.$inferSelect>) {
  const amount = Number(payment.amount);
  if (amount <= 0) return;
  const lines = erpPaymentJournalLines(payment.paymentMethod, amount);
  const debits = lines.reduce((total, line) => total + line.debit, 0);
  const credits = lines.reduce((total, line) => total + line.credit, 0);
  if (Math.abs(debits - credits) > 0.005) throw new Error("PAYMENT_JOURNAL_UNBALANCED");
  const [{ maxNum }] = await tx.select({ maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(entry_number FROM 4) AS INTEGER)), 0)` }).from(journalEntries);
  const [entry] = await tx.insert(journalEntries).values({ entryNumber: `JE-${String(Number(maxNum) + 1).padStart(6, "0")}`, date: payment.paymentDate, description: "Customer Payment received", reference: payment.reference || payment.id, sourceType: "payment", sourceId: payment.id, status: "posted", totalAmount: amount.toFixed(2) }).returning();
  for (const line of lines) {
    const account = resolvedAccounts.get(line.accountCode);
    if (!account) throw new Error("PAYMENT_JOURNAL_ACCOUNT_MISSING");
    await tx.insert(journalEntryLines).values({ journalEntryId: entry.id, accountId: account.id, debit: line.debit.toFixed(2), credit: line.credit.toFixed(2), description: line.description });
    const delta = line.debit - line.credit;
    const balance = Number(account.balance) + ((account.type === "asset" || account.type === "expense") ? delta : -delta);
    await tx.update(accounts).set({ balance: balance.toFixed(2) }).where(eq(accounts.id, account.id));
    resolvedAccounts.set(account.code, { ...account, balance: balance.toFixed(2) });
  }
}

async function recalcInvoiceStatusTx(tx: any, invoiceId: string) {
  const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!invoice || invoice.type !== "invoice" || invoice.status === "cancelled") return;
  const rows = await tx.select({ amount: payments.amount }).from(payments).where(eq(payments.invoiceId, invoiceId));
  const paid = rows.reduce((sum: number, row: any) => sum + Number(row.amount), 0);
  const total = Number(invoice.total);
  let status = invoice.status;
  if (total > 0 && paid >= total - 0.005) status = "paid";
  else if (paid > 0.005) status = "partial";
  else if (status === "paid" || status === "partial") status = invoice.dueDate && String(invoice.dueDate) < new Date().toISOString().slice(0, 10) ? "overdue" : "sent";
  if (status !== invoice.status) await tx.update(invoices).set({ status }).where(eq(invoices.id, invoiceId));
}

async function inboundPaymentSet(configId: string, generation: number, records: ExternalRecord[]) {
  const prepared: Array<{ external: ExternalRecord; customer: typeof erpRecordMappings.$inferSelect; invoice?: typeof erpRecordMappings.$inferSelect; referencedInvoice: unknown }> = [];
  for (const external of records) {
    const x = external.data;
    const customer = await mapping(configId, generation, "customers", undefined, String(x.CardCode || x.TRDR || x.customerCode));
    const referencedInvoice = x.InvoiceDocEntry || x.invoiceId;
    const invoice = referencedInvoice ? await mapping(configId, generation, "invoices", undefined, String(referencedInvoice)) : undefined;
    if (!customer || (referencedInvoice && !invoice)) throw new Error("DEPENDENCY");
    prepared.push({ external, customer, invoice, referencedInvoice });
  }
  try {
    await db.transaction(async tx => {
      const expected = records.map(record => record.id);
      const parent = String(records[0].data.PaymentDocEntry);
      const requiredCodes = new Set<string>();
      for (const entry of prepared) {
        const amount = Number(entry.external.data.AllocatedAmount ?? entry.external.data.SUMAMNT ?? entry.external.data.amount ?? 0);
        if (amount > 0) for (const line of erpPaymentJournalLines(entry.external.data.paymentMethod || "cash", amount)) requiredCodes.add(line.accountCode);
      }
      const accountRows = requiredCodes.size ? await tx.select().from(accounts).where(inArray(accounts.code, [...requiredCodes])) : [];
      const resolvedAccounts = new Map(accountRows.map(account => [account.code, account]));
      if ([...requiredCodes].some(code => !resolvedAccounts.get(code)?.active)) throw new Error("PAYMENT_JOURNAL_ACCOUNT_MISSING");
      const allMappings = await tx.select().from(erpRecordMappings).where(and(eq(erpRecordMappings.configId, configId), eq(erpRecordMappings.generation, generation), eq(erpRecordMappings.recordType, "payments")));
      const stale = stalePaymentExternalIds(parent, allMappings.map((row: any) => row.externalId), expected);
      const affected = new Set<string>();
      const audits: Array<{ key: string; recordId: string; externalId: string }> = [];
      for (const externalId of stale) {
        const staleMapping = allMappings.find((row: any) => row.externalId === externalId);
        if (!staleMapping) continue;
        const [oldPayment] = await tx.select().from(payments).where(eq(payments.id, staleMapping.localId)).limit(1);
        if (oldPayment?.invoiceId) affected.add(oldPayment.invoiceId);
        if (oldPayment) { await deletePaymentJournalTx(tx, oldPayment.id, resolvedAccounts); await tx.delete(payments).where(eq(payments.id, oldPayment.id)); }
        await tx.delete(erpRecordMappings).where(eq(erpRecordMappings.id, staleMapping.id));
      }
      for (const entry of prepared) {
        const { external, customer, invoice } = entry;
        const x = external.data;
        const marker = inboundPaymentMarker(configId, generation, external.id);
        const values = { customerId: customer.localId, invoiceId: invoice?.localId || null, amount: String(x.AllocatedAmount ?? x.SUMAMNT ?? x.amount ?? 0), paymentDate: String(x.DocDate || x.TRNDATE || x.paymentDate).slice(0, 10), paymentMethod: x.paymentMethod || "cash", reference: marker, notes: x.Remarks || x.COMMENTS || x.reference || x.notes || null };
        let currentMapping = await mapping(configId, generation, "payments", undefined, external.id, tx);
        let payment: typeof payments.$inferSelect | undefined = (currentMapping ? await tx.select().from(payments).where(eq(payments.id, currentMapping.localId)).limit(1) : await tx.select().from(payments).where(eq(payments.reference, marker)).limit(1))[0];
        if (payment?.invoiceId) affected.add(payment.invoiceId);
        if (payment && payment.invoiceId !== values.invoiceId) {
          await deletePaymentJournalTx(tx, payment.id, resolvedAccounts);
          await tx.delete(payments).where(eq(payments.id, payment.id));
          if (currentMapping) await tx.delete(erpRecordMappings).where(eq(erpRecordMappings.id, currentMapping.id));
          payment = undefined; currentMapping = undefined;
        }
        if (payment) { await deletePaymentJournalTx(tx, payment.id, resolvedAccounts); [payment] = await tx.update(payments).set(values).where(eq(payments.id, payment.id)).returning(); }
        else [payment] = await tx.insert(payments).values(values).returning();
        await createPaymentJournalTx(tx, payment, resolvedAccounts);
        if (values.invoiceId) affected.add(values.invoiceId);
        const key = keyFor(configId, generation, "payments", "inbound", external.id, external.version);
        await saveMapping(configId, generation, "payments", payment.id, external.id, external.version, tx);
        audits.push({ key, recordId: payment.id, externalId: external.id });
      }
      for (const invoiceId of affected) await recalcInvoiceStatusTx(tx, invoiceId);
      for (const audit of audits) await addAudit(configId, generation, audit.key, "payments", audit.recordId, "inbound", "succeeded", { externalId: audit.externalId }, tx);
    });
    return records.map(() => "succeeded" as const);
  } catch (error) {
    const safe = safeError(error);
    for (const external of records) {
      const key = keyFor(configId, generation, "payments", "inbound", external.id, external.version);
      await addAudit(configId, generation, key, "payments", external.id, "inbound", "failed", { errorCode: safe.code, errorMessage: safe.message });
    }
    return records.map(() => "failed" as const);
  }
}

async function inboundRow(configId: string, generation: number, type: RecordType, external: ExternalRecord, adjustInvoiceInventory = true) {
  const key = keyFor(configId, generation, type, "inbound", external.id, external.version);
  const prior = await db.select().from(erpSyncAudits).where(eq(erpSyncAudits.idempotencyKey, key));
  const preMapped = await mapping(configId, generation, type, undefined, external.id);
  try {
    const x = external.data;
    if (hasSucceededAttempt(prior) && preMapped) return "skipped" as const;
    let mapped: Awaited<ReturnType<typeof mapping>> = preMapped; let localId: string; let finalized = false;
    if (type === "customers") {
      const data = { name: x.CardName || x.NAME || x.name, code: x.CardCode || x.CODE || x.code || external.id, email: x.EmailAddress || x.EMAIL || x.email || null, phone: x.Phone1 || x.PHONE01 || x.phone || null, address: x.Address || x.ADDRESS || x.address || null, taxId: x.FederalTaxID || x.AFM || x.taxId || null };
      const recovered = mapped ? undefined : await storage.getCustomerByCode(data.code);
      const row = mapped || recovered ? await storage.updateCustomer(mapped?.localId || recovered!.id, data) : await storage.createCustomer(data);
      if (!row) throw new Error("UPSERT"); localId = row.id;
    }
    else if (type === "items") {
      const itemPrice = (x.ItemPrices || []).find((price: any) => Number(price.PriceList) === 1) || x.ItemPrices?.[0];
      const data = { name: x.ItemName || x.NAME || x.name, sku: x.ItemCode || x.CODE || x.sku || external.id, barcode: x.BarCode || x.BARCODE || x.barcode || null, price1: String(itemPrice?.Price ?? x.PRICER ?? x.SalesPrice ?? x.price1 ?? 0), active: x.Valid !== "tNO" && x.ISACTIVE !== 0 };
      const [recovered] = mapped ? [] : await db.select().from(items).where(eq(items.sku, data.sku)).limit(1);
      const row = mapped || recovered ? await storage.updateItem(mapped?.localId || recovered.id, data) : await storage.createItem(data); if (!row) throw new Error("UPSERT"); localId = row.id;
    }
    else if (type === "stock") {
      const itemExternalId = x.MTRL !== undefined ? String(x.MTRL) : String(x.ItemCode || x.sku || external.id);
      const itemMapping = await mapping(configId, generation, "items", undefined, itemExternalId);
      const rawQuantity = x.Quantity ?? x.QTY1 ?? x.BALANCE ?? x.stockQuantity;
      if (!itemMapping) throw new Error("DEPENDENCY");
      if (rawQuantity === undefined || !Number.isFinite(Number(rawQuantity))) throw new Error("ERP_BALANCE_UNAVAILABLE");
      const row = await storage.updateItem(itemMapping.localId, { stockQuantity: Number(rawQuantity) }); if (!row) throw new Error("UPSERT"); localId = row.id;
    }
    else if (type === "invoices") {
       const customer = await mapping(configId, generation, "customers", undefined, String(x.CardCode || x.TRDR || x.customerCode));
      if (!customer) throw new Error("DEPENDENCY");
       const sourceLines = x.DocumentLines || x.ITELINES || x.lines || [];
       const calculated = calculateInboundInvoice(x, sourceLines);
       const lines = await Promise.all(sourceLines.map(async (line: any, index: number) => {
         const item = await mapping(configId, generation, "items", undefined, String(line.ItemCode || line.MTRL || line.sku));
        if (!item) throw new Error("DEPENDENCY");
         const amount = calculated.lines[index];
         return { invoiceId: "", itemId: item.localId, description: line.ItemDescription || line.NAME || line.description || line.ItemCode || line.MTRL, quantity: String(amount.quantity), saleUnit: "pc", unitPrice: amount.unitPrice.toFixed(2), discountPercent: amount.discountPercent.toFixed(2), discount: amount.discount.toFixed(2), total: amount.net.toFixed(2) };
      }));
       const invoiceNumber = inboundInvoiceNumber(x, external.id);
       const erpExternalRef = inboundInvoiceMarker(configId, generation, external.id);
       const header = { invoiceNumber, erpExternalRef, type: "invoice", customerId: customer.localId, date: String(x.DocDate || x.TRNDATE || x.date).slice(0, 10), dueDate: x.DocDueDate ? String(x.DocDueDate).slice(0, 10) : null, subtotal: calculated.subtotal.toFixed(2), taxRate: calculated.subtotal ? (calculated.taxAmount / calculated.subtotal * 100).toFixed(2) : "0", taxAmount: calculated.taxAmount.toFixed(2), discountAmount: calculated.discountAmount.toFixed(2), total: calculated.total.toFixed(2), status: "posted", notes: x.Comments || x.COMMENTS || x.notes || null };
       const [recovered] = mapped ? [] : await db.select().from(invoices).where(eq(invoices.erpExternalRef, erpExternalRef)).limit(1);
       if (!mapped && !recovered) {
         const [collision] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.invoiceNumber, invoiceNumber)).limit(1);
         if (collision) throw new Error("INVOICE_NUMBER_CONFLICT");
       }
       const row = await importErpPostedInvoice(header, lines, mapped?.localId || recovered?.id, async (invoice, tx) => {
         await saveMapping(configId, generation, type, invoice.id, external.id, external.version, tx);
         await addAudit(configId, generation, key, type, invoice.id, "inbound", "succeeded", { externalId: external.id }, tx);
       }, adjustInvoiceInventory);
       finalized = true;
      if (!row) throw new Error("UPSERT"); localId = row.id;
    } else throw new Error("PAYMENT_SET_REQUIRED");
    if (!finalized) await db.transaction(async tx => { await saveMapping(configId, generation, type, localId, external.id, external.version, tx); await addAudit(configId, generation, key, type, localId, "inbound", "succeeded", { externalId: external.id }, tx); }); return "succeeded" as const;
  } catch (error) { const safe = safeError(error); await addAudit(configId, generation, key, type, external.id, "inbound", "failed", { errorCode: safe.code, errorMessage: safe.message }); return "failed" as const; }
}

async function skipIneligibleInboundInvoice(configId: string, generation: number, external: ExternalRecord) {
  const key = keyFor(configId, generation, "invoices", "inbound", external.id, external.version);
  const prior = await db.select().from(erpSyncAudits).where(eq(erpSyncAudits.idempotencyKey, key));
  if (!prior.some(row => row.status === "skipped")) await addAudit(configId, generation, key, "invoices", external.id, "inbound", "skipped", {
    errorCode: "INELIGIBLE_ERP_INVOICE",
    errorMessage: "Cancelled, voided, draft, or unposted ERP invoices are not imported.",
  });
  return "skipped" as const;
}

export function registerErpIntegrationRoutes(app: Express) {
  app.get("/api/admin/erp-integrations", requireAdmin, async (_req, res) => res.json((await db.select().from(erpIntegrationConfigs).where(eq(erpIntegrationConfigs.scope, "local")))[0] || null));
  app.put("/api/admin/erp-integrations", requireAdmin, async (req, res) => {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid ERP configuration", errors: parsed.error.flatten() });
    try {
      const row = await db.transaction(async tx => {
       await tx.execute(sql`SELECT id FROM erp_integration_configs WHERE scope = 'local' FOR UPDATE`);
       const [existing] = await tx.select().from(erpIntegrationConfigs).where(eq(erpIntegrationConfigs.scope, "local"));
       if (existing?.syncLockedAt && existing.syncLockedAt > new Date(Date.now() - 30 * 60_000)) throw new Error("CONFIG_LOCKED");
       if (existing && existing.provider !== parsed.data.provider && existing.enabled) throw new Error("PROVIDER_ENABLED");
      const generation = existing && existing.provider !== parsed.data.provider ? existing.generation + 1 : existing?.generation || 1;
      const [saved] = await tx.insert(erpIntegrationConfigs).values({ scope: "local", ...parsed.data })
        .onConflictDoUpdate({ target: erpIntegrationConfigs.scope, set: { ...parsed.data, generation, updatedAt: new Date() } }).returning();
      return saved;
      });
      res.json(row);
    } catch (error) {
      if (error instanceof Error && error.message === "CONFIG_LOCKED") return res.status(409).json({ message: "ERP configuration cannot be changed while synchronization is running." });
      if (error instanceof Error && error.message === "PROVIDER_ENABLED") return res.status(409).json({ message: "Disable the current ERP integration before changing provider." });
      throw error;
    }
  });
  app.post("/api/admin/erp-integrations/test", requireAdmin, async (req, res) => { const [config] = await db.select().from(erpIntegrationConfigs).where(eq(erpIntegrationConfigs.scope, "local")); const c = config && credentialsFor(config.provider as Provider); if (!config || !c) return res.status(400).json({ message: "ERP configuration or required local deployment secrets are missing." }); try { await createErpAdapter(config.provider as Provider, c).test(); await db.update(erpIntegrationConfigs).set({ lastTestedAt: new Date(), lastTestStatus: "succeeded" }).where(eq(erpIntegrationConfigs.id, config.id)); res.json({ ok: true, status: "succeeded" }); } catch (e) { const safe = safeError(e); await db.update(erpIntegrationConfigs).set({ lastTestedAt: new Date(), lastTestStatus: "failed" }).where(eq(erpIntegrationConfigs.id, config.id)); res.status(502).json({ ok: false, ...safe }); } });
  app.post("/api/admin/erp-integrations/sync", requireAdmin, async (req, res) => {
    const parsed = req.body?.recordTypes === undefined ? { success: true as const, data: ERP_RECORD_TYPES } : z.array(recordTypeSchema).min(1).safeParse(req.body.recordTypes); if (!parsed.success) return res.status(400).json({ message: "Invalid record types" });
    const lockToken = crypto.randomUUID();
    const claimed = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM erp_integration_configs WHERE scope = 'local' FOR UPDATE`);
      const [snapshot] = await tx.select().from(erpIntegrationConfigs).where(eq(erpIntegrationConfigs.scope, "local"));
      if (!snapshot?.enabled) return undefined;
      const [row] = await tx.update(erpIntegrationConfigs).set({ syncLockedAt: new Date(), syncLockToken: lockToken }).where(and(
        eq(erpIntegrationConfigs.id, snapshot.id), eq(erpIntegrationConfigs.generation, snapshot.generation),
        eq(erpIntegrationConfigs.provider, snapshot.provider), eq(erpIntegrationConfigs.enabled, true),
        or(isNull(erpIntegrationConfigs.syncLockedAt), lt(erpIntegrationConfigs.syncLockedAt, new Date(Date.now() - 30 * 60_000))),
      )).returning();
      return row;
    });
    if (!claimed) return res.status(409).json({ message: "A sync is already running." });
    const config = claimed;
    const c = credentialsFor(config.provider as Provider);
    if (!c) {
      await db.update(erpIntegrationConfigs).set({ syncLockedAt: null, syncLockToken: null }).where(and(eq(erpIntegrationConfigs.id, config.id), eq(erpIntegrationConfigs.syncLockToken, lockToken)));
      return res.status(409).json({ message: "An enabled ERP integration with deployment secrets is required." });
    }
    const generation = claimed.generation;
    const [run] = await db.insert(erpSyncRuns).values({ configId: config.id, generation, initiatedBy: req.user?.id || null, recordTypes: parsed.data }).returning(); const counts = { succeeded: 0, failed: 0, skipped: 0 }; const use = createErpAdapter(config.provider as Provider, c);
    const renew = async () => {
      const [renewed] = await db.update(erpIntegrationConfigs).set({ syncLockedAt: new Date() }).where(and(eq(erpIntegrationConfigs.id, config.id), eq(erpIntegrationConfigs.syncLockToken, lockToken))).returning({ id: erpIntegrationConfigs.id });
      if (!renewed) throw new Error("SYNC_LEASE_LOST");
    };
    try { await use.test(); for (const type of parsed.data) { await renew(); const policy = (config.policies as any)[type]; if (!policy?.enabled) { counts.skipped++; continue; } if (policy.sourceOfTruth === "erp") { const [state] = await db.select().from(erpSyncCursors).where(and(eq(erpSyncCursors.configId, config.id), eq(erpSyncCursors.generation, generation), eq(erpSyncCursors.recordType, type))); const page = await use.pull(type, state?.cursor, renew); const failuresBefore = counts.failed; const stockPolicy = (config.policies as any).stock; const adjustInvoiceInventory = !(stockPolicy?.enabled && stockPolicy.sourceOfTruth === "erp"); if (type === "payments") { const groups = new Map<string, ExternalRecord[]>(); for (const external of page.records) { const parent = String(external.data.PaymentDocEntry); groups.set(parent, [...(groups.get(parent) || []), external]); } for (const records of groups.values()) { await renew(); for (const status of await inboundPaymentSet(config.id, generation, records)) counts[status]++; } } else for (const external of page.records) { await renew(); counts[type === "invoices" && !isInboundInvoiceEligible(external.data) ? await skipIneligibleInboundInvoice(config.id, generation, external) : await inboundRow(config.id, generation, type, external, adjustInvoiceInventory)]++; } if (counts.failed === failuresBefore) await db.insert(erpSyncCursors).values({ configId: config.id, generation, recordType: type, cursor: page.cursor || null }).onConflictDoUpdate({ target: [erpSyncCursors.configId, erpSyncCursors.generation, erpSyncCursors.recordType], set: { cursor: page.cursor || null, updatedAt: new Date() } }); } else { const rows = type === "customers" ? await db.select().from(customers) : type === "items" || type === "stock" ? await db.select().from(items) : type === "invoices" ? await db.select().from(invoices).where(and(eq(invoices.type, "invoice"), inArray(invoices.status, [...OUTBOUND_INVOICE_STATUSES]))) : await db.select().from(payments); for (const row of rows) { await renew(); counts[await outboundRow(config.id, generation, type, row, use, config.provider as Provider, c.warehouse)]++; } } }
    const status = counts.failed ? (counts.succeeded ? "partial" : "failed") : "succeeded"; await renew(); await db.update(erpSyncRuns).set({ ...counts, status, finishedAt: new Date(), failureSummary: counts.failed ? `${counts.failed} record(s) failed; inspect audit.` : null }).where(eq(erpSyncRuns.id, run.id)); await db.update(erpIntegrationConfigs).set({ lastSyncAt: new Date(), lastSyncStatus: status, syncLockedAt: null, syncLockToken: null }).where(and(eq(erpIntegrationConfigs.id, config.id), eq(erpIntegrationConfigs.syncLockToken, lockToken))); res.json({ runId: run.id, status, ...counts }); } catch (error) { const safe = safeError(error); await db.update(erpSyncRuns).set({ ...counts, status: "failed", finishedAt: new Date(), failureSummary: safe.message }).where(eq(erpSyncRuns.id, run.id)); await db.update(erpIntegrationConfigs).set({ lastSyncStatus: "failed", syncLockedAt: null, syncLockToken: null }).where(and(eq(erpIntegrationConfigs.id, config.id), eq(erpIntegrationConfigs.syncLockToken, lockToken))); res.status(502).json({ runId: run.id, status: "failed", ...counts, ...safe }); }
  });
  app.get("/api/admin/erp-integrations/audit", requireAdmin, async (_req, res) => { const [config] = await db.select().from(erpIntegrationConfigs).where(eq(erpIntegrationConfigs.scope, "local")); res.json(config ? await db.select().from(erpSyncAudits).where(eq(erpSyncAudits.configId, config.id)).orderBy(desc(erpSyncAudits.createdAt)).limit(200) : []); });
}