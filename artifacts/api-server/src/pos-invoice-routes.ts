import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod/v4";
import { and, eq, ilike, or, sql, desc } from "drizzle-orm";
import { db, customers, users, customerCreditHistory, posInvoiceSales, posOrders } from "@workspace/db";
import { storage } from "./storage";
import { getCustomerCredit, saveCustomerCredit, quotePosInvoice, checkoutPosInvoice, CREDIT_PERMISSION } from "./pos-invoice-service";
import { PosInvoiceError } from "./pos-invoice-pricing";

const authFields = { cashierId: z.string().min(1).max(128), pin: z.string().regex(/^\d{4,8}$/) };
const authSchema = z.object(authFields).strict();
const cartFields = {
  ...authFields, customerId: z.string().min(1).max(128), mode: z.enum(["wholesale", "retail"]),
  lines: z.array(z.object({
    itemId: z.string().min(1).max(128), variantId: z.string().min(1).max(128).nullable().optional(),
    quantity: z.number().int().positive().max(10000), saleUnit: z.enum(["pc", "pack"]).optional(),
  }).strict()).min(1).max(200),
};
export const invoiceQuoteSchema = z.object(cartFields).strict();
export const invoiceCheckoutSchema = z.object({
  ...cartFields, orderId: z.string().uuid(), expectedTotalCents: z.number().int().min(0).max(100_000_000),
  quoteHash: z.string().regex(/^[a-f0-9]{64}$/), paymentMethod: z.enum(["cash", "card", "account_credit"]),
  amountTenderedCents: z.number().int().min(0).max(100_000_000), cardReference: z.string().trim().min(1).max(128).optional(),
}).strict();
export const creditUpdateSchema = z.object({
  approvalStatus: z.enum(["pending", "approved", "suspended"]),
  creditLimit: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/),
  paymentTerms: z.string().regex(/^(cash|credit_(?:0|[1-9]\d{0,2}))$/),
  reason: z.string().trim().min(1).max(500),
}).strict();
type Options = {
  requireTerminal: RequestHandler;
  requireDevice: (req: Request, res: Response) => boolean;
  verifyCashier: (req: Request, res: Response, id: unknown, pin: unknown) => Promise<any>;
  renderDocument: (invoice: any, customer: any, settings: Record<string, string>) => string;
  emailDocument: (invoice: any, customer: any, settings: Record<string, string>, html: string) => Promise<void>;
};

export async function canApproveCustomerCredit(userId: string | undefined) {
  if (!userId) return false;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.active) return false;
  let permissions: string[] = [];
  try { permissions = JSON.parse(user.permissions || "[]"); } catch { return false; }
  return user.role === "admin" || user.role === "superuser" ||
    (user.role === "staff" && permissions.includes(CREDIT_PERMISSION));
}

export function registerPosInvoiceRoutes(app: Express, options: Options) {
  const failures = new Map<string, { count: number; until: number }>();
  function fail(res: Response, error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ code: "INVALID_REQUEST", message: "Invalid invoice details.", errors: error.flatten() });
    return res.status(error instanceof PosInvoiceError ? error.status : 500).json({
      code: error instanceof PosInvoiceError ? error.code : "INVOICE_SERVICE_ERROR",
      message: error instanceof PosInvoiceError ? error.message : "Invoice service could not complete the request. Retry with the same checkout ID.",
    });
  }
  async function authorize(req: Request, res: Response, body: any, mode?: string) {
    res.setHeader("Cache-Control", "no-store, private");
    if (!options.requireDevice(req, res)) return undefined;
    const terminal = (req as any).terminal;
    const rateKey = `${terminal.id}:${body.cashierId}`;
    const attempt = failures.get(rateKey);
    if (attempt && attempt.until > Date.now() && attempt.count >= 10) {
      res.status(429).json({ message: "Too many incorrect cashier PIN attempts. Try again in a minute." }); return undefined;
    }
    const cashier = await options.verifyCashier(req, res, body.cashierId, body.pin);
    if (!cashier) {
      failures.set(rateKey, { count: attempt && attempt.until > Date.now() ? attempt.count + 1 : 1, until: attempt && attempt.until > Date.now() ? attempt.until : Date.now() + 60_000 });
      if (failures.size > 1000) for (const [key, value] of failures) if (value.until < Date.now()) failures.delete(key);
      return undefined;
    }
    failures.delete(rateKey);
    const buttons = terminal.layoutSetId ? await storage.getPosLayoutButtons(terminal.layoutSetId) : [];
    const codes = mode ? [mode === "wholesale" ? "WHOLESALE_INVOICE" : "CUSTOMER_ACCOUNT"] : ["WHOLESALE_INVOICE", "CUSTOMER_ACCOUNT"];
    if (!buttons.some((button: any) => button.buttonType === "action" && codes.includes(button.actionCode?.trim().toUpperCase()))) {
      res.status(403).json({ message: "Customer invoicing is not assigned to this terminal layout." }); return undefined;
    }
    return { terminal, cashier };
  }
  app.get("/api/customer-credit/:customerId", async (req, res) => {
    try {
      const [reader] = req.user?.id ? await db.select().from(users).where(eq(users.id, req.user.id)) : [];
      if (!reader?.active) return res.status(403).json({ message: "Active staff access is required." });
      const permissions: string[] = JSON.parse(reader.permissions || "[]");
      const modules = permissions.filter(permission => permission !== CREDIT_PERMISSION);
      if (!["admin", "superuser"].includes(reader.role) &&
          (reader.role !== "staff" || (modules.length && !modules.includes("customers") && !permissions.includes(CREDIT_PERMISSION)))) {
        return res.status(403).json({ message: "Customer account access is required." });
      }
      const credit = await getCustomerCredit(String(req.params.customerId));
      const history = await db.select().from(customerCreditHistory).where(eq(customerCreditHistory.customerId, String(req.params.customerId))).orderBy(desc(customerCreditHistory.createdAt)).limit(100);
      res.setHeader("Cache-Control", "no-store, private");
      res.json({ ...credit, history });
    } catch (error) { fail(res, error); }
  });
  app.put("/api/customer-credit/:customerId", async (req, res) => {
    try {
      if (!await canApproveCustomerCredit(req.user?.id)) return res.status(403).json({ message: "Customer credit approval permission is required." });
      const body = creditUpdateSchema.parse(req.body);
      res.json(await saveCustomerCredit(String(req.params.customerId), body, { id: req.user!.id, username: req.user!.username }));
    } catch (error) { fail(res, error); }
  });
  app.post("/api/pos/customer-invoices/customers", options.requireTerminal, async (req, res) => {
    try {
      const body = z.object({ ...authFields, search: z.string().trim().min(1).max(100) }).strict().parse(req.body);
      if (!await authorize(req, res, body)) return;
      const term = `%${body.search.replace(/[\\%_]/g, "\\$&")}%`;
      const result = await db.select({ id: customers.id, name: customers.name, code: customers.code, priceLevel: customers.priceLevel })
        .from(customers).where(and(eq(customers.active, true), or(ilike(customers.name, term), ilike(customers.code, term)))).orderBy(customers.name).limit(30);
      res.json({ customers: result });
    } catch (error) { fail(res, error); }
  });
  app.post("/api/pos/customer-invoices/quote", options.requireTerminal, async (req, res) => {
    try {
      const body = invoiceQuoteSchema.parse(req.body);
      const auth = await authorize(req, res, body, body.mode);
      if (!auth) return;
      const { cashierId, pin, ...cart } = body;
      const quote = await quotePosInvoice(cart, auth.terminal);
      res.json({ ...quote, lines: quote.lines.map(({ stockQuantity, costCents, ...line }) => line) });
    } catch (error) { fail(res, error); }
  });
  app.post("/api/pos/customer-invoices/checkout", options.requireTerminal, async (req, res) => {
    try {
      const body = invoiceCheckoutSchema.parse(req.body);
      const auth = await authorize(req, res, body, body.mode);
      if (!auth) return;
      const { cashierId, pin, ...input } = body;
      res.status(201).json(await checkoutPosInvoice(input, auth.terminal, auth.cashier));
    } catch (error) { fail(res, error); }
  });
  async function document(req: Request) {
    const terminal = (req as any).terminal;
    const [sale] = await db.select().from(posInvoiceSales).where(and(
      eq(posInvoiceSales.invoiceId, String(req.params.invoiceId)), eq(posInvoiceSales.terminalId, terminal.id),
    ));
    if (!sale) throw new PosInvoiceError("Invoice not found on this terminal.", 404);
    const invoice = await storage.getInvoice(sale.invoiceId);
    if (!invoice) throw new PosInvoiceError("Invoice not found.", 404);
    const customer = await storage.getCustomer(invoice.customerId);
    const saved = await storage.getSettings();
    const settings = Object.fromEntries(saved.map(setting => [setting.key, setting.value]));
    // VAT is snapshotted when issuing; later catalog changes must not alter
    // the tax rates printed on an existing invoice.
    const enriched = { ...invoice, items: invoice.items.map((line: any) => ({ ...line, lineVatRate: Number(line.vatRate || 0) })) };
    return { invoice: enriched, customer, settings, html: options.renderDocument(enriched, customer, settings) };
  }
  app.get("/api/pos/customer-invoices/:invoiceId/document", options.requireTerminal, async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store, private");
      if (!options.requireDevice(req, res)) return;
      const content = await document(req);
      res.type("html").send(content.html);
    } catch (error) { fail(res, error); }
  });
  app.post("/api/pos/customer-invoices/:invoiceId/email", options.requireTerminal, async (req, res) => {
    try {
      const body = authSchema.parse(req.body);
      if (!await authorize(req, res, body)) return;
      const content = await document(req);
      if (!content.customer?.email) throw new PosInvoiceError("Customer has no saved email address.", 400);
      await options.emailDocument(content.invoice, content.customer, content.settings, content.html);
      res.json({ sent: true });
    } catch (error) { fail(res, error); }
  });
}