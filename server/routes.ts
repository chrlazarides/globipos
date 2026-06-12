import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCategorySchema, insertItemSchema, insertCustomerSchema, insertPriceContractSchema, insertSeasonalOfferSchema, insertInvoiceSchema, insertInvoiceItemSchema, insertPaymentSchema, insertPortalOrderSchema, insertPortalOrderItemSchema, insertSupplierSchema, insertPurchaseInvoiceSchema, insertPurchaseInvoiceItemSchema, insertSupplierPaymentSchema, insertUserSchema, categories, items, customers, invoices, invoiceItems, payments, priceContracts, priceContractRules, priceContractItems, seasonalOffers, seasonalOfferItems, suppliers, purchaseInvoices, purchaseInvoiceItems, supplierPayments, portalOrders, portalOrderItems, emailLogs, expenses, accounts, journalEntries, journalEntryLines, systemSettings, users, activityLogs, accountingSnapshots } from "@shared/schema";
import { z } from "zod";
import multer from "multer";
import ExcelJS from "exceljs";
import { Readable } from "stream";
import { sendInvoiceEmail, sendBackupEmail, sendLoginAlertEmail, sendFailedLoginAlertEmail, sendNewAdminAlertEmail, getEmailStatus, sendTestEmail } from "./email";
import { db } from "./db";
import { sql, and, eq, gte, lte, desc } from "drizzle-orm";
import crypto from "crypto";
import { hashPassword, verifyPassword, signToken, signTempToken, verifyTempToken, setAuthCookie, clearAuthCookie, requireAdmin, requireSuperuser } from "./auth";
import { generateSecret as totpGenerateSecret, generateURI as totpGenerateURI, verifySync as totpVerify } from "otplib";
import QRCode from "qrcode";

// ─── HTML ESCAPING HELPER ────────────────────────────────────────────────────
function escHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── RATE LIMITER (in-memory, per IP) ────────────────────────────────────────
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_ATTEMPTS = 10;
const failedAttempts = new Map<string, { count: number; windowStart: number; alerted: boolean }>();

function checkRateLimit(ip: string): { blocked: boolean; count: number } {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    return { blocked: false, count: 0 };
  }
  return { blocked: entry.count >= RATE_MAX_ATTEMPTS, count: entry.count };
}

function recordFailedAttempt(ip: string): number {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    failedAttempts.set(ip, { count: 1, windowStart: now, alerted: false });
    return 1;
  }
  entry.count++;
  return entry.count;
}

function clearFailedAttempts(ip: string) {
  failedAttempts.delete(ip);
}

async function getAdminEmails(): Promise<string[]> {
  try {
    const admins = await db.select({ email: users.email }).from(users)
      .where(and(eq(users.role, "admin"), eq(users.active, true)));
    return admins.map(a => a.email).filter(Boolean) as string[];
  } catch { return []; }
}

function hashSettingsPassword(pw: string) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}

async function readExcelWorkbook(buffer: Buffer, filename: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const ext = (filename || "").toLowerCase().split(".").pop();
  if (ext === "csv") {
    const stream = Readable.from(buffer.toString("utf-8"));
    await workbook.csv.read(stream);
  } else {
    await workbook.xlsx.load(buffer);
  }
  return workbook;
}

function worksheetToJson(sheet: ExcelJS.Worksheet, defval: any = ""): any[] {
  const rows: any[] = [];
  let headers: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = (row.values as any[]).slice(1);
    if (rowNumber === 1) {
      headers = values.map((v) => (v !== null && v !== undefined ? String(v) : ""));
    } else {
      const obj: any = {};
      headers.forEach((h, i) => {
        const v = values[i];
        obj[h] = v !== undefined && v !== null ? v : defval;
      });
      rows.push(obj);
    }
  });
  return rows;
}

async function logActivity(userId: string | null, username: string | null, action: string, entity: string | null, entityId: string | null, description: string | null, ipAddress: string | null, userAgent: string | null) {
  try {
    await db.insert(activityLogs).values({ userId, username, action, entity, entityId, description, ipAddress, userAgent });
  } catch {}
}

function activityMiddleware(app: Express) {
  const SKIP_PATHS = ["/api/auth/", "/api/portal/"];
  const ENTITY_MAP: Record<string, string> = {
    "/api/items": "item", "/api/customers": "customer", "/api/invoices": "invoice",
    "/api/suppliers": "supplier", "/api/categories": "category", "/api/price-contracts": "price_contract",
    "/api/seasonal-offers": "seasonal_offer", "/api/purchase-invoices": "purchase_invoice",
    "/api/payments": "payment", "/api/supplier-payments": "supplier_payment",
    "/api/expenses": "expense", "/api/journal-entries": "journal_entry",
    "/api/accounts": "account", "/api/users": "user", "/api/settings": "settings",
    "/api/backup": "backup",
  };

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    if (!req.path.startsWith("/api/")) return next();
    if (SKIP_PATHS.some(p => req.path.startsWith(p))) return next();

    const origJson = res.json.bind(res);
    res.json = (body: any) => {
      if (res.statusCode < 400 && req.user) {
        const entity = Object.entries(ENTITY_MAP).find(([k]) => req.path.startsWith(k))?.[1] || null;
        const action = req.method === "POST" ? "create" : req.method === "DELETE" ? "delete" : "update";
        const entityId = body?.id ?? (Array.isArray(body) ? body[0]?.id : null) ?? null;
        const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.ip || null;
        const ua = req.headers["user-agent"] || null;
        logActivity(req.user.id, req.user.username, action, entity, entityId?.toString() || null, `${req.method} ${req.path}`, ip, ua);
      }
      return origJson(body);
    };
    next();
  });
}

export async function generateBackupJson(since?: string): Promise<string> {
  const sinceDate = since ? new Date(since) : null;

  // Config tables — always exported in full (small, frequently mutated)
  const [cats, itms, custs, supps, pcList, pcRules, pcItems, soList, soItems, accts, settings] = await Promise.all([
    db.select().from(categories),
    db.select().from(items),
    db.select().from(customers),
    db.select().from(suppliers),
    db.select().from(priceContracts),
    db.select().from(priceContractRules),
    db.select().from(priceContractItems),
    db.select().from(seasonalOffers),
    db.select().from(seasonalOfferItems),
    db.select().from(accounts),
    db.select().from(systemSettings).then(rows => rows.filter(r => r.key !== "settings_password")),
  ]);

  // Transaction tables — differential if sinceDate provided, otherwise full
  let invs: any[], invItems: any[], piList: any[], piItems: any[],
      pays: any[], suppPays: any[], jes: any[], jeLines: any[], exps: any[];

  if (sinceDate) {
    invs = await db.select().from(invoices).where(gte(invoices.createdAt, sinceDate));
    const invIds = invs.map(i => i.id);
    invItems = invIds.length
      ? await db.select().from(invoiceItems).where(sql`${invoiceItems.invoiceId} = ANY(ARRAY[${sql.raw(invIds.map(id => `'${id}'`).join(","))}]::text[])`)
      : [];

    piList = await db.select().from(purchaseInvoices).where(gte(purchaseInvoices.createdAt, sinceDate));
    const piIds = piList.map(i => i.id);
    piItems = piIds.length
      ? await db.select().from(purchaseInvoiceItems).where(sql`${purchaseInvoiceItems.purchaseInvoiceId} = ANY(ARRAY[${sql.raw(piIds.map(id => `'${id}'`).join(","))}]::text[])`)
      : [];

    pays = await db.select().from(payments).where(gte(payments.createdAt, sinceDate));
    suppPays = await db.select().from(supplierPayments).where(gte(supplierPayments.createdAt, sinceDate));

    jes = await db.select().from(journalEntries).where(gte(journalEntries.createdAt, sinceDate));
    const jeIds = jes.map(j => j.id);
    jeLines = jeIds.length
      ? await db.select().from(journalEntryLines).where(sql`${journalEntryLines.journalEntryId} = ANY(ARRAY[${sql.raw(jeIds.map(id => `'${id}'`).join(","))}]::text[])`)
      : [];

    exps = await db.select().from(expenses).where(gte(expenses.createdAt, sinceDate));
  } else {
    [invs, invItems, piList, piItems, pays, suppPays, jes, jeLines, exps] = await Promise.all([
      db.select().from(invoices),
      db.select().from(invoiceItems),
      db.select().from(purchaseInvoices),
      db.select().from(purchaseInvoiceItems),
      db.select().from(payments),
      db.select().from(supplierPayments),
      db.select().from(journalEntries),
      db.select().from(journalEntryLines),
      db.select().from(expenses),
    ]);
  }

  const data = {
    categories: cats, items: itms, customers: custs, suppliers: supps,
    invoices: invs, invoiceItems: invItems,
    purchaseInvoices: piList, purchaseInvoiceItems: piItems,
    payments: pays, supplierPayments: suppPays,
    priceContracts: pcList, priceContractRules: pcRules, priceContractItems: pcItems,
    seasonalOffers: soList, seasonalOfferItems: soItems,
    accounts: accts, journalEntries: jes, journalEntryLines: jeLines,
    expenses: exps, settings,
  };

  const tableCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) {
    tableCounts[k] = Array.isArray(v) ? v.length : 0;
  }

  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    version: 2,
    backupType: sinceDate ? "differential" : "full",
    sinceDate: sinceDate ? sinceDate.toISOString() : null,
    tableCounts,
    data,
  }, null, 2);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function autoCreateJournalEntry(opts: {
  sourceType: string;
  sourceId: string;
  date: string;
  description: string;
  reference: string;
  lines: { accountCode: string; debit: number; credit: number; description: string }[];
}) {
  try {
    const resolvedLines = [];
    for (const line of opts.lines) {
      const account = await storage.getAccountByCode(line.accountCode);
      if (!account) continue;
      if (line.debit === 0 && line.credit === 0) continue;
      resolvedLines.push({
        journalEntryId: "",
        accountId: account.id,
        debit: line.debit.toFixed(2),
        credit: line.credit.toFixed(2),
        description: line.description,
      });
    }
    if (resolvedLines.length < 2) return null;

    const totalDebits = resolvedLines.reduce((s, l) => s + parseFloat(l.debit), 0);
    const totalCredits = resolvedLines.reduce((s, l) => s + parseFloat(l.credit), 0);
    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      console.error(`Auto journal entry aborted: debits (${totalDebits}) != credits (${totalCredits}) for ${opts.sourceType}/${opts.sourceId}`);
      return null;
    }

    const entryNumber = await storage.getNextJournalEntryNumber();
    return await storage.createJournalEntry(
      {
        entryNumber,
        date: opts.date,
        description: opts.description,
        reference: opts.reference,
        sourceType: opts.sourceType,
        sourceId: opts.sourceId,
        status: "posted",
        totalAmount: resolvedLines.reduce((s, l) => s + parseFloat(l.debit), 0).toFixed(2),
      },
      resolvedLines
    );
  } catch (e) {
    console.error("Auto journal entry failed:", e);
    return null;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Serve sw.js with no-cache headers so browsers always get the latest version
  app.get("/sw.js", (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    next();
  });

  activityMiddleware(app);

  // ─── AUTH ───────────────────────────────────────────────────────────────────
  async function completeLogin(res: Response, user: any, ip: string, ua: string, timestamp: string) {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const permissions: string[] = JSON.parse(user.permissions || "[]");
    const token = signToken({ id: user.id, username: user.username, email: user.email, role: user.role, permissions });
    setAuthCookie(res, token);
    logActivity(user.id, user.username, "login", "auth", null, `Login from ${ip}`, ip, ua);

    const recentLogins = await db.select({ ipAddress: activityLogs.ipAddress })
      .from(activityLogs)
      .where(and(
        eq(activityLogs.userId, user.id),
        eq(activityLogs.action, "login"),
        gte(activityLogs.createdAt, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000))
      ))
      .limit(100);

    const knownIps = new Set(recentLogins.map((r: any) => r.ipAddress).filter(Boolean));
    knownIps.delete(ip);
    if (!knownIps.has(ip)) {
      getAdminEmails().then(emails => {
        if (emails.length) sendLoginAlertEmail(emails, user.username, ip, ua, timestamp);
      });
    }
  }

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
      const ua = req.headers["user-agent"] || "unknown";
      const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Europe/Nicosia", hour12: false });

      // Rate limiting — block after 10 failed attempts in 15 minutes
      const { blocked } = checkRateLimit(ip);
      if (blocked) {
        return res.status(429).json({ message: "Too many failed attempts. Please try again in 15 minutes." });
      }

      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ message: "Username and password required" });

      const [user] = await db.select().from(users).where(eq(users.username, username.toLowerCase().trim()));

      if (!user || !user.active || !verifyPassword(password, user.password)) {
        // Record failed attempt
        const failCount = recordFailedAttempt(ip);
        logActivity(null, username || null, "login_failed", "auth", null, `Failed login attempt for "${username}" from ${ip}`, ip, ua);

        // Send alert after 3 failures, then every 5 thereafter
        if (failCount === 3 || (failCount > 3 && failCount % 5 === 0)) {
          const entry = failedAttempts.get(ip);
          if (entry && !entry.alerted) {
            entry.alerted = true;
            getAdminEmails().then(emails => {
              if (emails.length) sendFailedLoginAlertEmail(emails, username, ip, failCount, timestamp);
            });
          } else if (entry && failCount % 5 === 0) {
            getAdminEmails().then(emails => {
              if (emails.length) sendFailedLoginAlertEmail(emails, username, ip, failCount, timestamp);
            });
          }
        }

        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Successful password check — clear any failed attempt counter
      clearFailedAttempts(ip);

      // If 2FA is enabled, issue a temp token and require TOTP verification
      if (user.totpEnabled && user.totpSecret) {
        const tempToken = signTempToken(user.id);
        return res.json({ requires2fa: true, tempToken });
      }

      // No 2FA configured — force setup before completing login
      const tempToken = signTempToken(user.id);
      return res.json({ requires2faSetup: true, tempToken });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── 2FA: Verify TOTP during login ──────────────────────────────────────────
  app.post("/api/auth/2fa/verify", async (req: Request, res: Response) => {
    try {
      const { tempToken, code } = req.body;
      if (!tempToken || !code) return res.status(400).json({ message: "Token and code required" });

      const userId = verifyTempToken(tempToken);
      if (!userId) return res.status(401).json({ message: "Session expired. Please log in again." });

      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user || !user.active || !user.totpSecret) return res.status(401).json({ message: "Invalid session" });

      const cleanToken2fa = code.replace(/\s/g, "");
      const result = totpVerify({ token: cleanToken2fa, secret: user.totpSecret, window: 1 });
      // [2FA login] result logged without exposing token
      if (!result.valid) return res.status(401).json({ message: "Invalid authentication code" });

      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
      const ua = req.headers["user-agent"] || "unknown";
      const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Europe/Nicosia", hour12: false });

      await completeLogin(res, user, ip, ua, timestamp);
      res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── 2FA: Generate setup QR code ────────────────────────────────────────────
  app.get("/api/auth/2fa/setup", async (req: Request, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Not authenticated" });
      const secret = totpGenerateSecret();
      const otpauth = totpGenerateURI({ secret, label: req.user.username, issuer: "FC GASTRONOBILE" });
      const qrDataUrl = await QRCode.toDataURL(String(otpauth));
      res.json({ secret, qrDataUrl });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── 2FA: Enable TOTP (confirm with code) ───────────────────────────────────
  app.post("/api/auth/2fa/enable", async (req: Request, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Not authenticated" });
      const { secret, code } = req.body;
      if (!secret || !code) return res.status(400).json({ message: "Secret and code required" });

      const cleanToken = code.replace(/\s/g, "");
      const result = totpVerify({ token: cleanToken, secret, window: 1 });
      // [2FA enable] result logged without exposing secret or token
      if (!result.valid) return res.status(400).json({ message: "Invalid code — please try again" });

      await db.update(users).set({ totpSecret: secret, totpEnabled: true }).where(eq(users.id, req.user.id));
      logActivity(req.user.id, req.user.username, "update", "user", req.user.id, "Two-factor authentication enabled", null, null);
      res.json({ message: "Two-factor authentication enabled" });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── 2FA: Disable TOTP ──────────────────────────────────────────────────────
  app.post("/api/auth/2fa/disable", async (req: Request, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Not authenticated" });
      const { code } = req.body;
      const [user] = await db.select().from(users).where(eq(users.id, req.user.id));
      if (!user || !user.totpSecret || !user.totpEnabled) return res.status(400).json({ message: "2FA is not enabled" });

      const result = totpVerify({ token: (code || "").replace(/\s/g, ""), secret: user.totpSecret, window: 1 });
      if (!result.valid) return res.status(400).json({ message: "Invalid authentication code" });

      await db.update(users).set({ totpSecret: null, totpEnabled: false }).where(eq(users.id, req.user.id));
      logActivity(req.user.id, req.user.username, "update", "user", req.user.id, "Two-factor authentication disabled", null, null);
      res.json({ message: "Two-factor authentication disabled" });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── 2FA: Status ────────────────────────────────────────────────────────────
  app.get("/api/auth/2fa/status", async (req: Request, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Not authenticated" });
      const [user] = await db.select({ totpEnabled: users.totpEnabled }).from(users).where(eq(users.id, req.user.id));
      res.json({ totpEnabled: user?.totpEnabled ?? false });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── 2FA: Initial forced setup (pre-login, using tempToken) ─────────────────
  // Pending secret is stored in the DB (totpSecret, totpEnabled=false) so it
  // survives server restarts. No in-memory state needed.

  app.get("/api/auth/2fa/setup-initial", async (req: Request, res: Response) => {
    try {
      const { token } = req.query as { token: string };
      const userId = verifyTempToken(token);
      if (!userId) return res.status(401).json({ message: "Session expired. Please log in again." });
      const [user] = await db.select({ username: users.username, totpSecret: users.totpSecret, totpEnabled: users.totpEnabled }).from(users).where(eq(users.id, userId));
      if (!user) return res.status(401).json({ message: "User not found" });
      // Reuse any already-pending secret (not yet enabled) so repeated calls return the same QR
      let secret = (!user.totpEnabled && user.totpSecret) ? user.totpSecret : null;
      if (!secret) {
        secret = totpGenerateSecret();
        await db.update(users).set({ totpSecret: secret, totpEnabled: false }).where(eq(users.id, userId));
      }
      const otpauth = totpGenerateURI({ secret, label: user.username, issuer: "FC GASTRONOBILE" });
      const qrDataUrl = await QRCode.toDataURL(String(otpauth));
      res.json({ secret, qrDataUrl });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/auth/2fa/setup-initial", async (req: Request, res: Response) => {
    try {
      const { tempToken, code } = req.body;
      if (!tempToken || !code) return res.status(400).json({ message: "Token and code required" });
      const userId = verifyTempToken(tempToken);
      if (!userId) return res.status(401).json({ message: "Session expired. Please log in again." });
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user || !user.active) return res.status(401).json({ message: "Invalid session" });
      if (!user.totpSecret || user.totpEnabled) return res.status(400).json({ message: "No pending 2FA setup. Please log in again." });
      const result = totpVerify({ token: code.replace(/\s/g, ""), secret: user.totpSecret, window: 1 });
      if (!result.valid) return res.status(400).json({ message: "Invalid code — please try again" });
      await db.update(users).set({ totpEnabled: true }).where(eq(users.id, userId));
      logActivity(userId, user.username, "update", "user", userId, "Two-factor authentication enabled (forced setup)", null, null);
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
      const ua = req.headers["user-agent"] || "unknown";
      const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Europe/Nicosia", hour12: false });
      await completeLogin(res, user, ip, ua, timestamp);
      res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── Admin: Reset another user's 2FA ────────────────────────────────────────
  app.post("/api/users/:id/reset-2fa", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (id === req.user!.id) return res.status(400).json({ message: "Use the 2FA settings to manage your own 2FA" });
      const [target] = await db.select({ id: users.id, username: users.username }).from(users).where(eq(users.id, id));
      if (!target) return res.status(404).json({ message: "User not found" });
      await db.update(users).set({ totpSecret: null, totpEnabled: false }).where(eq(users.id, id));
      logActivity(req.user!.id, req.user!.username, "update", "user", id, `Reset 2FA for user ${target.username}`, null, null);
      res.json({ message: "2FA reset — user will be prompted to set it up on next login" });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    // Always fetch fresh from DB so permissions/role changes take effect without re-login
    const [dbUser] = await db.select({ id: users.id, username: users.username, email: users.email, role: users.role, permissions: users.permissions }).from(users).where(eq(users.id, req.user.id));
    if (!dbUser) return res.status(401).json({ message: "User not found" });
    res.json({ ...dbUser, permissions: JSON.parse(dbUser.permissions || "[]") });
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    if (req.user) {
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.ip || null;
      const ua = req.headers["user-agent"] || null;
      logActivity(req.user.id, req.user.username, "logout", "auth", null, "Logout", ip, ua);
    }
    clearAuthCookie(res);
    res.json({ message: "Logged out" });
  });

  // ─── USERS (admin only) ──────────────────────────────────────────────────────
  app.get("/api/users", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const rows = await db.select({ id: users.id, username: users.username, email: users.email, role: users.role, active: users.active, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt, totpEnabled: users.totpEnabled, permissions: users.permissions }).from(users).orderBy(users.createdAt);
      res.json(rows.map(r => ({ ...r, permissions: JSON.parse(r.permissions || "[]") })));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { username, email, password, role, permissions } = req.body;
      if (!username || !password) return res.status(400).json({ message: "Username and password required" });
      const allowedRoles = ["staff", "admin", "superuser"];
      if (role && !allowedRoles.includes(role)) return res.status(400).json({ message: "Invalid role" });
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, username.toLowerCase().trim()));
      if (existing.length > 0) return res.status(409).json({ message: "Username already exists" });
      const [user] = await db.insert(users).values({ username: username.toLowerCase().trim(), email: email || null, password: hashPassword(password), role: role || "staff", active: true, permissions: JSON.stringify(Array.isArray(permissions) ? permissions : []) }).returning({ id: users.id, username: users.username, email: users.email, role: users.role, active: users.active, createdAt: users.createdAt, permissions: users.permissions });

      // Alert all admins when a new admin/superuser is created
      if ((role || "staff") !== "staff" && req.user) {
        const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
        const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Europe/Nicosia", hour12: false });
        getAdminEmails().then(emails => {
          if (emails.length) sendNewAdminAlertEmail(emails, username.toLowerCase().trim(), req.user!.username, ip, timestamp);
        });
      }

      res.status(201).json({ ...user, permissions: JSON.parse(user.permissions || "[]") });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.put("/api/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { username, email, role, active, password, permissions } = req.body;
      const allowedRoles = ["staff", "admin", "superuser"];
      if (role && !allowedRoles.includes(role)) return res.status(400).json({ message: "Invalid role" });
      const updates: any = {};
      if (username) updates.username = username.toLowerCase().trim();
      if (email !== undefined) updates.email = email || null;
      if (role) updates.role = role;
      if (active !== undefined) updates.active = active;
      if (password) updates.password = hashPassword(password);
      if (permissions !== undefined) updates.permissions = JSON.stringify(Array.isArray(permissions) ? permissions : []);
      const [updated] = await db.update(users).set(updates).where(eq(users.id, req.params.id)).returning({ id: users.id, username: users.username, email: users.email, role: users.role, active: users.active, permissions: users.permissions });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json({ ...updated, permissions: JSON.parse(updated.permissions || "[]") });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      if (req.user?.id === req.params.id) return res.status(400).json({ message: "Cannot delete your own account" });
      await db.delete(users).where(eq(users.id, req.params.id));
      res.json({ message: "User deleted" });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Change own password
  app.post("/api/users/change-password", async (req: Request, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Not authenticated" });
      const { currentPassword, newPassword } = req.body;
      const [user] = await db.select().from(users).where(eq(users.id, req.user.id));
      if (!user || !verifyPassword(currentPassword, user.password)) return res.status(400).json({ message: "Current password is incorrect" });
      await db.update(users).set({ password: hashPassword(newPassword) }).where(eq(users.id, req.user.id));
      res.json({ message: "Password changed" });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── ACTIVITY LOGS (admin only) ─────────────────────────────────────────────
  app.get("/api/activity-logs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 200;
      const offset = parseInt(req.query.offset as string) || 0;
      const rows = await db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(limit).offset(offset);
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── DATA EXPORT / IMPORT (admin only) ──────────────────────────────────────
  app.get("/api/admin/export", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const [
        settingsRows, categoriesRows, itemsRows, customersRows, suppliersRows,
        invoicesRows, invoiceItemsRows, paymentsRows,
        purchaseInvoicesRows, purchaseInvoiceItemsRows, supplierPaymentsRows,
        accountsRows, journalEntriesRows, journalEntryLinesRows, expensesRows,
        priceContractsRows, priceContractRulesRows, priceContractItemsRows,
        seasonalOffersRows, seasonalOfferItemsRows,
      ] = await Promise.all([
        db.select().from(systemSettings),
        db.select().from(categories),
        db.select().from(items),
        db.select().from(customers),
        db.select().from(suppliers),
        db.select().from(invoices),
        db.select().from(invoiceItems),
        db.select().from(payments),
        db.select().from(purchaseInvoices),
        db.select().from(purchaseInvoiceItems),
        db.select().from(supplierPayments),
        db.select().from(accounts),
        db.select().from(journalEntries),
        db.select().from(journalEntryLines),
        db.select().from(expenses),
        db.select().from(priceContracts),
        db.select().from(priceContractRules),
        db.select().from(priceContractItems),
        db.select().from(seasonalOffers),
        db.select().from(seasonalOfferItems),
      ]);
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        systemSettings: settingsRows,
        categories: categoriesRows,
        items: itemsRows,
        customers: customersRows,
        suppliers: suppliersRows,
        invoices: invoicesRows,
        invoiceItems: invoiceItemsRows,
        payments: paymentsRows,
        purchaseInvoices: purchaseInvoicesRows,
        purchaseInvoiceItems: purchaseInvoiceItemsRows,
        supplierPayments: supplierPaymentsRows,
        accounts: accountsRows,
        journalEntries: journalEntriesRows,
        journalEntryLines: journalEntryLinesRows,
        expenses: expensesRows,
        priceContracts: priceContractsRows,
        priceContractRules: priceContractRulesRows,
        priceContractItems: priceContractItemsRows,
        seasonalOffers: seasonalOffersRows,
        seasonalOfferItems: seasonalOfferItemsRows,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/import", requireAdmin, async (req: Request, res: Response) => {
    try {
      const data = req.body;
      if (!data || data.version !== 1) return res.status(400).json({ message: "Invalid export file" });

      // Clear all data tables (preserve users)
      await db.delete(journalEntryLines);
      await db.delete(journalEntries);
      await db.delete(expenses);
      await db.delete(supplierPayments);
      await db.delete(purchaseInvoiceItems);
      await db.delete(purchaseInvoices);
      await db.delete(payments);
      await db.delete(invoiceItems);
      await db.delete(invoices);
      await db.delete(priceContractRules);
      await db.delete(priceContractItems);
      await db.delete(priceContracts);
      await db.delete(seasonalOfferItems);
      await db.delete(seasonalOffers);
      await db.delete(customers);
      await db.delete(suppliers);
      await db.delete(items);
      await db.delete(categories);
      await db.delete(accounts);
      await db.delete(systemSettings);

      const ins = async (table: any, rows: any[]) => { if (rows?.length) await db.insert(table).values(rows); };

      await ins(systemSettings, data.systemSettings);
      await ins(categories, data.categories);
      await ins(items, data.items);
      await ins(customers, data.customers);
      await ins(suppliers, data.suppliers);
      await ins(accounts, data.accounts);
      await ins(invoices, data.invoices);
      await ins(invoiceItems, data.invoiceItems);
      await ins(payments, data.payments);
      await ins(purchaseInvoices, data.purchaseInvoices);
      await ins(purchaseInvoiceItems, data.purchaseInvoiceItems);
      await ins(supplierPayments, data.supplierPayments);
      await ins(journalEntries, data.journalEntries);
      await ins(journalEntryLines, data.journalEntryLines);
      await ins(expenses, data.expenses);
      await ins(priceContracts, data.priceContracts);
      await ins(priceContractRules, data.priceContractRules);
      await ins(priceContractItems, data.priceContractItems);
      await ins(seasonalOffers, data.seasonalOffers);
      await ins(seasonalOfferItems, data.seasonalOfferItems);

      res.json({ message: "Data imported successfully" });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Dashboard
  app.get("/api/dashboard/stats", async (_req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/dashboard/charts", async (_req, res) => {
    try {
      const charts = await storage.getDashboardCharts();
      res.json(charts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Categories
  app.get("/api/categories", async (_req, res) => {
    const cats = await storage.getCategories();
    res.json(cats);
  });

  app.post("/api/categories", async (req, res) => {
    try {
      const data = insertCategorySchema.parse(req.body);
      if (data.parentId === "none" || data.parentId === "") data.parentId = null;
      const cat = await storage.createCategory(data);
      res.json(cat);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/categories/:id", async (req, res) => {
    try {
      const { name, description, parentId, vatRate, active } = req.body;
      const update: any = {};
      if (name !== undefined) update.name = name;
      if (description !== undefined) update.description = description;
      if (parentId !== undefined) update.parentId = (parentId === "none" || parentId === "") ? null : parentId;
      if (vatRate !== undefined) update.vatRate = vatRate === "" ? null : vatRate;
      if (active !== undefined) update.active = active;
      const [updated] = await db.update(categories).set(update).where(eq(categories.id, req.params.id)).returning();
      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Items
  app.get("/api/items", async (_req, res) => {
    const allItems = await storage.getItems();
    res.json(allItems);
  });

  app.get("/api/items/brands", async (_req, res) => {
    const allItems = await storage.getItems();
    const brandSet = new Set<string>();
    allItems.forEach(i => { if (i.brand) brandSet.add(i.brand); });
    const brands = Array.from(brandSet).sort();
    res.json(brands);
  });

  app.get("/api/items/:id", async (req, res) => {
    const item = await storage.getItem(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  });

  app.get("/api/items/barcode/:barcode", async (req, res) => {
    const item = await storage.getItemByBarcode(req.params.barcode);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  });

  app.get("/api/items/suggest-sku/:categoryId", async (req, res) => {
    try {
      const allItems = await storage.getItems();
      const categories = await storage.getCategories();
      const category = categories.find(c => c.id === req.params.categoryId);
      const prefix = category
        ? category.name.split(/\s+/).map(w => w[0]?.toUpperCase()).join("").substring(0, 3)
        : "ITM";
      const existing = allItems
        .filter(i => i.sku.startsWith(prefix + "-"))
        .map(i => parseInt(i.sku.replace(prefix + "-", "")) || 0);
      const next = (existing.length > 0 ? Math.max(...existing) : 0) + 1;
      res.json({ sku: `${prefix}-${String(next).padStart(3, "0")}` });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  const numericStringFields = ["price1", "price2", "price3", "price4", "price5", "costPrice", "vatRate", "alcoholPercentage"];
  const numericIntFields = ["stockQuantity", "reorderLevel", "packSize"];
  function sanitizeItemNumericFields(body: any) {
    for (const field of numericStringFields) {
      if (field === "vatRate") {
        // null/undefined/empty means "inherit from category" — keep as null
        if (body[field] === "") body[field] = null;
      } else if (body[field] === "" || body[field] === null || body[field] === undefined) {
        body[field] = "0";
      }
    }
    for (const field of numericIntFields) {
      if (body[field] === "" || body[field] === null || body[field] === undefined) {
        body[field] = field === "packSize" ? 1 : 0;
      } else if (typeof body[field] === "string") {
        body[field] = parseInt(body[field], 10) || (field === "packSize" ? 1 : 0);
      }
    }
    return body;
  }

  function sanitizeNumericFields(body: any, fields: string[], defaultVal = "0") {
    for (const field of fields) {
      if (body[field] === "" || body[field] === null || body[field] === undefined) {
        body[field] = defaultVal;
      }
    }
    return body;
  }

  app.post("/api/items", async (req, res) => {
    try {
      sanitizeItemNumericFields(req.body);
      const data = insertItemSchema.parse(req.body);
      if (data.categoryId === "") data.categoryId = null;
      const item = await storage.createItem(data);
      res.json(item);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/items/:id", async (req, res) => {
    try {
      sanitizeItemNumericFields(req.body);
      const item = await storage.updateItem(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Item not found" });
      res.json(item);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/items/:id/price-history", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const history = await storage.getItemPriceHistory(req.params.id, limit, from, to);
      res.json(history);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/items/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = await readExcelWorkbook(req.file.buffer, req.file.originalname);
      const sheetName = req.body.sheetName || workbook.worksheets[0]?.name;
      const sheet = workbook.getWorksheet(sheetName);
      if (!sheet) return res.status(400).json({ message: `Sheet "${sheetName}" not found` });
      const rows: any[] = worksheetToJson(sheet, "");
      if (!rows.length) return res.status(400).json({ message: "File is empty" });

      const columnMap = req.body.columnMap ? JSON.parse(req.body.columnMap) : {};
      const categories = await storage.getCategories();
      const catMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));

      const results: { success: number; errors: { row: number; message: string }[] } = { success: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const getValue = (field: string) => {
            const col = columnMap[field] || field;
            return row[col] !== undefined ? String(row[col]).trim() : "";
          };

          const name = getValue("name");
          const sku = getValue("sku");
          if (!name || !sku) {
            results.errors.push({ row: i + 2, message: "Name and SKU are required" });
            continue;
          }

          const categoryName = getValue("category");
          let categoryId: string | null = null;
          if (categoryName) {
            categoryId = catMap.get(categoryName.toLowerCase()) || null;
            if (!categoryId) {
              const newCat = await storage.createCategory({ name: categoryName, description: null, parentId: null, active: true });
              categoryId = newCat.id;
              catMap.set(categoryName.toLowerCase(), newCat.id);
            }
          }

          const itemData = {
            name,
            sku,
            barcode: getValue("barcode") || null,
            description: getValue("description") || null,
            categoryId,
            unitType: getValue("unitType") || "pc",
            packSize: parseInt(getValue("packSize")) || 1,
            price1: getValue("price1") || "0",
            price2: getValue("price2") || "0",
            price3: getValue("price3") || "0",
            price4: getValue("price4") || "0",
            price5: getValue("price5") || "0",
            costPrice: getValue("costPrice") || "0",
            stockQuantity: parseInt(getValue("stockQuantity")) || 0,
            reorderLevel: parseInt(getValue("reorderLevel")) || 10,
            volume: getValue("volume") || null,
            alcoholPercentage: getValue("alcoholPercentage") || null,
            brand: getValue("brand") || null,
            origin: getValue("origin") || null,
            vintage: getValue("vintage") || null,
            active: true,
          };

          await storage.createItem(itemData);
          results.success++;
        } catch (e: any) {
          results.errors.push({ row: i + 2, message: e.message });
        }
      }

      res.json(results);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/items/import/json", async (req, res) => {
    try {
      const { rows } = req.body;
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No data rows provided" });
      }
      if (rows.length > 10000) {
        return res.status(400).json({ message: "Too many rows (max 10000)" });
      }

      const categories = await storage.getCategories();
      const catMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));
      const results: { success: number; errors: { row: number; message: string }[] } = { success: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          if (typeof row !== "object" || row === null) {
            results.errors.push({ row: i + 1, message: "Invalid row data" });
            continue;
          }
          const name = String(row.name || "").trim();
          const sku = String(row.sku || "").trim();
          if (!name || !sku) {
            results.errors.push({ row: i + 1, message: "Name and SKU are required" });
            continue;
          }

          const categoryName = String(row.category || "").trim();
          let categoryId: string | null = null;
          if (categoryName) {
            categoryId = catMap.get(categoryName.toLowerCase()) || null;
            if (!categoryId) {
              const newCat = await storage.createCategory({ name: categoryName, description: null, parentId: null, active: true });
              categoryId = newCat.id;
              catMap.set(categoryName.toLowerCase(), newCat.id);
            }
          }

          await storage.createItem({
            name,
            sku,
            barcode: row.barcode || null,
            description: row.description || null,
            categoryId,
            unitType: row.unitType || "pc",
            packSize: parseInt(row.packSize) || 1,
            price1: row.price1 || "0",
            price2: row.price2 || "0",
            price3: row.price3 || "0",
            price4: row.price4 || "0",
            price5: row.price5 || "0",
            costPrice: row.costPrice || "0",
            stockQuantity: parseInt(row.stockQuantity) || 0,
            reorderLevel: parseInt(row.reorderLevel) || 10,
            volume: row.volume || null,
            alcoholPercentage: row.alcoholPercentage || null,
            brand: row.brand || null,
            origin: row.origin || null,
            vintage: row.vintage || null,
            active: true,
          });
          results.success++;
        } catch (e: any) {
          results.errors.push({ row: i + 1, message: e.message });
        }
      }

      res.json(results);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Customers
  app.get("/api/customers", async (_req, res) => {
    const custs = await storage.getCustomers();
    res.json(custs);
  });

  app.get("/api/customers/next-code", async (_req, res) => {
    try {
      const code = await storage.getNextCustomerCode();
      res.json({ code });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    const cust = await storage.getCustomer(req.params.id);
    if (!cust) return res.status(404).json({ message: "Customer not found" });
    res.json(cust);
  });

  app.get("/api/customers/:id/analytics", async (req, res) => {
    try {
      const customerId = req.params.id;
      const cust = await storage.getCustomer(customerId);
      if (!cust) return res.status(404).json({ message: "Customer not found" });

      const custInvoices = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.customerId, customerId), eq(invoices.type, "invoice"), sql`${invoices.status} != 'cancelled'`));

      let totalRevenue = 0;
      let totalCost = 0;
      let overdueCount = 0;
      for (const inv of custInvoices) {
        const rev = parseFloat(inv.subtotal) - parseFloat(inv.discountAmount || "0");
        totalRevenue += rev;
        if (inv.status === "overdue") overdueCount++;
        const lineItems = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
        for (const li of lineItems) {
          if (li.itemId) {
            const itm = await db.select({ costPrice: items.costPrice, packSize: items.packSize }).from(items).where(eq(items.id, li.itemId)).limit(1);
            if (itm.length > 0) {
              const units = li.saleUnit === "pack" ? li.quantity * (itm[0].packSize || 1) : li.quantity;
              totalCost += parseFloat(itm[0].costPrice) * units;
            }
          }
        }
      }

      const invoiceCount = custInvoices.length;
      const totalProfit = totalRevenue - totalCost;
      const marginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
      const avgInvoiceValue = invoiceCount > 0 ? totalRevenue / invoiceCount : 0;
      const creditLimit = parseFloat(cust.creditLimit || "0");
      const currentBalance = parseFloat(cust.currentBalance || "0");
      const creditUtilization = creditLimit > 0 ? Math.min(currentBalance / creditLimit, 1) : 0;

      const termsScore: Record<string, number> = { cash: 100, credit_7: 85, credit_14: 75, credit_30: 60, credit_60: 45, credit_90: 30 };
      const basePayment = termsScore[cust.paymentTerms] ?? 50;
      const paymentScore = Math.max(0, Math.min(100, basePayment - overdueCount * 15));

      const revenueScore = Math.min(100, Math.round(Math.log1p(totalRevenue) / Math.log1p(25000) * 100));
      const marginScore = Math.min(100, Math.max(0, Math.round(marginPct / 40 * 100)));
      const activityScore = Math.min(100, Math.round(invoiceCount / 50 * 100));
      const creditHealthScore = Math.round((1 - creditUtilization) * 100);

      res.json({
        revenue: Math.round(totalRevenue * 100) / 100,
        profit: Math.round(totalProfit * 100) / 100,
        invoiceCount,
        overdueCount,
        avgInvoiceValue: Math.round(avgInvoiceValue * 100) / 100,
        marginPct: Math.round(marginPct * 10) / 10,
        creditUtilization: Math.round(creditUtilization * 1000) / 10,
        scores: {
          revenue: revenueScore,
          margin: marginScore,
          activity: activityScore,
          payment: paymentScore,
          creditHealth: creditHealthScore,
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const data = insertCustomerSchema.parse(req.body);

      if (!data.code || data.code.trim() === "") {
        data.code = await storage.getNextCustomerCode();
      }

      const duplicates = await storage.findDuplicateCustomer(data.name, data.email, data.taxId);
      if (duplicates.length > 0) {
        const matchReasons: string[] = [];
        for (const dup of duplicates) {
          if (dup.name.toLowerCase().trim() === data.name.toLowerCase().trim()) matchReasons.push(`name "${dup.name}" (${dup.code})`);
          if (data.email && dup.email && dup.email.toLowerCase().trim() === data.email.toLowerCase().trim()) matchReasons.push(`email "${dup.email}" (${dup.code})`);
          if (data.taxId && dup.taxId && dup.taxId.toLowerCase().trim() === data.taxId.toLowerCase().trim()) matchReasons.push(`tax ID "${dup.taxId}" (${dup.code})`);
        }
        return res.status(409).json({
          message: `Duplicate customer found: ${matchReasons.join(", ")}`,
          duplicates: duplicates.map(d => ({ id: d.id, name: d.name, code: d.code, email: d.email, taxId: d.taxId })),
        });
      }

      const cust = await storage.createCustomer(data);
      res.json(cust);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/customers/:id", async (req, res) => {
    if (!req.user || (req.user.role !== "admin" && req.user.role !== "superuser")) {
      return res.status(403).json({ message: "Admin access required" });
    }
    try {
      const cust = await storage.updateCustomer(req.params.id, req.body);
      if (!cust) return res.status(404).json({ message: "Customer not found" });
      res.json(cust);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/customers/:id", async (req, res) => {
    if (!req.user || (req.user.role !== "admin" && req.user.role !== "superuser")) {
      return res.status(403).json({ message: "Admin access required" });
    }
    try {
      const cust = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, req.params.id)).limit(1);
      if (!cust.length) return res.status(404).json({ message: "Customer not found" });
      const linked = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.customerId, req.params.id)).limit(1);
      if (linked.length > 0) {
        return res.status(400).json({ message: "Cannot delete: customer has invoices. Remove them first or mark the customer inactive." });
      }
      await storage.deleteCustomer(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/customers/:id/delivery-locations", async (req, res) => {
    try {
      const locs = await storage.getCustomerDeliveryLocations(req.params.id);
      res.json(locs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/customers/:id/delivery-locations", async (req, res) => {
    try {
      const loc = await storage.createCustomerDeliveryLocation({ ...req.body, customerId: req.params.id });
      res.json(loc);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/customers/:customerId/delivery-locations/:locId", async (req, res) => {
    try {
      const loc = await storage.updateCustomerDeliveryLocation(req.params.locId, { ...req.body, customerId: req.params.customerId });
      if (!loc) return res.status(404).json({ message: "Location not found" });
      res.json(loc);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/customers/:customerId/delivery-locations/:locId", async (req, res) => {
    try {
      await storage.deleteCustomerDeliveryLocation(req.params.locId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/customers/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = await readExcelWorkbook(req.file.buffer, req.file.originalname);
      const sheetName = req.body.sheetName || workbook.worksheets[0]?.name;
      const sheet = workbook.getWorksheet(sheetName);
      if (!sheet) return res.status(400).json({ message: `Sheet "${sheetName}" not found` });
      const rows: any[] = worksheetToJson(sheet, "");
      if (!rows.length) return res.status(400).json({ message: "File is empty" });

      const columnMap = req.body.columnMap ? JSON.parse(req.body.columnMap) : {};

      const results: { success: number; errors: { row: number; message: string }[] } = { success: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const getValue = (field: string) => {
            const col = columnMap[field] || field;
            return row[col] !== undefined ? String(row[col]).trim() : "";
          };

          const name = getValue("name");
          const code = getValue("code");
          if (!name || !code) {
            results.errors.push({ row: i + 2, message: "Name and Code are required" });
            continue;
          }

          const paymentTerms = getValue("paymentTerms") || "cash";
          const validTerms = ["cash", "credit_7", "credit_14", "credit_30", "credit_60", "credit_90"];
          
          const custData = {
            name,
            code: code.toUpperCase(),
            email: getValue("email") || null,
            phone: getValue("phone") || null,
            address: getValue("address") || null,
            city: getValue("city") || null,
            taxId: getValue("taxId") || null,
            paymentTerms: validTerms.includes(paymentTerms) ? paymentTerms : "cash",
            creditLimit: getValue("creditLimit") || "0",
            currentBalance: "0",
            priceLevel: parseInt(getValue("priceLevel")) || 1,
            notes: getValue("notes") || null,
            portalAccessCode: getValue("portalAccessCode") || null,
            active: true,
          };

          await storage.createCustomer(custData);
          results.success++;
        } catch (e: any) {
          results.errors.push({ row: i + 2, message: e.message });
        }
      }

      res.json(results);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Price Contracts
  app.get("/api/price-contracts", async (_req, res) => {
    const contracts = await storage.getPriceContracts();
    const contractsWithAll = await Promise.all(
      contracts.map(async (c) => {
        const rules = await storage.getContractRules(c.id);
        const contractItems = await storage.getContractItems(c.id);
        return { ...c, rules, contractItems };
      })
    );
    res.json(contractsWithAll);
  });

  app.post("/api/price-contracts/quick-save", async (req, res) => {
    try {
      const { customerId, itemId, fixedPrice } = req.body;
      if (!customerId || !itemId || fixedPrice == null) {
        return res.status(400).json({ message: "customerId, itemId, and fixedPrice are required" });
      }
      const result = await storage.quickSaveContractPrice(customerId, itemId, parseFloat(fixedPrice));
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/price-contracts", async (req, res) => {
    try {
      const { rules, ...contractData } = req.body;
      const data = insertPriceContractSchema.parse(contractData);
      const contract = await storage.createPriceContract(data);
      if (rules && Array.isArray(rules) && rules.length > 0) {
        await storage.setContractRules(contract.id, rules);
      }
      res.json(contract);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/price-contracts/:id", async (req, res) => {
    try {
      const { rules, ...contractData } = req.body;
      const contract = await storage.updatePriceContract(req.params.id, contractData);
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      if (rules && Array.isArray(rules)) {
        await storage.setContractRules(req.params.id, rules);
      }
      res.json(contract);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/price-contracts/:id/rules", async (req, res) => {
    const rules = await storage.getContractRules(req.params.id);
    res.json(rules);
  });

  app.put("/api/price-contracts/:id/rules", async (req, res) => {
    try {
      const rules = await storage.setContractRules(req.params.id, req.body.rules || []);
      res.json(rules);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/price-contracts/:id", async (req, res) => {
    try {
      const contract = await storage.getPriceContract(req.params.id);
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      if (contract.source !== "invoice-discount") {
        return res.status(403).json({ message: "Only auto-saved contracts can be deleted via this endpoint" });
      }
      await storage.deleteContract(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/price-contract-items/:itemId", async (req, res) => {
    try {
      const { specialPrice } = req.body;
      const parsedPrice = parseFloat(specialPrice);
      if (specialPrice === undefined || isNaN(parsedPrice) || parsedPrice <= 0) {
        return res.status(400).json({ message: "specialPrice is required and must be a positive number" });
      }
      const rows = await db.select({ id: priceContractItems.id, contractId: priceContractItems.contractId })
        .from(priceContractItems)
        .where(eq(priceContractItems.id, req.params.itemId));
      if (rows.length === 0) return res.status(404).json({ message: "Contract item not found" });
      const contract = await storage.getPriceContract(rows[0].contractId);
      if (!contract || contract.source !== "invoice-discount") {
        return res.status(403).json({ message: "Only items in auto-saved contracts can be edited via this endpoint" });
      }
      const updated = await storage.updateContractItem(req.params.itemId, parsedPrice);
      if (!updated) return res.status(404).json({ message: "Contract item not found or could not be updated" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/price-contract-items/:itemId", async (req, res) => {
    try {
      const items = await db.select({ id: priceContractItems.id, contractId: priceContractItems.contractId })
        .from(priceContractItems)
        .where(eq(priceContractItems.id, req.params.itemId));
      if (items.length === 0) return res.status(404).json({ message: "Contract item not found" });
      const contract = await storage.getPriceContract(items[0].contractId);
      if (!contract || contract.source !== "invoice-discount") {
        return res.status(403).json({ message: "Only items in auto-saved contracts can be deleted via this endpoint" });
      }
      await storage.deleteContractItem(req.params.itemId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Seasonal Offers
  app.get("/api/seasonal-offers", async (_req, res) => {
    const offers = await storage.getSeasonalOffers();
    res.json(offers);
  });

  app.post("/api/seasonal-offers", async (req, res) => {
    try {
      const data = insertSeasonalOfferSchema.parse(req.body);
      const offer = await storage.createSeasonalOffer(data);
      res.json(offer);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Invoices
  app.get("/api/invoices", async (req, res) => {
    const type = req.query.type as string | undefined;
    // Handle TanStack query key format: /api/invoices/invoice
    const invs = await storage.getInvoices(type);
    res.json(invs);
  });

  // Specific invoice type route for TanStack query key format
  app.get("/api/invoices/type/:type", async (req, res) => {
    const invs = await storage.getInvoices(req.params.type);
    res.json(invs);
  });

  app.get("/api/invoices/next-number", async (req, res) => {
    const type = (req.query.type as string) || "invoice";
    const number = await storage.getNextInvoiceNumber(type);
    res.json({ number });
  });

  app.get("/api/invoices/:id", async (req, res) => {
    // Skip non-UUID ids
    if (req.params.id === "new" || req.params.id === "type" || req.params.id === "next-number") return res.status(404).json({ message: "Not found" });
    const inv = await storage.getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    res.json(inv);
  });

  app.delete("/api/invoices/:id", async (req, res) => {
    if (!req.user || (req.user.role !== "admin" && req.user.role !== "superuser")) {
      return res.status(403).json({ message: "Admin access required" });
    }
    try {
      const inv = await storage.getInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Invoice not found" });

      // Reverse stock for non-draft sales invoices
      if (inv.type === "invoice" && inv.status !== "draft") {
        for (const li of inv.items || []) {
          if (li.itemId) {
            const item = await storage.getItem(li.itemId);
            if (item) {
              const bottlesToAdd = ((li as any).saleUnit === "pack" && item.packSize > 1)
                ? li.quantity * item.packSize
                : li.quantity;
              await storage.updateItem(item.id, { stockQuantity: item.stockQuantity + bottlesToAdd });
            }
          }
        }
      }

      // Delete linked payments and their journal entries
      const linkedPayments = await db.select().from(payments).where(eq(payments.invoiceId, req.params.id));
      for (const pmt of linkedPayments) {
        const pmtJEs = await db.select({ id: journalEntries.id }).from(journalEntries)
          .where(and(eq(journalEntries.sourceType, "payment"), eq(journalEntries.sourceId, pmt.id)));
        for (const je of pmtJEs) {
          await db.delete(journalEntryLines).where(eq(journalEntryLines.journalEntryId, je.id));
          await db.delete(journalEntries).where(eq(journalEntries.id, je.id));
        }
      }
      await db.delete(payments).where(eq(payments.invoiceId, req.params.id));

      // Delete invoice journal entries
      const relatedJEs = await db.select({ id: journalEntries.id }).from(journalEntries)
        .where(and(eq(journalEntries.sourceType, "invoice"), eq(journalEntries.sourceId, req.params.id)));
      for (const je of relatedJEs) {
        await db.delete(journalEntryLines).where(eq(journalEntryLines.journalEntryId, je.id));
        await db.delete(journalEntries).where(eq(journalEntries.id, je.id));
      }

      await storage.deleteInvoice(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/invoices", async (req, res) => {
    try {
      const { items: lineItems, invoiceNumber: customNumber, ...invoiceData } = req.body;
      const data = insertInvoiceSchema.parse({ ...invoiceData, invoiceNumber: "TEMP" });
      const parsedItems = (lineItems || []).map((li: any) => insertInvoiceItemSchema.parse({ ...li, invoiceId: "TEMP" }));

      if (!data.dueDate && data.customerId) {
        const customer = await storage.getCustomer(data.customerId);
        if (customer) {
          const invDate = typeof data.date === "string" ? data.date : new Date().toISOString().split("T")[0];
          const daysMatch = customer.paymentTerms.match(/credit_(\d+)/);
          const days = daysMatch ? parseInt(daysMatch[1]) : 0;
          const due = new Date(invDate);
          due.setDate(due.getDate() + days);
          (data as any).dueDate = due.toISOString().split("T")[0];
        }
      }

      if (data.type === "invoice" && data.status !== "draft") {
        for (const li of parsedItems) {
          if (li.itemId) {
            const item = await storage.getItem(li.itemId);
            if (item) {
              const bottlesToSubtract = (li.saleUnit === "pack" && item.packSize > 1) ? li.quantity * item.packSize : li.quantity;
              if (item.stockQuantity < bottlesToSubtract) {
                return res.status(400).json({ message: `Not enough stock for ${item.name || 'item'}. Available: ${item.stockQuantity} bottles, needed: ${bottlesToSubtract}` });
              }
            }
          }
        }
      }

      const inv = await storage.createInvoice(data, parsedItems, customNumber || undefined);

      if (data.type === "invoice" && data.status !== "draft") {
        for (const li of parsedItems) {
          if (li.itemId) {
            const item = await storage.getItem(li.itemId);
            if (item) {
              const bottlesToSubtract = (li.saleUnit === "pack" && item.packSize > 1) ? li.quantity * item.packSize : li.quantity;
              await storage.updateItem(item.id, { stockQuantity: item.stockQuantity - bottlesToSubtract });
            }
          }
        }
      } else if (data.type === "credit_note") {
        for (const li of parsedItems) {
          if (li.itemId) {
            const item = await storage.getItem(li.itemId);
            if (item) {
              const bottlesToAdd = (li.saleUnit === "pack" && item.packSize > 1) ? li.quantity * item.packSize : li.quantity;
              await storage.updateItem(item.id, { stockQuantity: item.stockQuantity + bottlesToAdd });
            }
          }
        }
      }

      const invTotal = parseFloat(String(data.total || 0));
      const invVat = parseFloat(String(data.taxAmount || 0));
      const invNet = invTotal - invVat;
      const invDate = typeof data.date === "string" ? data.date : new Date().toISOString().split("T")[0];

      if (data.type === "invoice" && data.status !== "draft" && invTotal > 0) {
        let totalCost = 0;
        for (const li of parsedItems) {
          if (li.itemId) {
            const item = await storage.getItem(li.itemId);
            if (item) {
              const costPerUnit = parseFloat(item.costPrice);
              const qty = (li.saleUnit === "pack" && item.packSize > 1) ? li.quantity * item.packSize : li.quantity;
              totalCost += costPerUnit * qty;
            }
          }
        }
        const journalLines = [
          { accountCode: "1100", debit: invTotal, credit: 0, description: "Accounts Receivable" },
          { accountCode: "4000", debit: 0, credit: invNet, description: "Sales Revenue" },
          { accountCode: "2100", debit: 0, credit: invVat, description: "VAT Payable" },
        ];
        if (totalCost > 0) {
          journalLines.push(
            { accountCode: "5000", debit: totalCost, credit: 0, description: "Cost of Goods Sold" },
            { accountCode: "1200", debit: 0, credit: totalCost, description: "Inventory" },
          );
        }
        await autoCreateJournalEntry({
          sourceType: "invoice",
          sourceId: inv.id,
          date: invDate,
          description: `Sales Invoice ${inv.invoiceNumber}`,
          reference: inv.invoiceNumber,
          lines: journalLines,
        });
      } else if (data.type === "credit_note" && invTotal > 0) {
        let totalCost = 0;
        for (const li of parsedItems) {
          if (li.itemId) {
            const item = await storage.getItem(li.itemId);
            if (item) {
              const costPerUnit = parseFloat(item.costPrice);
              const qty = (li.saleUnit === "pack" && item.packSize > 1) ? li.quantity * item.packSize : li.quantity;
              totalCost += costPerUnit * qty;
            }
          }
        }
        const journalLines = [
          { accountCode: "4000", debit: invNet, credit: 0, description: "Sales Revenue reversal" },
          { accountCode: "2100", debit: invVat, credit: 0, description: "VAT Payable reversal" },
          { accountCode: "1100", debit: 0, credit: invTotal, description: "Accounts Receivable reversal" },
        ];
        if (totalCost > 0) {
          journalLines.push(
            { accountCode: "1200", debit: totalCost, credit: 0, description: "Inventory restored" },
            { accountCode: "5000", debit: 0, credit: totalCost, description: "COGS reversal" },
          );
        }
        await autoCreateJournalEntry({
          sourceType: "credit_note",
          sourceId: inv.id,
          date: invDate,
          description: `Credit Note ${inv.invoiceNumber}`,
          reference: inv.invoiceNumber,
          lines: journalLines,
        });
      }

      res.json(inv);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/invoices/:id", async (req, res) => {
    try {
      const { items: lineItems, ...invoiceData } = req.body;
      const parsedItems = lineItems ? (lineItems as any[]).map((li: any) => insertInvoiceItemSchema.parse({ ...li, invoiceId: req.params.id })) : undefined;
      const inv = await storage.updateInvoice(req.params.id, invoiceData, parsedItems);
      if (!inv) return res.status(404).json({ message: "Invoice not found" });
      res.json(inv);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Document view/print/download
  app.get("/api/invoices/:id/pdf", async (req, res) => {
    try {
      const inv = await storage.getInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Invoice not found" });

      const customer = await storage.getCustomer(inv.customerId);
      const typeLabel = inv.type === "credit_note" ? "CREDIT NOTE" : inv.type === "proforma" ? "PROFORMA INVOICE" : inv.type === "quotation" ? "QUOTATION" : "INVOICE";
      const autoPrint = req.query.print === "1";

      const allSettings = await storage.getSettings();
      const settingsMap: Record<string, string> = {};
      allSettings.forEach(s => { settingsMap[s.key] = s.value; });

      const enrichedItems = await Promise.all((inv.items || []).map(async (li: any) => {
        if (li.itemId) {
          const item = await storage.getItem(li.itemId);
          return { ...li, barcode: item?.barcode || null };
        }
        return { ...li, barcode: null };
      }));
      const enrichedInv = { ...inv, items: enrichedItems };

      const html = generateInvoiceHtml(enrichedInv, customer, typeLabel, autoPrint, settingsMap);

      res.setHeader("Content-Type", "text/html");
      if (req.query.download === "1") {
        res.setHeader("Content-Disposition", `attachment; filename="${inv.invoiceNumber}.html"`);
      }
      res.send(html);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Send invoice by email
  const sendEmailBodySchema = z.object({ email: z.string().email().optional() }).optional();
  app.post("/api/invoices/:id/send-email", async (req, res) => {
    try {
      const body = sendEmailBodySchema.parse(req.body);
      const inv = await storage.getInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Invoice not found" });

      const customer = await storage.getCustomer(inv.customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const toEmail = body?.email || customer.email;
      if (!toEmail) return res.status(400).json({ message: "Customer has no email address" });

      const typeLabel = inv.type === "credit_note" ? "CREDIT NOTE" : inv.type === "proforma" ? "PROFORMA INVOICE" : inv.type === "quotation" ? "QUOTATION" : "INVOICE";

      const allSettings = await storage.getSettings();
      const settingsMap: Record<string, string> = {};
      allSettings.forEach(s => { settingsMap[s.key] = s.value; });

      const companyName = settingsMap.company_name || "FC GASTRONOBILE LTD";
      const subject = `${typeLabel} ${inv.invoiceNumber} from ${companyName}`;

      const enrichedItems = await Promise.all((inv.items || []).map(async (li: any) => {
        if (li.itemId) {
          const item = await storage.getItem(li.itemId);
          return { ...li, barcode: item?.barcode || null };
        }
        return { ...li, barcode: null };
      }));
      const enrichedInv = { ...inv, items: enrichedItems };

      const html = generateInvoiceHtml(enrichedInv, customer, typeLabel, false, settingsMap);

      const result = await sendInvoiceEmail(toEmail, subject, html);

      await storage.createEmailLog({
        invoiceId: inv.id,
        customerId: customer.id,
        customerName: customer.name,
        toEmail: toEmail,
        fromEmail: result.fromEmail || null,
        subject: subject,
        status: result.success ? "sent" : "failed",
        errorMessage: result.error || null,
      });

      if (result.success) {
        // Auto-advance status to "sent" if currently draft
        if (inv.status === "draft") {
          await storage.updateInvoice(inv.id, { status: "sent" });
        }
        res.json({ message: `Email sent successfully to ${toEmail}` });
      } else {
        res.status(500).json({ message: `Failed to send email: ${result.error}` });
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Explicit status transition — only allowed moves enforced server-side
  app.patch("/api/invoices/:id/status", async (req, res) => {
    try {
      const { status: newStatus } = req.body;
      const allowed = ["draft", "sent", "paid", "overdue", "cancelled"];
      if (!allowed.includes(newStatus)) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      const inv = await storage.getInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Invoice not found" });

      // Enforce valid transitions
      // Cancel is only available from draft; posted invoices use Credit Notes instead
      const transitions: Record<string, string[]> = {
        draft:     ["sent", "paid", "cancelled"],
        sent:      ["paid", "overdue"],
        overdue:   ["paid", "sent"],
        paid:      ["draft"],
        cancelled: ["draft"],
      };
      if (!(transitions[inv.status] || []).includes(newStatus)) {
        return res.status(400).json({ message: `Cannot move from "${inv.status}" to "${newStatus}"` });
      }

      const updated = await storage.updateInvoice(inv.id, { status: newStatus });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Email logs
  app.get("/api/email-logs", async (_req, res) => {
    try {
      const logs = await storage.getEmailLogs();
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/email-logs/customer/:customerId", async (req, res) => {
    try {
      const logs = await storage.getEmailLogsByCustomer(req.params.customerId);
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/email-status", async (_req, res) => {
    try {
      const status = await getEmailStatus();
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/email/send-test", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email address required" });
      const result = await sendTestEmail(email);
      if (!result.success) return res.status(500).json({ message: result.error || "Failed to send test email" });
      res.json({ success: true, fromEmail: result.fromEmail, sentTo: email });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/email/save-config", requireAdmin, async (req, res) => {
    try {
      const { apiKey, fromEmail } = req.body;
      if (apiKey !== undefined) {
        if (apiKey && !apiKey.startsWith('re_')) {
          return res.status(400).json({ message: "Invalid Resend API key — it must start with 're_'" });
        }
        await storage.upsertSetting('resend_api_key', apiKey || '', 'Resend API Key', 'email');
      }
      if (fromEmail !== undefined) {
        await storage.upsertSetting('resend_from_email', fromEmail || '', 'Resend From Email', 'email');
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Payments
  app.get("/api/payments", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const invoiceId = req.query.invoiceId as string | undefined;
      if (invoiceId) {
        const pmts = await storage.getPayments(invoiceId);
        return res.json(pmts);
      }
      const pmts = await storage.getAllPayments();
      res.json(pmts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/payments/:id", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const { id } = req.params;
      const data = insertPaymentSchema.partial().parse(req.body);
      const updated = await storage.updatePayment(id, data);
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/payments/:id", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      await storage.deletePayment(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/payments", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const data = insertPaymentSchema.parse(req.body);
      const payment = await storage.createPayment(data);

      const pmtAmount = parseFloat(String(data.amount || 0));
      const pmtDate = typeof data.paymentDate === "string" ? data.paymentDate : new Date().toISOString().split("T")[0];
      const pmtAcctCode = data.paymentMethod === "cash" ? "1000" : "1010";

      // Resolve customer name for journal description
      let customerName = "";
      if (data.customerId) {
        const cust = await storage.getCustomer(data.customerId);
        customerName = cust ? ` — ${cust.name}` : "";
      } else if (data.invoiceId) {
        const inv = await db.select().from(invoices).where(eq(invoices.id, data.invoiceId)).limit(1);
        if (inv[0]) {
          const cust = await storage.getCustomer(inv[0].customerId);
          customerName = cust ? ` — ${cust.name}` : "";
        }
      }

      if (pmtAmount > 0) {
        await autoCreateJournalEntry({
          sourceType: "payment",
          sourceId: payment.id,
          date: pmtDate,
          description: `Customer Payment received${customerName}`,
          reference: data.reference || payment.id,
          lines: [
            { accountCode: pmtAcctCode, debit: pmtAmount, credit: 0, description: data.paymentMethod === "cash" ? "Cash" : "Bank" },
            { accountCode: "1100", debit: 0, credit: pmtAmount, description: "Accounts Receivable" },
          ],
        });
      }

      res.json(payment);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Reports
  app.get("/api/reports/sales", async (req, res) => {
    try {
      const from = (req.query.from as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const to = (req.query.to as string) || new Date().toISOString().split("T")[0];
      const customerId = req.query.customerId as string | undefined;
      const report = await storage.getSalesReport(from, to, customerId);
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Handle TanStack query key format for sales report
  app.get("/api/reports/sales/:from/:to/:customerId", async (req, res) => {
    try {
      const report = await storage.getSalesReport(req.params.from, req.params.to, req.params.customerId);
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/reports/items/:from/:to/:customerId/:categoryId", async (req, res) => {
    try {
      const report = await storage.getItemSalesReport(
        req.params.from, req.params.to,
        req.params.customerId, req.params.categoryId
      );
      res.json(report);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/invoices/last-prices/:customerId", async (req, res) => {
    try {
      const excludeId = typeof req.query.exclude === "string" ? req.query.exclude : undefined;
      const prices = await storage.getCustomerLastPrices(req.params.customerId, excludeId);
      res.json(prices);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/reports/savings/:customerId/:from/:to", async (req, res) => {
    try {
      const report = await storage.getCustomerSavingsReport(req.params.customerId, req.params.from, req.params.to);
      res.json(report);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/reports/savings/:customerId/:from/:to/html", async (req, res) => {
    try {
      const report = await storage.getCustomerSavingsReport(req.params.customerId, req.params.from, req.params.to);
      const allSettings = await storage.getSettings();
      const settingsMap = Object.fromEntries(allSettings.map(s => [s.key, s.value]));
      const companyName = settingsMap["company_name"] || "FC GASTRONOBILE LTD";

      const fromLabel = new Date(req.params.from + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      const toLabel = new Date(req.params.to + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

      type SavingsLine = { itemName: string; qty: number; unitPrice: number; discountPercent: number; savings: number };
      type SavingsInv = { invoiceNumber: string; invoiceDate: string; invoiceTotal: number; totalSavings: number; lines: SavingsLine[] };
      const invoiceRows = (report.invoices as SavingsInv[]).map((inv) => {
        const lineRows = inv.lines.map((l) => `
          <tr>
            <td style="padding:4px 8px">${l.itemName}</td>
            <td style="padding:4px 8px;text-align:right">${l.qty}</td>
            <td style="padding:4px 8px;text-align:right">€${Number(l.unitPrice).toFixed(2)}</td>
            <td style="padding:4px 8px;text-align:right">${Number(l.discountPercent).toFixed(1)}%</td>
            <td style="padding:4px 8px;text-align:right;color:#059669">€${Number(l.savings).toFixed(2)}</td>
          </tr>`).join("");
        return `
          <tr style="background:#f9fafb">
            <td colspan="5" style="padding:6px 8px;font-weight:600">${inv.invoiceNumber} — ${new Date(inv.invoiceDate + "T00:00:00").toLocaleDateString("en-GB")} — Total: €${Number(inv.invoiceTotal).toFixed(2)} — Saved: €${Number(inv.totalSavings).toFixed(2)}</td>
          </tr>
          ${lineRows}`;
      }).join("");

      type SavingsMonthly = { month: string; savings: number; invoiceCount: number };
      let cumulative = 0;
      const monthlyRows = (report.monthly as SavingsMonthly[]).map(m => {
        cumulative += m.savings;
        return `<tr>
          <td style="padding:4px 8px">${m.month}</td>
          <td style="padding:4px 8px;text-align:right;color:#059669">€${Number(m.savings).toFixed(2)}</td>
          <td style="padding:4px 8px;text-align:right">${m.invoiceCount}</td>
          <td style="padding:4px 8px;text-align:right;color:#7c3aed">€${cumulative.toFixed(2)}</td>
        </tr>`;
      }).join("");

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Customer Savings Report – ${escHtml(report.customerName)}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 13px; color: #111; margin: 0; padding: 20px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 0 0 16px; color: #555; }
    h3 { font-size: 13px; margin: 0 0 8px; color: #374151; }
    .company { font-size: 12px; color: #555; margin-bottom: 20px; }
    .stats { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 16px; min-width: 120px; }
    .stat-label { font-size: 11px; color: #6b7280; }
    .stat-value { font-size: 20px; font-weight: 700; color: #059669; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #059669; color: #fff; padding: 6px 8px; text-align: left; font-size: 12px; }
    td { border-bottom: 1px solid #f3f4f6; font-size: 12px; }
    .section { margin-bottom: 24px; }
    @media print { body { padding: 10px; } }
  </style>
</head>
<body>
  <div class="company">${escHtml(companyName)}</div>
  <h1>Customer Savings Report</h1>
  <h2>${escHtml(report.customerName)} — ${fromLabel} to ${toLabel}</h2>
  <div class="stats">
    <div class="stat"><div class="stat-label">Total Savings</div><div class="stat-value">€${report.totalSavings.toFixed(2)}</div></div>
    <div class="stat"><div class="stat-label">Avg Discount</div><div class="stat-value">${report.avgDiscountPercent.toFixed(1)}%</div></div>
    <div class="stat"><div class="stat-label">Invoices with Discount</div><div class="stat-value">${report.invoiceCount}</div></div>
    <div class="stat"><div class="stat-label">Best Single Invoice Saving</div><div class="stat-value">€${report.bestDeal.toFixed(2)}</div></div>
    <div class="stat"><div class="stat-label">Saved vs Catalogue</div><div class="stat-value">€${report.savedVsCatalogue.toFixed(2)}</div></div>
  </div>
  ${report.monthly.length > 0 ? `
  <div class="section">
    <h3>Monthly Savings Timeline</h3>
    <table>
      <thead><tr>
        <th>Month</th>
        <th style="text-align:right">Monthly Savings</th>
        <th style="text-align:right">Invoices</th>
        <th style="text-align:right">Cumulative</th>
      </tr></thead>
      <tbody>${monthlyRows}</tbody>
    </table>
  </div>` : ""}
  ${report.invoices.length === 0 ? '<p>No discounted invoices found in this period.</p>' : `
  <div class="section">
    <h3>Invoice Breakdown</h3>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th style="text-align:right">Qty</th>
          <th style="text-align:right">Unit Price</th>
          <th style="text-align:right">Disc %</th>
          <th style="text-align:right">Saving</th>
        </tr>
      </thead>
      <tbody>${invoiceRows}</tbody>
    </table>
  </div>`}
  ${req.query.print === "1" ? `<script>window.onload = function() { window.print(); }</script>` : ""}
</body>
</html>`;
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/reports/savings/:customerId/:from/:to/email", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      const rawEmail = (req.body && req.body.email) ? String(req.body.email).trim() : customer.email;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!rawEmail) return res.status(400).json({ message: "Customer has no email address on file" });
      if (!emailRegex.test(rawEmail)) return res.status(400).json({ message: "Invalid email address" });
      const toEmail = rawEmail;

      const report = await storage.getCustomerSavingsReport(req.params.customerId, req.params.from, req.params.to);
      const allSettings = await storage.getSettings();
      const settingsMap = Object.fromEntries(allSettings.map(s => [s.key, s.value]));
      const companyName = settingsMap["company_name"] || "FC GASTRONOBILE LTD";

      const fromLabel = new Date(req.params.from + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      const toLabel = new Date(req.params.to + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

      type SavingsLine = { itemName: string; qty: number; unitPrice: number; discountPercent: number; savings: number };
      type SavingsInv = { invoiceNumber: string; invoiceDate: string; invoiceTotal: number; totalSavings: number; lines: SavingsLine[] };
      const invoiceRows = (report.invoices as SavingsInv[]).map((inv) => {
        const lineRows = inv.lines.map((l) => `
          <tr>
            <td style="padding:4px 8px">${l.itemName}</td>
            <td style="padding:4px 8px;text-align:right">${l.qty}</td>
            <td style="padding:4px 8px;text-align:right">€${Number(l.unitPrice).toFixed(2)}</td>
            <td style="padding:4px 8px;text-align:right">${Number(l.discountPercent).toFixed(1)}%</td>
            <td style="padding:4px 8px;text-align:right;color:#059669">€${Number(l.savings).toFixed(2)}</td>
          </tr>`).join("");
        return `
          <tr style="background:#f9fafb">
            <td colspan="5" style="padding:6px 8px;font-weight:600">${inv.invoiceNumber} — ${new Date(inv.invoiceDate + "T00:00:00").toLocaleDateString("en-GB")} — Total: €${Number(inv.invoiceTotal).toFixed(2)} — Saved: €${Number(inv.totalSavings).toFixed(2)}</td>
          </tr>
          ${lineRows}`;
      }).join("");

      type SavingsMonthly = { month: string; savings: number; invoiceCount: number };
      let cumulative = 0;
      const monthlyRows = (report.monthly as SavingsMonthly[]).map(m => {
        cumulative += m.savings;
        return `<tr>
          <td style="padding:4px 8px">${m.month}</td>
          <td style="padding:4px 8px;text-align:right;color:#059669">€${Number(m.savings).toFixed(2)}</td>
          <td style="padding:4px 8px;text-align:right">${m.invoiceCount}</td>
          <td style="padding:4px 8px;text-align:right;color:#7c3aed">€${cumulative.toFixed(2)}</td>
        </tr>`;
      }).join("");

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Customer Savings Report – ${escHtml(report.customerName)}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 13px; color: #111; margin: 0; padding: 20px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 0 0 16px; color: #555; }
    h3 { font-size: 13px; margin: 0 0 8px; color: #374151; }
    .company { font-size: 12px; color: #555; margin-bottom: 20px; }
    .stats { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 16px; min-width: 120px; }
    .stat-label { font-size: 11px; color: #6b7280; }
    .stat-value { font-size: 20px; font-weight: 700; color: #059669; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #059669; color: #fff; padding: 6px 8px; text-align: left; font-size: 12px; }
    td { border-bottom: 1px solid #f3f4f6; font-size: 12px; }
    .section { margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="company">${escHtml(companyName)}</div>
  <h1>Customer Savings Report</h1>
  <h2>${escHtml(report.customerName)} — ${fromLabel} to ${toLabel}</h2>
  <div class="stats">
    <div class="stat"><div class="stat-label">Total Savings</div><div class="stat-value">€${report.totalSavings.toFixed(2)}</div></div>
    <div class="stat"><div class="stat-label">Avg Discount</div><div class="stat-value">${report.avgDiscountPercent.toFixed(1)}%</div></div>
    <div class="stat"><div class="stat-label">Invoices with Discount</div><div class="stat-value">${report.invoiceCount}</div></div>
    <div class="stat"><div class="stat-label">Best Single Invoice Saving</div><div class="stat-value">€${report.bestDeal.toFixed(2)}</div></div>
    <div class="stat"><div class="stat-label">Saved vs Catalogue</div><div class="stat-value">€${report.savedVsCatalogue.toFixed(2)}</div></div>
  </div>
  ${report.monthly.length > 0 ? `
  <div class="section">
    <h3>Monthly Savings Timeline</h3>
    <table>
      <thead><tr>
        <th>Month</th>
        <th style="text-align:right">Monthly Savings</th>
        <th style="text-align:right">Invoices</th>
        <th style="text-align:right">Cumulative</th>
      </tr></thead>
      <tbody>${monthlyRows}</tbody>
    </table>
  </div>` : ""}
  ${report.invoices.length === 0 ? '<p>No discounted invoices found in this period.</p>' : `
  <div class="section">
    <h3>Invoice Breakdown</h3>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th style="text-align:right">Qty</th>
          <th style="text-align:right">Unit Price</th>
          <th style="text-align:right">Disc %</th>
          <th style="text-align:right">Saving</th>
        </tr>
      </thead>
      <tbody>${invoiceRows}</tbody>
    </table>
  </div>`}
</body>
</html>`;

      const { sendSavingsReportEmail } = await import("./email");
      const subject = `Your Savings Report — ${report.customerName} (${fromLabel} to ${toLabel})`;
      const result = await sendSavingsReportEmail(toEmail, subject, html, report.customerName);
      if (!result.success) {
        await storage.createEmailLog({
          customerId: req.params.customerId,
          customerName: report.customerName,
          toEmail,
          subject,
          status: "failed",
          errorMessage: result.error || "Failed to send email",
        });
        return res.status(500).json({ message: result.error || "Failed to send email" });
      }
      await storage.createEmailLog({
        customerId: req.params.customerId,
        customerName: report.customerName,
        toEmail,
        subject,
        status: "sent",
      });
      res.json({ success: true, sentTo: toEmail });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/reports/savings/:customerId/:from/:to/excel", async (req, res) => {
    try {
      const report = await storage.getCustomerSavingsReport(req.params.customerId, req.params.from, req.params.to);
      const allSettings = await storage.getSettings();
      const settingsMap = Object.fromEntries(allSettings.map(s => [s.key, s.value]));
      const companyName = settingsMap["companyName"] || "Vineria Di Mare Trading Ltd";

      const fromLabel = new Date(req.params.from + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      const toLabel = new Date(req.params.to + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

      const workbook = new ExcelJS.Workbook();
      workbook.creator = companyName;
      workbook.created = new Date();

      // ── Summary sheet ──────────────────────────────────────────────────────
      const summary = workbook.addWorksheet("Summary");

      summary.mergeCells("A1:E1");
      const titleCell = summary.getCell("A1");
      titleCell.value = companyName;
      titleCell.font = { bold: true, size: 14, color: { argb: "FF059669" } };
      titleCell.alignment = { horizontal: "left" };

      summary.mergeCells("A2:E2");
      const subtitleCell = summary.getCell("A2");
      subtitleCell.value = `Customer Savings Report — ${report.customerName} — ${fromLabel} to ${toLabel}`;
      subtitleCell.font = { size: 11, italic: true, color: { argb: "FF555555" } };

      summary.addRow([]);

      // Stat cards row
      const statHeaders = summary.addRow(["Total Savings", "Avg Discount", "Invoices with Disc.", "Best Single Saving", "Saved vs Catalogue"]);
      statHeaders.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FF374151" }, size: 10 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
        cell.alignment = { horizontal: "center" };
        cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
      });
      const statValues = summary.addRow([
        report.totalSavings,
        report.avgDiscountPercent / 100,
        report.invoiceCount,
        report.bestDeal,
        report.savedVsCatalogue,
      ]);
      statValues.getCell(1).numFmt = '"€"#,##0.00';
      statValues.getCell(2).numFmt = '0.0%';
      statValues.getCell(4).numFmt = '"€"#,##0.00';
      statValues.getCell(5).numFmt = '"€"#,##0.00';
      statValues.eachCell(cell => {
        cell.font = { bold: true, size: 13, color: { argb: "FF059669" } };
        cell.alignment = { horizontal: "center" };
      });

      summary.addRow([]);

      // Monthly breakdown
      if (report.monthly.length > 0) {
        const mHead = summary.addRow(["Month", "Monthly Savings (€)", "Invoice Count", "Cumulative (€)"]);
        mHead.eachCell(cell => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF059669" } };
          cell.alignment = { horizontal: "center" };
        });
        let cumulative = 0;
        for (const m of report.monthly) {
          cumulative += m.savings;
          const row = summary.addRow([m.month, m.savings, m.invoiceCount, cumulative]);
          row.getCell(2).numFmt = '"€"#,##0.00';
          row.getCell(3).alignment = { horizontal: "center" };
          row.getCell(4).numFmt = '"€"#,##0.00';
          row.getCell(4).font = { color: { argb: "FF7C3AED" } };
        }
        const totalRow = summary.addRow(["TOTAL", report.totalSavings]);
        totalRow.getCell(1).font = { bold: true };
        totalRow.getCell(2).numFmt = '"€"#,##0.00';
        totalRow.getCell(2).font = { bold: true, color: { argb: "FF059669" } };
      }

      summary.columns = [
        { width: 22 },
        { width: 22 },
        { width: 22 },
        { width: 22 },
        { width: 22 },
      ];

      // ── Invoice detail sheet ───────────────────────────────────────────────
      const detail = workbook.addWorksheet("Invoice Detail");

      detail.mergeCells("A1:I1");
      const detailTitle = detail.getCell("A1");
      detailTitle.value = `Invoice Breakdown — ${report.customerName}`;
      detailTitle.font = { bold: true, size: 12 };

      detail.addRow([]);

      const invHead = detail.addRow(["Invoice #", "Date", "Invoice Total (€)", "Saved (€)", "Item", "Qty", "Unit Price (€)", "Disc %", "Line Saving (€)"]);
      invHead.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF059669" } };
        cell.alignment = { horizontal: "center" };
      });

      type SavingsLine = { itemName: string; qty: number; unitPrice: number; discountPercent: number; discountAmount: number; savings: number };
      type SavingsInv = { invoiceNumber: string; invoiceDate: string; invoiceTotal: number; totalSavings: number; lines: SavingsLine[] };

      for (const inv of report.invoices as SavingsInv[]) {
        const dateStr = new Date(inv.invoiceDate + "T00:00:00").toLocaleDateString("en-GB");
        if (inv.lines.length === 0) {
          const r = detail.addRow([inv.invoiceNumber, dateStr, inv.invoiceTotal, inv.totalSavings, "", "", "", "", ""]);
          r.getCell(1).font = { bold: true };
          r.getCell(3).numFmt = '"€"#,##0.00';
          r.getCell(4).numFmt = '"€"#,##0.00';
          r.getCell(4).font = { color: { argb: "FF059669" } };
          r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
        } else {
          for (let i = 0; i < inv.lines.length; i++) {
            const l = inv.lines[i];
            const r = detail.addRow([
              i === 0 ? inv.invoiceNumber : "",
              i === 0 ? dateStr : "",
              i === 0 ? inv.invoiceTotal : "",
              i === 0 ? inv.totalSavings : "",
              l.itemName,
              l.qty,
              l.unitPrice,
              l.discountPercent / 100,
              l.savings,
            ]);
            if (i === 0) {
              r.getCell(1).font = { bold: true };
              r.getCell(3).numFmt = '"€"#,##0.00';
              r.getCell(4).numFmt = '"€"#,##0.00';
              r.getCell(4).font = { color: { argb: "FF059669" } };
              r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
            }
            r.getCell(7).numFmt = '"€"#,##0.00';
            r.getCell(8).numFmt = '0.0%';
            r.getCell(9).numFmt = '"€"#,##0.00';
            r.getCell(9).font = { color: { argb: "FF059669" } };
          }
        }
      }

      detail.columns = [
        { width: 14 },
        { width: 13 },
        { width: 18 },
        { width: 14 },
        { width: 32 },
        { width: 7 },
        { width: 16 },
        { width: 9 },
        { width: 16 },
      ];

      const safeCustomer = report.customerName.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
      const filename = `savings_${safeCustomer}_${req.params.from}_${req.params.to}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      const buf = await workbook.xlsx.writeBuffer();
      res.send(buf);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/reports/statements", async (_req, res) => {
    try {
      const statements = await storage.getCustomerStatements();
      res.json(statements);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/reports/statement/:customerId/pdf", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      const statements = await storage.getCustomerStatements();
      const st = statements.find(s => s.customerId === req.params.customerId);
      const autoPrint = req.query.print === "1";

      const allSettings = await storage.getSettings();
      const settingsMap: Record<string, string> = {};
      allSettings.forEach(s => { settingsMap[s.key] = s.value; });

      const html = generateStatementHtml(customer, st, autoPrint, settingsMap);
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      if (req.query.download === "1") {
        res.setHeader("Content-Disposition", `attachment; filename="statement-${customer.code}.html"`);
      }
      res.send(html);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/reports/statement/:customerId/send-email", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const toEmail = req.body?.email || customer.email;
      if (!toEmail) return res.status(400).json({ message: "Customer has no email address" });

      const statements = await storage.getCustomerStatements();
      const st = statements.find(s => s.customerId === req.params.customerId);
      if (!st) return res.status(404).json({ message: "No statement data found for this customer" });

      const allSettings = await storage.getSettings();
      const settingsMap: Record<string, string> = {};
      allSettings.forEach(s => { settingsMap[s.key] = s.value; });

      const companyName = settingsMap.company_name || "FC GASTRONOBILE LTD";
      const subject = `Account Statement from ${companyName}`;
      const html = generateStatementHtml(customer, st, false, settingsMap);

      const result = await sendInvoiceEmail(toEmail, subject, html);

      await storage.createEmailLog({
        invoiceId: null,
        customerId: customer.id,
        customerName: customer.name,
        toEmail,
        fromEmail: result.fromEmail || null,
        subject,
        status: result.success ? "sent" : "failed",
        errorMessage: result.error || null,
      });

      if (result.success) {
        res.json({ message: `Statement sent to ${toEmail}` });
      } else {
        res.status(500).json({ message: `Failed to send: ${result.error}` });
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // System Settings
  app.get("/api/settings", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/settings", async (req, res) => {
    try {
      const { settings } = req.body;
      if (!Array.isArray(settings)) return res.status(400).json({ message: "Settings array required" });
      const results = [];
      for (const s of settings) {
        const result = await storage.upsertSetting(s.key, s.value, s.label, s.group);
        results.push(result);
      }
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/settings/seed-defaults", async (_req, res) => {
    try {
      const defaults = [
        { key: "company_name", value: "FC GASTRONOBILE LTD", label: "Company Name", group: "company" },
        { key: "company_address", value: "Georgiou Pilatou 11, 5510, Famagusta, Cyprus", label: "Company Address", group: "company" },
        { key: "company_phone", value: "", label: "Company Phone", group: "company" },
        { key: "company_email", value: "gastronobile@gmail.com", label: "Company Email", group: "company" },
        { key: "company_tax_id", value: "CY60323722T", label: "Company Tax ID (TIN)", group: "company" },
        { key: "company_reg_no", value: "HE 487597", label: "Company Registration No.", group: "company" },
        { key: "company_iban", value: "", label: "Bank IBAN", group: "company" },
        { key: "company_swift", value: "", label: "Bank SWIFT/BIC", group: "company" },
        { key: "company_bank_name", value: "", label: "Bank Name", group: "company" },
        { key: "vat_rate", value: "19", label: "Default VAT Rate (%)", group: "tax" },
        { key: "currency", value: "EUR", label: "Currency", group: "tax" },
        { key: "currency_symbol", value: "€", label: "Currency Symbol", group: "tax" },
        { key: "invoice_prefix", value: "INV", label: "Invoice Number Prefix", group: "invoicing" },
        { key: "credit_note_prefix", value: "CN", label: "Credit Note Number Prefix", group: "invoicing" },
        { key: "proforma_prefix", value: "PF", label: "Proforma Number Prefix", group: "invoicing" },
        { key: "invoice_footer", value: "Thank you for your business", label: "Invoice Footer Message", group: "invoicing" },
        { key: "payment_terms_default", value: "cash", label: "Default Payment Terms", group: "invoicing" },
        { key: "price_level_1", value: "Price Level 1", label: "Price Level 1 Name", group: "pricing" },
        { key: "price_level_2", value: "Price Level 2", label: "Price Level 2 Name", group: "pricing" },
        { key: "price_level_3", value: "Price Level 3", label: "Price Level 3 Name", group: "pricing" },
        { key: "price_level_4", value: "Price Level 4", label: "Price Level 4 Name", group: "pricing" },
        { key: "price_level_5", value: "Price Level 5", label: "Price Level 5 Name", group: "pricing" },
        { key: "low_stock_threshold", value: "10", label: "Low Stock Alert Threshold", group: "inventory" },
        { key: "portal_enabled", value: "true", label: "Customer Portal Enabled", group: "portal" },
        { key: "portal_allow_ordering", value: "true", label: "Allow Portal Ordering", group: "portal" },
      ];
      const results = [];
      for (const d of defaults) {
        const existing = await storage.getSetting(d.key);
        if (!existing) {
          const created = await storage.upsertSetting(d.key, d.value, d.label, d.group);
          results.push(created);
        } else {
          results.push(existing);
        }
      }
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Settings password
  app.post("/api/settings/verify-password", async (req, res) => {
    try {
      const { password } = req.body;
      const stored = await storage.getSetting("settings_password");
      if (!stored || !stored.value) return res.json({ valid: true, hasPassword: false });
      const storedVal = stored.value;
      let valid = false;
      if (storedVal.startsWith("$2b$") || storedVal.startsWith("$2a$")) {
        valid = verifyPassword(password || "", storedVal);
      } else {
        valid = storedVal === hashSettingsPassword(password || "");
      }
      res.json({ valid, hasPassword: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/settings/change-password", async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const stored = await storage.getSetting("settings_password");
      if (stored && stored.value) {
        const storedVal = stored.value;
        let valid = false;
        if (storedVal.startsWith("$2b$") || storedVal.startsWith("$2a$")) {
          valid = verifyPassword(currentPassword || "", storedVal);
        } else {
          valid = storedVal === hashSettingsPassword(currentPassword || "");
        }
        if (!valid) {
          return res.status(403).json({ message: "Current password is incorrect" });
        }
      }
      const hash = newPassword ? hashPassword(newPassword) : "";
      await storage.upsertSetting("settings_password", hash, "Settings Password Hash", "security");
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/settings/admin-reset-password", async (req, res) => {
    try {
      if (!req.user || req.user.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const { newPassword } = req.body;
      if (!newPassword) return res.status(400).json({ message: "newPassword required" });
      const hash = hashPassword(newPassword);
      await storage.upsertSetting("settings_password", hash, "Settings Password Hash", "security");
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Backup
  app.get("/api/backup/suppliers-for-production", async (_req, res) => {
    try {
      const { readFileSync } = await import("fs");
      const { join } = await import("path");
      const filePath = join(process.cwd(), "client/public/suppliers-for-production.json");
      const json = readFileSync(filePath, "utf-8");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", 'attachment; filename="suppliers-for-production.json"');
      res.send(json);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/backup/export", async (req, res) => {
    try {
      const since = req.query.since as string | undefined;
      const json = await generateBackupJson(since);
      const parsed = JSON.parse(json);
      const date = new Date().toISOString().split("T")[0];
      const tag = parsed.backupType === "differential" ? `diff-since-${since?.slice(0,10) || "unknown"}` : "full";
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="backup-${date}-${tag}.json"`);
      res.send(json);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/backup/send-email", async (req, res) => {
    try {
      const emailSetting = await storage.getSetting("backup_email");
      const companySetting = await storage.getSetting("company_name");
      const toEmail = req.body?.email || emailSetting?.value || "";
      if (!toEmail) return res.status(400).json({ message: "No backup email address configured" });
      const companyName = companySetting?.value || "FC GASTRONOBILE LTD";
      const date = new Date().toISOString().split("T")[0];
      // Use differential if last backup date is known and within 8 days
      const lastSetting = await storage.getSetting("backup_last_date");
      const lastDate = lastSetting?.value ? new Date(lastSetting.value) : null;
      const hoursSinceLast = lastDate ? (Date.now() - lastDate.getTime()) / 3600000 : Infinity;
      const since = (lastDate && hoursSinceLast < 192) ? lastDate.toISOString() : undefined;
      const json = await generateBackupJson(since);
      const parsed = JSON.parse(json);
      const result = await sendBackupEmail(toEmail, companyName, json, date);
      if (!result.success) return res.status(500).json({ message: result.error || "Failed to send backup email" });
      await storage.upsertSetting("backup_last_date", new Date().toISOString(), "Last Backup Date", "backup");
      res.json({ success: true, sentTo: toEmail, backupType: parsed.backupType, tableCounts: parsed.tableCounts });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Restore from backup file (v2 format from /api/backup/export)
  app.post("/api/backup/restore", requireAdmin, async (req: Request, res: Response) => {
    try {
      const payload = req.body;
      if (!payload || !payload.version || !payload.data) {
        return res.status(400).json({ message: "Invalid backup file: missing version or data" });
      }

      const d = payload.data;
      const isFull = payload.backupType !== "differential";

      const upsert = async (table: any, rows: any[], conflictCol: string = "id") => {
        if (!rows?.length) return;
        for (const row of rows) {
          await db.insert(table).values(row).onConflictDoUpdate({ target: table[conflictCol], set: row }).catch(() => {});
        }
      };

      const insertNew = async (table: any, rows: any[]) => {
        if (!rows?.length) return;
        for (const row of rows) {
          await db.insert(table).values(row).onConflictDoNothing().catch(() => {});
        }
      };

      if (isFull) {
        // Full restore: wipe affected tables and reimport
        await db.delete(journalEntryLines);
        await db.delete(journalEntries);
        await db.delete(expenses);
        await db.delete(supplierPayments);
        await db.delete(purchaseInvoiceItems);
        await db.delete(purchaseInvoices);
        await db.delete(payments);
        await db.delete(invoiceItems);
        await db.delete(invoices);
        await db.delete(priceContractRules);
        await db.delete(priceContractItems);
        await db.delete(priceContracts);
        await db.delete(seasonalOfferItems);
        await db.delete(seasonalOffers);
        await db.delete(customers);
        await db.delete(suppliers);
        await db.delete(items);
        await db.delete(categories);
        await db.delete(accounts);

        const ins = async (table: any, rows: any[]) => { if (rows?.length) await db.insert(table).values(rows); };
        await ins(categories, d.categories);
        await ins(items, d.items);
        await ins(customers, d.customers);
        await ins(suppliers, d.suppliers);
        await ins(accounts, d.accounts);
        await ins(priceContracts, d.priceContracts);
        await ins(priceContractRules, d.priceContractRules);
        await ins(priceContractItems, d.priceContractItems);
        await ins(seasonalOffers, d.seasonalOffers);
        await ins(seasonalOfferItems, d.seasonalOfferItems);
        await ins(invoices, d.invoices);
        await ins(invoiceItems, d.invoiceItems);
        await ins(payments, d.payments);
        await ins(purchaseInvoices, d.purchaseInvoices);
        await ins(purchaseInvoiceItems, d.purchaseInvoiceItems);
        await ins(supplierPayments, d.supplierPayments);
        await ins(journalEntries, d.journalEntries);
        await ins(journalEntryLines, d.journalEntryLines);
        await ins(expenses, d.expenses);

        // Settings: upsert (preserve passwords)
        for (const s of (d.settings || [])) {
          if (s.key === "settings_password") continue;
          await db.insert(systemSettings).values(s).onConflictDoUpdate({ target: systemSettings.key, set: { value: s.value, label: s.label, group: s.group } }).catch(() => {});
        }
      } else {
        // Differential restore: upsert config, insert-ignore transactions
        await upsert(categories, d.categories || []);
        await upsert(items, d.items || []);
        await upsert(customers, d.customers || []);
        await upsert(suppliers, d.suppliers || []);
        await upsert(accounts, d.accounts || []);
        await upsert(priceContracts, d.priceContracts || []);
        await upsert(priceContractRules, d.priceContractRules || []);
        await upsert(priceContractItems, d.priceContractItems || []);
        await upsert(seasonalOffers, d.seasonalOffers || []);
        await upsert(seasonalOfferItems, d.seasonalOfferItems || []);
        for (const s of (d.settings || [])) {
          if (s.key === "settings_password") continue;
          await db.insert(systemSettings).values(s).onConflictDoUpdate({ target: systemSettings.key, set: { value: s.value, label: s.label, group: s.group } }).catch(() => {});
        }
        // Transaction tables: insert new only
        await insertNew(invoices, d.invoices || []);
        await insertNew(invoiceItems, d.invoiceItems || []);
        await insertNew(payments, d.payments || []);
        await insertNew(purchaseInvoices, d.purchaseInvoices || []);
        await insertNew(purchaseInvoiceItems, d.purchaseInvoiceItems || []);
        await insertNew(supplierPayments, d.supplierPayments || []);
        await insertNew(journalEntries, d.journalEntries || []);
        await insertNew(journalEntryLines, d.journalEntryLines || []);
        await insertNew(expenses, d.expenses || []);
      }

      const totalRecords = Object.values(payload.tableCounts || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
      res.json({
        success: true,
        backupType: payload.backupType,
        exportedAt: payload.exportedAt,
        tableCounts: payload.tableCounts,
        totalRecords,
        restored: isFull ? "full" : "differential-merge",
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Inspect backup file without restoring (returns metadata)
  app.post("/api/backup/inspect", requireAdmin, async (req: Request, res: Response) => {
    try {
      const payload = req.body;
      if (!payload || !payload.data) {
        return res.status(400).json({ message: "Invalid backup file" });
      }
      const totalRecords = Object.values(payload.tableCounts || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
      res.json({
        version: payload.version,
        backupType: payload.backupType || "full",
        exportedAt: payload.exportedAt,
        sinceDate: payload.sinceDate || null,
        tableCounts: payload.tableCounts || {},
        totalRecords,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Suppliers
  app.get("/api/suppliers", async (_req, res) => {
    const sups = await storage.getSuppliers();
    res.json(sups);
  });

  app.get("/api/suppliers/:id", async (req, res) => {
    const sup = await storage.getSupplier(req.params.id);
    if (!sup) return res.status(404).json({ message: "Supplier not found" });
    res.json(sup);
  });

  app.post("/api/suppliers", async (req, res) => {
    try {
      const data = insertSupplierSchema.parse(req.body);
      const sup = await storage.createSupplier(data);
      res.json(sup);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/suppliers/:id", async (req, res) => {
    try {
      const sup = await storage.updateSupplier(req.params.id, req.body);
      if (!sup) return res.status(404).json({ message: "Supplier not found" });
      res.json(sup);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/suppliers/:id", async (req, res) => {
    if (!req.user || (req.user.role !== "admin" && req.user.role !== "superuser")) {
      return res.status(403).json({ message: "Admin access required" });
    }
    try {
      const sup = await storage.getSupplier(req.params.id);
      if (!sup) return res.status(404).json({ message: "Supplier not found" });
      const linked = await db.select({ id: purchaseInvoices.id }).from(purchaseInvoices).where(eq(purchaseInvoices.supplierId, req.params.id)).limit(1);
      if (linked.length > 0) {
        return res.status(400).json({ message: "Cannot delete: supplier has purchase invoices. Remove them first or mark the supplier inactive." });
      }
      await storage.deleteSupplier(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/suppliers/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = await readExcelWorkbook(req.file.buffer, req.file.originalname);
      const sheetName = req.body.sheetName || workbook.worksheets[0]?.name;
      const sheet = workbook.getWorksheet(sheetName);
      if (!sheet) return res.status(400).json({ message: `Sheet "${sheetName}" not found` });
      const rows: any[] = worksheetToJson(sheet, "");
      if (!rows.length) return res.status(400).json({ message: "File is empty" });

      const columnMap = req.body.columnMap ? JSON.parse(req.body.columnMap) : {};
      const results: { success: number; errors: { row: number; message: string }[] } = { success: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const getValue = (field: string) => {
            const col = columnMap[field] || field;
            return row[col] !== undefined ? String(row[col]).trim() : "";
          };

          const name = getValue("name");
          const code = getValue("code");
          if (!name || !code) {
            results.errors.push({ row: i + 2, message: "Name and Code are required" });
            continue;
          }

          const paymentTerms = getValue("paymentTerms") || "cash";
          const validTerms = ["cash", "credit_7", "credit_14", "credit_30", "credit_60", "credit_90"];

          const supData = {
            name,
            code: code.toUpperCase(),
            contactPerson: getValue("contactPerson") || null,
            email: getValue("email") || null,
            phone: getValue("phone") || null,
            address: getValue("address") || null,
            city: getValue("city") || null,
            country: getValue("country") || "Cyprus",
            taxId: getValue("taxId") || null,
            paymentTerms: validTerms.includes(paymentTerms) ? paymentTerms : "cash",
            currentBalance: "0",
            notes: getValue("notes") || null,
            active: true,
          };

          await storage.createSupplier(supData);
          results.success++;
        } catch (e: any) {
          results.errors.push({ row: i + 2, message: e.message });
        }
      }

      res.json(results);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/categories/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = await readExcelWorkbook(req.file.buffer, req.file.originalname);
      const sheetName = req.body.sheetName || workbook.worksheets[0]?.name;
      const sheet = workbook.getWorksheet(sheetName);
      if (!sheet) return res.status(400).json({ message: `Sheet "${sheetName}" not found` });
      const rows: any[] = worksheetToJson(sheet, "");
      if (!rows.length) return res.status(400).json({ message: "File is empty" });

      const columnMap = req.body.columnMap ? JSON.parse(req.body.columnMap) : {};
      const results: { success: number; errors: { row: number; message: string }[] } = { success: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const getValue = (field: string) => {
            const col = columnMap[field] || field;
            return row[col] !== undefined ? String(row[col]).trim() : "";
          };

          const name = getValue("name");
          if (!name) {
            results.errors.push({ row: i + 2, message: "Name is required" });
            continue;
          }

          await storage.createCategory({
            name,
            description: getValue("description") || null,
            parentId: null,
            active: true,
          });
          results.success++;
        } catch (e: any) {
          results.errors.push({ row: i + 2, message: e.message });
        }
      }

      res.json(results);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Purchase Invoices
  app.get("/api/purchase-invoices", async (_req, res) => {
    const invs = await storage.getPurchaseInvoices();
    res.json(invs);
  });

  app.get("/api/purchase-invoices/last-costs", async (_req, res) => {
    const costs = await storage.getLastPurchaseCosts();
    res.json(costs);
  });

  app.get("/api/purchase-invoices/:id", async (req, res) => {
    const inv = await storage.getPurchaseInvoice(req.params.id);
    if (!inv) return res.status(404).json({ message: "Purchase invoice not found" });
    res.json(inv);
  });

  app.post("/api/purchase-invoices", async (req, res) => {
    try {
      const { items: lineItems, ...invoiceData } = req.body;
      sanitizeNumericFields(invoiceData, ["subtotal", "vatAmount", "total"]);
      if (lineItems?.length) {
        for (const li of lineItems) {
          sanitizeNumericFields(li, ["unitCost", "discountPercent", "discount", "vatRate", "total"]);
          if (li.vatRate === "0" || li.vatRate === "") li.vatRate = "19";
        }
      }
      const data = insertPurchaseInvoiceSchema.parse(invoiceData);

      if (!data.dueDate && data.supplierId) {
        const supplier = await storage.getSupplier(data.supplierId);
        if (supplier) {
          const piDate = typeof data.date === "string" ? data.date : new Date().toISOString().split("T")[0];
          const daysMatch = supplier.paymentTerms.match(/credit_(\d+)/);
          const days = daysMatch ? parseInt(daysMatch[1]) : 0;
          const due = new Date(piDate);
          due.setDate(due.getDate() + days);
          (data as any).dueDate = due.toISOString().split("T")[0];
        }
      }

      if (!lineItems?.length) {
        return res.status(400).json({ message: "At least one line item is required" });
      }

      const parsedItems = lineItems.map((li: any) => insertPurchaseInvoiceItemSchema.parse(li));
      const inv = await storage.createPurchaseInvoice(data, parsedItems);

      for (const li of parsedItems) {
        const item = await storage.getItem(li.itemId);
        if (item) {
          const bottlesToAdd = li.purchaseUnit === "pack" ? li.quantity * item.packSize : li.quantity;
          await storage.updateItem(item.id, { stockQuantity: item.stockQuantity + bottlesToAdd });
        }
      }

      const supplier = await storage.getSupplier(data.supplierId);
      if (supplier) {
        const newBalance = parseFloat(supplier.currentBalance) + parseFloat(String(data.total));
        await storage.updateSupplier(data.supplierId, { currentBalance: newBalance.toFixed(2) });
      }

      const piTotal = parseFloat(String(data.total || 0));
      const piVat = parseFloat(String(data.vatAmount || 0));
      const piNet = piTotal - piVat;
      const piDate = typeof data.date === "string" ? data.date : new Date().toISOString().split("T")[0];

      if (piTotal > 0) {
        await autoCreateJournalEntry({
          sourceType: "purchase",
          sourceId: inv.id,
          date: piDate,
          description: `Purchase Invoice ${inv.invoiceNumber}`,
          reference: inv.invoiceNumber,
          lines: [
            { accountCode: "1200", debit: piNet, credit: 0, description: "Inventory" },
            { accountCode: "2100", debit: piVat, credit: 0, description: "Input VAT (VAT Receivable)" },
            { accountCode: "2000", debit: 0, credit: piTotal, description: "Accounts Payable" },
          ],
        });
      }

      res.json(inv);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.put("/api/purchase-invoices/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getPurchaseInvoice(id);
      if (!existing) return res.status(404).json({ message: "Purchase invoice not found" });

      const { items: lineItems, ...invoiceData } = req.body;
      sanitizeNumericFields(invoiceData, ["subtotal", "vatAmount", "total"]);
      if (lineItems?.length) {
        for (const li of lineItems) {
          sanitizeNumericFields(li, ["unitCost", "discountPercent", "discount", "vatRate", "total"]);
          if (li.vatRate === "0" || li.vatRate === "") li.vatRate = "19";
        }
      }

      // Reverse old stock impact
      for (const oldItem of existing.items) {
        const item = await storage.getItem(oldItem.itemId);
        if (item) {
          const bottlesToRemove = oldItem.purchaseUnit === "pack" ? oldItem.quantity * item.packSize : oldItem.quantity;
          await storage.updateItem(item.id, { stockQuantity: Math.max(0, item.stockQuantity - bottlesToRemove) });
        }
      }

      // Reverse old supplier balance impact
      const oldSupplier = await storage.getSupplier(existing.supplierId);
      if (oldSupplier) {
        const oldBalance = parseFloat(oldSupplier.currentBalance) - parseFloat(existing.total);
        await storage.updateSupplier(existing.supplierId, { currentBalance: Math.max(0, oldBalance).toFixed(2) });
      }

      // Update invoice header
      const { invoiceNumber, ...updateData } = invoiceData;
      await storage.updatePurchaseInvoice(id, updateData);

      // Replace line items
      await storage.deletePurchaseInvoiceItems(id);
      if (lineItems?.length) {
        const parsedItems = lineItems.map((li: any) => insertPurchaseInvoiceItemSchema.parse(li));
        await storage.createPurchaseInvoiceItems(parsedItems.map((li: any) => ({ ...li, purchaseInvoiceId: id })));

        // Apply new stock impact
        for (const li of parsedItems) {
          const item = await storage.getItem(li.itemId);
          if (item) {
            const bottlesToAdd = li.purchaseUnit === "pack" ? li.quantity * item.packSize : li.quantity;
            await storage.updateItem(item.id, { stockQuantity: item.stockQuantity + bottlesToAdd });
          }
        }
      }

      // Apply new supplier balance impact
      const newSupplier = await storage.getSupplier(invoiceData.supplierId);
      if (newSupplier) {
        const newBalance = parseFloat(newSupplier.currentBalance) + parseFloat(String(invoiceData.total));
        await storage.updateSupplier(invoiceData.supplierId, { currentBalance: newBalance.toFixed(2) });
      }

      const updated = await storage.getPurchaseInvoice(id);
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/purchase-invoices/:id", async (req, res) => {
    if (!req.user || (req.user.role !== "admin" && req.user.role !== "superuser")) {
      return res.status(403).json({ message: "Admin access required" });
    }
    try {
      const existing = await storage.getPurchaseInvoice(req.params.id);
      if (!existing) return res.status(404).json({ message: "Purchase invoice not found" });

      // Reverse stock impact
      for (const item of existing.items) {
        const stockItem = await storage.getItem(item.itemId);
        if (stockItem) {
          const bottlesToRemove = item.purchaseUnit === "pack" ? item.quantity * stockItem.packSize : item.quantity;
          await storage.updateItem(stockItem.id, { stockQuantity: Math.max(0, stockItem.stockQuantity - bottlesToRemove) });
        }
      }

      // Reverse supplier balance
      const supplier = await storage.getSupplier(existing.supplierId);
      if (supplier) {
        const newBalance = parseFloat(supplier.currentBalance) - parseFloat(existing.total);
        await storage.updateSupplier(existing.supplierId, { currentBalance: Math.max(0, newBalance).toFixed(2) });
      }

      // Delete journal entries for this purchase
      const relatedJEs = await db.select({ id: journalEntries.id }).from(journalEntries)
        .where(and(eq(journalEntries.sourceType, "purchase"), eq(journalEntries.sourceId, req.params.id)));
      for (const je of relatedJEs) {
        await db.delete(journalEntryLines).where(eq(journalEntryLines.journalEntryId, je.id));
        await db.delete(journalEntries).where(eq(journalEntries.id, je.id));
      }

      await storage.deletePurchaseInvoice(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Supplier Payments
  app.get("/api/supplier-payments", async (req, res) => {
    const supplierId = req.query.supplierId as string | undefined;
    const payments = await storage.getSupplierPayments(supplierId);
    res.json(payments);
  });

  app.post("/api/supplier-payments", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const data = insertSupplierPaymentSchema.parse(req.body);
      const supplier = await storage.getSupplier(data.supplierId);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      // createSupplierPayment already handles balance deduction — do not call updateSupplier again
      const payment = await storage.createSupplierPayment(data);

      const spAmount = parseFloat(String(data.amount || 0));
      const spDate = typeof data.paymentDate === "string" ? data.paymentDate : new Date().toISOString().split("T")[0];
      const paymentAcctCode = data.paymentMethod === "cash" ? "1000" : "1010";

      if (spAmount > 0) {
        await autoCreateJournalEntry({
          sourceType: "supplier_payment",
          sourceId: payment.id,
          date: spDate,
          description: `Supplier Payment — ${supplier.name}`,
          reference: data.reference || payment.id,
          lines: [
            { accountCode: "2000", debit: spAmount, credit: 0, description: `Accounts Payable — ${supplier.name}` },
            { accountCode: paymentAcctCode, debit: 0, credit: spAmount, description: data.paymentMethod === "cash" ? "Cash" : "Bank" },
          ],
        });
      }

      res.json(payment);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/supplier-payments/:id", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const { id } = req.params;
      const data = insertSupplierPaymentSchema.partial().parse(req.body);
      const updated = await storage.updateSupplierPayment(id, data);
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Portal API Routes
  app.post("/api/portal/login", async (req, res) => {
    try {
      const { code, accessCode } = req.body;
      if (!code || !accessCode) return res.status(400).json({ message: "Customer code and access code required" });
      const customer = await storage.getCustomerByCode(code.toUpperCase());
      if (!customer) return res.status(401).json({ message: "Invalid credentials" });
      if (!customer.portalAccessCode || customer.portalAccessCode !== accessCode) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      if (!customer.active) return res.status(403).json({ message: "Account is inactive" });
      res.json({ customer });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/portal/customer/:id", async (req, res) => {
    const customer = await storage.getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ message: "Not found" });
    res.json(customer);
  });

  app.get("/api/portal/customer/:id/invoices", async (req, res) => {
    try {
      const invoices = await storage.getCustomerInvoices(req.params.id);
      res.json(invoices);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/portal/customer/:id/orders", async (req, res) => {
    try {
      const orders = await storage.getPortalOrders(req.params.id);
      res.json(orders);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/portal/customer/:id/statement", async (req, res) => {
    try {
      const statements = await storage.getCustomerStatements();
      const st = statements.find(s => s.customerId === req.params.id);
      res.json(st || { customerId: req.params.id, customerName: "", totalInvoiced: "0.00", totalPaid: "0.00", balance: "0.00", invoiceCount: 0 });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/portal/catalog", async (_req, res) => {
    try {
      const items = await storage.getAvailableItems();
      const cats = await storage.getCategories();
      res.json({ items, categories: cats });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/portal/orders", async (req, res) => {
    try {
      const { customerId, items: orderItems, notes } = req.body;
      if (!customerId || !orderItems?.length) {
        return res.status(400).json({ message: "Customer and items required" });
      }
      const customer = await storage.getCustomer(customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const VAT_RATE = 0.19;
      let subtotal = 0;
      const processedItems: any[] = [];

      for (const oi of orderItems) {
        const item = await storage.getItem(oi.itemId);
        if (!item) continue;
        const bottlesNeeded = (oi.saleUnit === "pack" && item.packSize > 1) ? oi.quantity * item.packSize : oi.quantity;
        if (item.stockQuantity < bottlesNeeded) {
          return res.status(400).json({ message: `Not enough stock for ${item.name}. Available: ${item.stockQuantity} bottles` });
        }
        const priceKey = `price${customer.priceLevel}` as keyof typeof item;
        const unitPrice = parseFloat(String(item[priceKey] || item.price1));
        const lineTotal = unitPrice * oi.quantity;
        subtotal += lineTotal;
        processedItems.push({
          itemId: item.id,
          itemName: item.name,
          quantity: oi.quantity,
          unitPrice: unitPrice.toFixed(2),
          total: lineTotal.toFixed(2),
        });
      }

      const vatAmount = subtotal * VAT_RATE;
      const total = subtotal + vatAmount;

      const order = await storage.createPortalOrder(
        { customerId, subtotal: subtotal.toFixed(2), vatAmount: vatAmount.toFixed(2), total: total.toFixed(2), notes: notes || null, status: "pending" },
        processedItems.map(pi => ({ ...pi, orderId: "TEMP" }))
      );

      for (const oi of orderItems) {
        const item = await storage.getItem(oi.itemId);
        if (item) {
          const bottlesToSubtract = (oi.saleUnit === "pack" && item.packSize > 1) ? oi.quantity * item.packSize : oi.quantity;
          await storage.updateItem(item.id, { stockQuantity: item.stockQuantity - bottlesToSubtract });
        }
      }

      res.json(order);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/demo/seed", async (_req, res) => {
    try {
      const [existingCats] = await db.select({ count: sql<number>`count(*)` }).from(categories);
      const [existingItems] = await db.select({ count: sql<number>`count(*)` }).from(items);
      const [existingCustomers] = await db.select({ count: sql<number>`count(*)` }).from(customers);
      if ((existingCats?.count || 0) > 0 || (existingItems?.count || 0) > 0 || (existingCustomers?.count || 0) > 0) {
        return res.status(400).json({ message: "Database already contains data. Clear demo data first before seeding." });
      }

      const [redWine] = await db.insert(categories).values({ name: "Red Wine", description: "Premium red wines from top vineyards" }).returning();
      const [whiteWine] = await db.insert(categories).values({ name: "White Wine", description: "Crisp and refreshing white wines" }).returning();
      const [sparkling] = await db.insert(categories).values({ name: "Sparkling", description: "Champagnes and sparkling wines" }).returning();
      const [spirits] = await db.insert(categories).values({ name: "Spirits", description: "Premium spirits and liquors" }).returning();
      const [rose] = await db.insert(categories).values({ name: "Rosé", description: "Light and fruity rosé wines" }).returning();
      const [beer] = await db.insert(categories).values({ name: "Beer & Cider", description: "Craft beers and artisan ciders" }).returning();
      const [fortified] = await db.insert(categories).values({ name: "Fortified Wine", description: "Port, sherry and dessert wines" }).returning();

      const seedItems = [
        { name: "Château Margaux 2018", sku: "RW-001", barcode: "3401234567890", categoryId: redWine.id, unitType: "bottle", packSize: 1, price1: "189.99", price2: "179.99", price3: "169.99", price4: "159.99", price5: "149.99", costPrice: "120.00", stockQuantity: 48, reorderLevel: 12, volume: "750ml", alcoholPercentage: "13.5", brand: "Château Margaux", origin: "Bordeaux, France", vintage: "2018" },
        { name: "Opus One 2019", sku: "RW-002", barcode: "3401234567891", categoryId: redWine.id, unitType: "bottle", packSize: 1, price1: "399.99", price2: "379.99", price3: "359.99", price4: "339.99", price5: "319.99", costPrice: "250.00", stockQuantity: 24, reorderLevel: 6, volume: "750ml", alcoholPercentage: "14.5", brand: "Opus One", origin: "Napa Valley, USA", vintage: "2019" },
        { name: "Penfolds Grange 2017", sku: "RW-003", barcode: "3401234567892", categoryId: redWine.id, unitType: "pack", packSize: 6, price1: "2100.00", price2: "1999.00", price3: "1899.00", price4: "1799.00", price5: "1699.00", costPrice: "1400.00", stockQuantity: 48, reorderLevel: 24, volume: "750ml", alcoholPercentage: "14.1", brand: "Penfolds", origin: "South Australia", vintage: "2017" },
        { name: "Barolo Riserva 2016", sku: "RW-004", barcode: "3401234567910", categoryId: redWine.id, unitType: "bottle", packSize: 1, price1: "85.00", price2: "79.00", price3: "74.00", price4: "69.00", price5: "65.00", costPrice: "48.00", stockQuantity: 36, reorderLevel: 10, volume: "750ml", alcoholPercentage: "14.0", brand: "Marchesi di Barolo", origin: "Piedmont, Italy", vintage: "2016" },
        { name: "Rioja Gran Reserva 2015", sku: "RW-005", barcode: "3401234567911", categoryId: redWine.id, unitType: "pack", packSize: 12, price1: "540.00", price2: "504.00", price3: "468.00", price4: "432.00", price5: "396.00", costPrice: "300.00", stockQuantity: 120, reorderLevel: 24, volume: "750ml", alcoholPercentage: "13.5", brand: "Marqués de Riscal", origin: "Rioja, Spain", vintage: "2015" },
        { name: "Cloudy Bay Sauvignon Blanc", sku: "WW-001", barcode: "3401234567893", categoryId: whiteWine.id, unitType: "pack", packSize: 12, price1: "288.00", price2: "276.00", price3: "264.00", price4: "252.00", price5: "240.00", costPrice: "180.00", stockQuantity: 120, reorderLevel: 24, volume: "750ml", alcoholPercentage: "13.0", brand: "Cloudy Bay", origin: "Marlborough, NZ", vintage: "2023" },
        { name: "Chablis Premier Cru 2021", sku: "WW-002", barcode: "3401234567894", categoryId: whiteWine.id, unitType: "bottle", packSize: 1, price1: "45.99", price2: "42.99", price3: "39.99", price4: "37.99", price5: "35.99", costPrice: "28.00", stockQuantity: 72, reorderLevel: 18, volume: "750ml", alcoholPercentage: "12.5", brand: "William Fèvre", origin: "Burgundy, France", vintage: "2021" },
        { name: "Pinot Grigio delle Venezie", sku: "WW-003", barcode: "3401234567912", categoryId: whiteWine.id, unitType: "pack", packSize: 6, price1: "72.00", price2: "66.00", price3: "60.00", price4: "54.00", price5: "48.00", costPrice: "36.00", stockQuantity: 96, reorderLevel: 24, volume: "750ml", alcoholPercentage: "12.0", brand: "Santa Margherita", origin: "Veneto, Italy", vintage: "2023" },
        { name: "Riesling Spätlese 2022", sku: "WW-004", barcode: "3401234567913", categoryId: whiteWine.id, unitType: "bottle", packSize: 1, price1: "28.50", price2: "26.00", price3: "24.00", price4: "22.00", price5: "20.00", costPrice: "14.00", stockQuantity: 60, reorderLevel: 15, volume: "750ml", alcoholPercentage: "9.5", brand: "Dr. Loosen", origin: "Mosel, Germany", vintage: "2022" },
        { name: "Dom Pérignon 2013", sku: "SP-001", barcode: "3401234567895", categoryId: sparkling.id, unitType: "bottle", packSize: 1, price1: "249.99", price2: "239.99", price3: "229.99", price4: "219.99", price5: "209.99", costPrice: "170.00", stockQuantity: 18, reorderLevel: 6, volume: "750ml", alcoholPercentage: "12.5", brand: "Dom Pérignon", origin: "Champagne, France", vintage: "2013" },
        { name: "Veuve Clicquot Yellow Label", sku: "SP-002", barcode: "3401234567896", categoryId: sparkling.id, unitType: "pack", packSize: 6, price1: "360.00", price2: "342.00", price3: "324.00", price4: "306.00", price5: "288.00", costPrice: "240.00", stockQuantity: 36, reorderLevel: 12, volume: "750ml", alcoholPercentage: "12.0", brand: "Veuve Clicquot", origin: "Champagne, France", vintage: "NV" },
        { name: "Prosecco Superiore DOCG", sku: "SP-003", barcode: "3401234567914", categoryId: sparkling.id, unitType: "pack", packSize: 12, price1: "180.00", price2: "168.00", price3: "156.00", price4: "144.00", price5: "132.00", costPrice: "96.00", stockQuantity: 144, reorderLevel: 36, volume: "750ml", alcoholPercentage: "11.0", brand: "Bisol", origin: "Veneto, Italy", vintage: "NV" },
        { name: "Macallan 18 Year", sku: "ST-001", barcode: "3401234567897", categoryId: spirits.id, unitType: "bottle", packSize: 1, price1: "329.99", price2: "319.99", price3: "309.99", price4: "299.99", price5: "289.99", costPrice: "220.00", stockQuantity: 15, reorderLevel: 5, volume: "700ml", alcoholPercentage: "43.0", brand: "Macallan", origin: "Scotland", vintage: "" },
        { name: "Hennessy XO Cognac", sku: "ST-002", barcode: "3401234567898", categoryId: spirits.id, unitType: "bottle", packSize: 1, price1: "199.99", price2: "189.99", price3: "179.99", price4: "169.99", price5: "159.99", costPrice: "130.00", stockQuantity: 5, reorderLevel: 8, volume: "700ml", alcoholPercentage: "40.0", brand: "Hennessy", origin: "Cognac, France", vintage: "" },
        { name: "Grey Goose Vodka", sku: "ST-003", barcode: "3401234567915", categoryId: spirits.id, unitType: "bottle", packSize: 1, price1: "42.00", price2: "39.00", price3: "36.00", price4: "33.00", price5: "30.00", costPrice: "22.00", stockQuantity: 60, reorderLevel: 15, volume: "700ml", alcoholPercentage: "40.0", brand: "Grey Goose", origin: "France", vintage: "" },
        { name: "Hendrick's Gin", sku: "ST-004", barcode: "3401234567916", categoryId: spirits.id, unitType: "bottle", packSize: 1, price1: "38.00", price2: "35.00", price3: "32.00", price4: "29.00", price5: "27.00", costPrice: "20.00", stockQuantity: 45, reorderLevel: 12, volume: "700ml", alcoholPercentage: "41.4", brand: "Hendrick's", origin: "Scotland", vintage: "" },
        { name: "Patrón Silver Tequila", sku: "ST-005", barcode: "3401234567917", categoryId: spirits.id, unitType: "bottle", packSize: 1, price1: "55.00", price2: "50.00", price3: "46.00", price4: "42.00", price5: "38.00", costPrice: "28.00", stockQuantity: 30, reorderLevel: 8, volume: "700ml", alcoholPercentage: "40.0", brand: "Patrón", origin: "Mexico", vintage: "" },
        { name: "Whispering Angel Rosé 2023", sku: "RS-001", barcode: "3401234567899", categoryId: rose.id, unitType: "pack", packSize: 12, price1: "240.00", price2: "228.00", price3: "216.00", price4: "204.00", price5: "192.00", costPrice: "150.00", stockQuantity: 96, reorderLevel: 24, volume: "750ml", alcoholPercentage: "13.0", brand: "Château d'Esclans", origin: "Provence, France", vintage: "2023" },
        { name: "Miraval Rosé 2023", sku: "RS-002", barcode: "3401234567918", categoryId: rose.id, unitType: "pack", packSize: 6, price1: "144.00", price2: "132.00", price3: "120.00", price4: "108.00", price5: "96.00", costPrice: "72.00", stockQuantity: 60, reorderLevel: 12, volume: "750ml", alcoholPercentage: "13.0", brand: "Miraval", origin: "Provence, France", vintage: "2023" },
        { name: "Peroni Nastro Azzurro", sku: "BR-001", barcode: "3401234567919", categoryId: beer.id, unitType: "pack", packSize: 24, price1: "36.00", price2: "33.60", price3: "31.20", price4: "28.80", price5: "26.40", costPrice: "18.00", stockQuantity: 240, reorderLevel: 48, volume: "330ml", alcoholPercentage: "5.1", brand: "Peroni", origin: "Italy", vintage: "" },
        { name: "KEO Beer", sku: "BR-002", barcode: "3401234567920", categoryId: beer.id, unitType: "pack", packSize: 24, price1: "28.80", price2: "26.40", price3: "24.00", price4: "21.60", price5: "19.20", costPrice: "14.00", stockQuantity: 480, reorderLevel: 96, volume: "330ml", alcoholPercentage: "4.5", brand: "KEO", origin: "Cyprus", vintage: "" },
        { name: "Taylor's 20 Year Tawny Port", sku: "FW-001", barcode: "3401234567921", categoryId: fortified.id, unitType: "bottle", packSize: 1, price1: "65.00", price2: "60.00", price3: "55.00", price4: "50.00", price5: "46.00", costPrice: "35.00", stockQuantity: 24, reorderLevel: 6, volume: "750ml", alcoholPercentage: "20.0", brand: "Taylor's", origin: "Douro, Portugal", vintage: "" },
        { name: "Commandaria St. John", sku: "FW-002", barcode: "3401234567922", categoryId: fortified.id, unitType: "bottle", packSize: 1, price1: "18.00", price2: "16.50", price3: "15.00", price4: "13.50", price5: "12.00", costPrice: "8.00", stockQuantity: 100, reorderLevel: 20, volume: "750ml", alcoholPercentage: "15.0", brand: "KEO", origin: "Cyprus", vintage: "" },
      ];

      const createdItems = await db.insert(items).values(seedItems).returning();

      const seedCustomers = [
        { name: "Limassol Wine House", code: "CUST001", email: "orders@limassolwinehouse.com.cy", phone: "+357-25-123456", address: "15 Makarios Avenue", city: "Limassol", taxId: "CY-12345678A", paymentTerms: "credit_30", creditLimit: "50000", currentBalance: "0", priceLevel: 1, portalAccessCode: "WINE2026" },
        { name: "Nicosia Grand Hotel", code: "CUST002", email: "purchasing@nicosiagrand.com.cy", phone: "+357-22-234567", address: "28 Ledra Street", city: "Nicosia", taxId: "CY-23456789B", paymentTerms: "credit_14", creditLimit: "25000", currentBalance: "0", priceLevel: 2, portalAccessCode: "HOTEL2026" },
        { name: "Paphos Beach Resort", code: "CUST003", email: "procurement@paphosbeach.com.cy", phone: "+357-26-345678", address: "42 Poseidonos Avenue", city: "Paphos", taxId: "CY-34567890C", paymentTerms: "cash", creditLimit: "0", currentBalance: "0", priceLevel: 3, portalAccessCode: "RESORT26" },
        { name: "Larnaca Spirits Trading", code: "CUST004", email: "wine@larnacaspirits.com.cy", phone: "+357-24-456789", address: "7 Athinon Avenue", city: "Larnaca", taxId: "CY-45678901D", paymentTerms: "credit_60", creditLimit: "100000", currentBalance: "0", priceLevel: 1, portalAccessCode: "TRADE2026" },
        { name: "Troodos Mountain Lodge", code: "CUST005", email: "orders@troodoslodge.com.cy", phone: "+357-25-567890", address: "3 Platres Hill Road", city: "Platres", taxId: "CY-56789012E", paymentTerms: "credit_30", creditLimit: "35000", currentBalance: "0", priceLevel: 2, portalAccessCode: "LODGE2026" },
        { name: "Ayia Napa Beach Bar", code: "CUST006", email: "bar@ayianapabay.com.cy", phone: "+357-23-678901", address: "12 Nissi Avenue", city: "Ayia Napa", taxId: "CY-67890123F", paymentTerms: "credit_7", creditLimit: "15000", currentBalance: "0", priceLevel: 3, portalAccessCode: "BEACH26" },
        { name: "Metro Wine Bar", code: "CUST007", email: "wines@metrobar.com.cy", phone: "+357-22-789012", address: "5 Stasikratous Street", city: "Nicosia", taxId: "CY-78901234G", paymentTerms: "credit_30", creditLimit: "40000", currentBalance: "0", priceLevel: 2, portalAccessCode: "METRO2026" },
        { name: "Elite Dining Group", code: "CUST008", email: "procurement@elitedining.com.cy", phone: "+357-25-890123", address: "88 Amathountos Avenue", city: "Limassol", taxId: "CY-89012345H", paymentTerms: "credit_60", creditLimit: "80000", currentBalance: "0", priceLevel: 1, portalAccessCode: "ELITE2026" },
        { name: "Protaras Sunset Lounge", code: "CUST009", email: "drinks@sunsetlounge.com.cy", phone: "+357-23-901234", address: "9 Protaras Avenue", city: "Protaras", taxId: "CY-90123456I", paymentTerms: "credit_14", creditLimit: "20000", currentBalance: "0", priceLevel: 3, portalAccessCode: "SUNSET26" },
        { name: "Cyprus Wine Academy", code: "CUST010", email: "orders@cypruswineacademy.com", phone: "+357-22-012345", address: "22 Diagorou Street", city: "Nicosia", taxId: "CY-01234567J", paymentTerms: "credit_30", creditLimit: "30000", currentBalance: "0", priceLevel: 2, portalAccessCode: "ACADEMY26" },
      ];

      const createdCustomers = await db.insert(customers).values(seedCustomers).returning();

      const seedSuppliers = [
        { name: "Bordeaux Direct Imports", code: "SUP001", email: "export@bordeauxdirect.fr", phone: "+33-5-5678-1234", address: "10 Quai des Chartrons", city: "Bordeaux", country: "France", taxId: "FR-12345678901" },
        { name: "Italian Wine Merchants", code: "SUP002", email: "vendite@italianwine.it", phone: "+39-011-5678-900", address: "Via Roma 45", city: "Torino", country: "Italy", taxId: "IT-98765432109" },
        { name: "Spirits Global Ltd", code: "SUP003", email: "trade@spiritsglobal.co.uk", phone: "+44-20-7123-4567", address: "15 Regent Street", city: "London", country: "United Kingdom", taxId: "GB-123456789" },
        { name: "KEO Plc", code: "SUP004", email: "wholesale@keo.com.cy", phone: "+357-25-888000", address: "1 Franklin Roosevelt Avenue", city: "Limassol", country: "Cyprus", taxId: "CY-11223344K" },
        { name: "Champagne House Paris", code: "SUP005", email: "orders@champagnehouse.fr", phone: "+33-3-2634-5678", address: "8 Avenue de Champagne", city: "Épernay", country: "France", taxId: "FR-55667788901" },
      ];

      await db.insert(suppliers).values(seedSuppliers).returning();

      const today = new Date();
      const fmt = (d: Date) => d.toISOString().split("T")[0];
      const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

      const inv1Items = [
        { description: "Château Margaux 2018", quantity: 6, unitPrice: "189.99", discount: "0", discountPercent: "0", total: "1139.94", itemId: createdItems[0].id },
        { description: "Cloudy Bay Sauvignon Blanc 12-pack", quantity: 2, unitPrice: "288.00", discount: "0", discountPercent: "0", total: "576.00", itemId: createdItems[5].id },
      ];
      const inv1Sub = 1715.94;
      const inv1Tax = +(inv1Sub * 0.19).toFixed(2);
      const [inv1] = await db.insert(invoices).values({
        invoiceNumber: "INV-00001", type: "invoice", customerId: createdCustomers[0].id,
        date: fmt(addDays(today, -18)), dueDate: fmt(addDays(today, 12)),
        subtotal: inv1Sub.toFixed(2), taxRate: "19", taxAmount: inv1Tax.toFixed(2),
        discountAmount: "0", total: (inv1Sub + inv1Tax).toFixed(2), status: "sent",
      }).returning();
      await db.insert(invoiceItems).values(inv1Items.map(li => ({ ...li, invoiceId: inv1.id })));

      const inv2Items = [
        { description: "Dom Pérignon 2013", quantity: 12, unitPrice: "239.99", discount: "50.00", discountPercent: "0", total: "2829.88", itemId: createdItems[9].id },
        { description: "Macallan 18 Year", quantity: 6, unitPrice: "319.99", discount: "0", discountPercent: "0", total: "1919.94", itemId: createdItems[12].id },
      ];
      const inv2Sub = 4749.82;
      const inv2Tax = +(inv2Sub * 0.19).toFixed(2);
      const [inv2] = await db.insert(invoices).values({
        invoiceNumber: "INV-00002", type: "invoice", customerId: createdCustomers[7].id,
        date: fmt(addDays(today, -13)), dueDate: fmt(addDays(today, 47)),
        subtotal: inv2Sub.toFixed(2), taxRate: "19", taxAmount: inv2Tax.toFixed(2),
        discountAmount: "50.00", total: (inv2Sub + inv2Tax).toFixed(2), status: "paid",
      }).returning();
      await db.insert(invoiceItems).values(inv2Items.map(li => ({ ...li, invoiceId: inv2.id })));

      await db.insert(payments).values({
        invoiceId: inv2.id, amount: (inv2Sub + inv2Tax).toFixed(2),
        paymentDate: fmt(addDays(today, -5)), paymentMethod: "bank_transfer", reference: "TRF-20260220-001",
      });

      const inv3Items = [
        { description: "Veuve Clicquot Yellow Label 6-pack", quantity: 4, unitPrice: "342.00", discount: "0", discountPercent: "0", total: "1368.00", itemId: createdItems[10].id },
      ];
      const [inv3] = await db.insert(invoices).values({
        invoiceNumber: "INV-00003", type: "invoice", customerId: createdCustomers[1].id,
        date: fmt(addDays(today, -39)), dueDate: fmt(addDays(today, -25)),
        subtotal: "1368.00", taxRate: "19", taxAmount: "259.92",
        discountAmount: "0", total: "1627.92", status: "overdue",
      }).returning();
      await db.insert(invoiceItems).values(inv3Items.map(li => ({ ...li, invoiceId: inv3.id })));

      const inv4Items = [
        { description: "Grey Goose Vodka", quantity: 24, unitPrice: "39.00", discount: "0", discountPercent: "5", total: "889.20", itemId: createdItems[14].id },
        { description: "Hendrick's Gin", quantity: 12, unitPrice: "35.00", discount: "0", discountPercent: "0", total: "420.00", itemId: createdItems[15].id },
        { description: "Prosecco Superiore DOCG 12-pack", quantity: 3, unitPrice: "168.00", discount: "0", discountPercent: "0", total: "504.00", itemId: createdItems[11].id },
      ];
      const inv4Sub = 1813.20;
      const inv4Tax = +(inv4Sub * 0.19).toFixed(2);
      const [inv4] = await db.insert(invoices).values({
        invoiceNumber: "INV-00004", type: "invoice", customerId: createdCustomers[5].id,
        date: fmt(addDays(today, -7)), dueDate: fmt(addDays(today, 0)),
        subtotal: inv4Sub.toFixed(2), taxRate: "19", taxAmount: inv4Tax.toFixed(2),
        discountAmount: "0", total: (inv4Sub + inv4Tax).toFixed(2), status: "sent",
      }).returning();
      await db.insert(invoiceItems).values(inv4Items.map(li => ({ ...li, invoiceId: inv4.id })));

      const inv5Items = [
        { description: "Barolo Riserva 2016", quantity: 12, unitPrice: "79.00", discount: "0", discountPercent: "0", total: "948.00", itemId: createdItems[3].id },
        { description: "Whispering Angel Rosé 2023 12-pack", quantity: 2, unitPrice: "228.00", discount: "0", discountPercent: "0", total: "456.00", itemId: createdItems[17].id },
      ];
      const inv5Sub = 1404.00;
      const inv5Tax = +(inv5Sub * 0.19).toFixed(2);
      const [inv5] = await db.insert(invoices).values({
        invoiceNumber: "INV-00005", type: "invoice", customerId: createdCustomers[6].id,
        date: fmt(addDays(today, -3)), dueDate: fmt(addDays(today, 27)),
        subtotal: inv5Sub.toFixed(2), taxRate: "19", taxAmount: inv5Tax.toFixed(2),
        discountAmount: "0", total: (inv5Sub + inv5Tax).toFixed(2), status: "draft",
      }).returning();
      await db.insert(invoiceItems).values(inv5Items.map(li => ({ ...li, invoiceId: inv5.id })));

      const cn1Items = [
        { description: "Château Margaux 2018 (returned damaged)", quantity: 2, unitPrice: "189.99", discount: "0", discountPercent: "0", total: "379.98", itemId: createdItems[0].id },
      ];
      const cn1Sub = 379.98;
      const cn1Tax = +(cn1Sub * 0.19).toFixed(2);
      const [cn1] = await db.insert(invoices).values({
        invoiceNumber: "CN-00001", type: "credit_note", customerId: createdCustomers[0].id,
        date: fmt(addDays(today, -10)), dueDate: fmt(addDays(today, -10)),
        subtotal: cn1Sub.toFixed(2), taxRate: "19", taxAmount: cn1Tax.toFixed(2),
        discountAmount: "0", total: (cn1Sub + cn1Tax).toFixed(2), status: "sent", linkedInvoiceId: inv1.id,
      }).returning();
      await db.insert(invoiceItems).values(cn1Items.map(li => ({ ...li, invoiceId: cn1.id })));

      const pf1Items = [
        { description: "Penfolds Grange 2017 6-pack", quantity: 2, unitPrice: "1999.00", discount: "0", discountPercent: "0", total: "3998.00", itemId: createdItems[2].id },
        { description: "Riesling Spätlese 2022", quantity: 24, unitPrice: "26.00", discount: "0", discountPercent: "0", total: "624.00", itemId: createdItems[8].id },
      ];
      const pf1Sub = 4622.00;
      const pf1Tax = +(pf1Sub * 0.19).toFixed(2);
      const [pf1] = await db.insert(invoices).values({
        invoiceNumber: "PF-00001", type: "proforma", customerId: createdCustomers[3].id,
        date: fmt(addDays(today, -2)), dueDate: fmt(addDays(today, 28)),
        subtotal: pf1Sub.toFixed(2), taxRate: "19", taxAmount: pf1Tax.toFixed(2),
        discountAmount: "0", total: (pf1Sub + pf1Tax).toFixed(2), status: "draft",
      }).returning();
      await db.insert(invoiceItems).values(pf1Items.map(li => ({ ...li, invoiceId: pf1.id })));

      const qt1Items = [
        { description: "Rioja Gran Reserva 2015 12-pack", quantity: 5, unitPrice: "504.00", discount: "0", discountPercent: "10", total: "2268.00", itemId: createdItems[4].id },
        { description: "Miraval Rosé 2023 6-pack", quantity: 4, unitPrice: "132.00", discount: "0", discountPercent: "0", total: "528.00", itemId: createdItems[18].id },
      ];
      const qt1Sub = 2796.00;
      const qt1Tax = +(qt1Sub * 0.19).toFixed(2);
      await db.insert(invoices).values({
        invoiceNumber: "QT-00001", type: "quotation", customerId: createdCustomers[9].id,
        date: fmt(today), dueDate: fmt(addDays(today, 30)),
        subtotal: qt1Sub.toFixed(2), taxRate: "19", taxAmount: qt1Tax.toFixed(2),
        discountAmount: "0", total: (qt1Sub + qt1Tax).toFixed(2), status: "draft",
      }).returning().then(([qt1]) => db.insert(invoiceItems).values(qt1Items.map(li => ({ ...li, invoiceId: qt1.id }))));

      const [contract1] = await db.insert(priceContracts).values({
        customerId: createdCustomers[0].id, name: "Wine House Annual Contract",
        startDate: "2026-01-01", endDate: "2026-12-31", discountType: "percentage",
        discountValue: "10", minQuantity: 12, active: true,
        purchaseGoal: "25000", voucherType: "percentage", voucherValue: "5",
      }).returning();
      await db.insert(priceContractRules).values([
        { contractId: contract1.id, categoryIds: [redWine.id, whiteWine.id], brands: [], minQuantity: 6, discountType: "percentage", discountValue: "10" },
        { contractId: contract1.id, categoryIds: [sparkling.id], brands: [], minQuantity: 12, discountType: "percentage", discountValue: "8" },
      ]);

      const [contract2] = await db.insert(priceContracts).values({
        customerId: createdCustomers[7].id, name: "Elite Dining Premium Deal",
        startDate: "2026-01-01", endDate: "2026-06-30", discountType: "percentage",
        discountValue: "8", minQuantity: 6, active: true,
        purchaseGoal: "50000", voucherType: "fixed", voucherValue: "500",
      }).returning();
      await db.insert(priceContractRules).values([
        { contractId: contract2.id, categoryIds: [spirits.id], brands: ["Macallan", "Hennessy"], minQuantity: 3, discountType: "percentage", discountValue: "12" },
        { contractId: contract2.id, categoryIds: [], brands: [], minQuantity: 24, discountType: "fixed", discountValue: "5" },
      ]);

      await db.insert(seasonalOffers).values({
        name: "Spring Wine Festival", description: "Mix and match any 6 bottles from our red and white wine collections for a special discount",
        startDate: "2026-03-01", endDate: "2026-05-31", discountPercentage: "15",
        minItems: 6, mixMatch: true, active: true,
      });

      await db.insert(seasonalOffers).values({
        name: "Summer Sparkling Special", description: "Buy any 12 sparkling wines and get 20% off",
        startDate: "2026-06-01", endDate: "2026-08-31", discountPercentage: "20",
        minItems: 12, mixMatch: false, active: true,
      });

      await db.insert(seasonalOffers).values({
        name: "Cyprus Commandaria Week", description: "Special pricing on local Commandaria wines - buy 3 get 10% off",
        startDate: "2026-04-01", endDate: "2026-04-07", discountPercentage: "10",
        minItems: 3, mixMatch: false, active: true,
      });

      res.json({ message: "Demo data seeded successfully", counts: { categories: 7, items: seedItems.length, customers: seedCustomers.length, suppliers: seedSuppliers.length, invoices: 8, offers: 3, contracts: 2 } });
    } catch (e: any) {
      console.error("Demo seed error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/demo/clear", async (_req, res) => {
    try {
      await db.delete(emailLogs);
      await db.delete(portalOrderItems);
      await db.delete(portalOrders);
      await db.delete(supplierPayments);
      await db.delete(purchaseInvoiceItems);
      await db.delete(purchaseInvoices);
      await db.delete(payments);
      await db.delete(invoiceItems);
      await db.delete(invoices);
      await db.delete(priceContractItems);
      await db.delete(priceContractRules);
      await db.delete(priceContracts);
      await db.delete(seasonalOfferItems);
      await db.delete(seasonalOffers);
      await db.delete(items);
      await db.delete(categories);
      await db.delete(customers);
      await db.delete(suppliers);
      res.json({ message: "All demo data cleared successfully" });
    } catch (e: any) {
      console.error("Demo clear error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ===== ACCOUNTING MODULE =====

  const DEFAULT_ACCOUNTS = [
    { code: "1000", name: "Cash", type: "asset", subtype: "current_asset", isSystem: true },
    { code: "1010", name: "Bank Account", type: "asset", subtype: "current_asset", isSystem: true },
    { code: "1100", name: "Accounts Receivable", type: "asset", subtype: "current_asset", isSystem: true },
    { code: "1200", name: "Inventory", type: "asset", subtype: "current_asset", isSystem: true },
    { code: "1300", name: "Prepaid Expenses", type: "asset", subtype: "current_asset", isSystem: false },
    { code: "1500", name: "Equipment", type: "asset", subtype: "fixed_asset", isSystem: false },
    { code: "1510", name: "Vehicles", type: "asset", subtype: "fixed_asset", isSystem: false },
    { code: "2000", name: "Accounts Payable", type: "liability", subtype: "current_liability", isSystem: true },
    { code: "2100", name: "VAT Payable", type: "liability", subtype: "current_liability", isSystem: true },
    { code: "2200", name: "Accrued Expenses", type: "liability", subtype: "current_liability", isSystem: false },
    { code: "2300", name: "Short-Term Loans", type: "liability", subtype: "current_liability", isSystem: false },
    { code: "3000", name: "Owner's Equity", type: "equity", subtype: "equity", isSystem: true },
    { code: "3100", name: "Retained Earnings", type: "equity", subtype: "equity", isSystem: true },
    { code: "3200", name: "Owner's Draw", type: "equity", subtype: "equity", isSystem: false },
    { code: "4000", name: "Sales Revenue", type: "revenue", subtype: "operating", isSystem: true },
    { code: "4100", name: "Service Revenue", type: "revenue", subtype: "operating", isSystem: false },
    { code: "4200", name: "Other Income", type: "revenue", subtype: "other", isSystem: false },
    { code: "4300", name: "Interest Income", type: "revenue", subtype: "other", isSystem: false },
    { code: "5000", name: "Cost of Goods Sold", type: "expense", subtype: "cogs", isSystem: true },
    { code: "6000", name: "Salaries & Wages", type: "expense", subtype: "operating", isSystem: false },
    { code: "6100", name: "Rent", type: "expense", subtype: "operating", isSystem: false },
    { code: "6200", name: "Utilities", type: "expense", subtype: "operating", isSystem: false },
    { code: "6300", name: "Insurance", type: "expense", subtype: "operating", isSystem: false },
    { code: "6400", name: "Marketing & Advertising", type: "expense", subtype: "operating", isSystem: false },
    { code: "6500", name: "Office Supplies", type: "expense", subtype: "operating", isSystem: false },
    { code: "6600", name: "Bank Charges", type: "expense", subtype: "operating", isSystem: false },
    { code: "6700", name: "Depreciation", type: "expense", subtype: "operating", isSystem: false },
    { code: "6800", name: "Repairs & Maintenance", type: "expense", subtype: "operating", isSystem: false },
    { code: "6900", name: "Travel & Transport", type: "expense", subtype: "operating", isSystem: false },
    { code: "7000", name: "Professional Fees", type: "expense", subtype: "operating", isSystem: false },
    { code: "7100", name: "Telephone & Internet", type: "expense", subtype: "operating", isSystem: false },
    { code: "7200", name: "Miscellaneous Expense", type: "expense", subtype: "operating", isSystem: false },
  ];

  app.get("/api/accounts", async (_req, res) => {
    const accts = await storage.getAccounts();
    res.json(accts);
  });

  app.post("/api/accounts", async (req, res) => {
    try {
      const account = await storage.createAccount(req.body);
      res.json(account);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.put("/api/accounts/:id", async (req, res) => {
    const account = await storage.updateAccount(req.params.id, req.body);
    if (!account) return res.status(404).json({ message: "Account not found" });
    res.json(account);
  });

  app.post("/api/accounts/seed-defaults", async (_req, res) => {
    try {
      const existing = await storage.getAccounts();
      if (existing.length > 0) {
        return res.json({ message: "Chart of accounts already exists", count: existing.length });
      }
      for (const acct of DEFAULT_ACCOUNTS) {
        await storage.createAccount(acct as any);
      }
      res.json({ message: "Default chart of accounts created", count: DEFAULT_ACCOUNTS.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/accounts/recalculate", async (_req, res) => {
    try {
      const accts = await storage.getAccounts();
      if (accts.length === 0) return res.status(400).json({ message: "No chart of accounts. Seed defaults first." });

      const { journalEntryLines: jelTable, journalEntries: jeTable } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const manualEntries = await db.select().from(jeTable).where(eq(jeTable.sourceType, "manual"));
      const manualEntryIds = manualEntries.map(e => e.id);
      const allExistingLines = await db.select().from(jelTable);
      const manualLines = allExistingLines.filter(l => manualEntryIds.includes(l.journalEntryId));

      await db.delete(jelTable);
      await db.delete(jeTable);
      await db.update(accounts).set({ balance: "0.00" });

      for (const me of manualEntries) {
        await db.insert(jeTable).values(me);
      }
      for (const ml of manualLines) {
        await db.insert(jelTable).values(ml);
        const acct = accts.find(a => a.id === ml.accountId);
        if (acct) {
          const debit = parseFloat(ml.debit);
          const credit = parseFloat(ml.credit);
          const isDebitNormal = acct.type === "asset" || acct.type === "expense";
          const balanceChange = isDebitNormal ? (debit - credit) : (credit - debit);
          const currentBal = await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, acct.id));
          const newBal = parseFloat(currentBal[0]?.balance || "0") + balanceChange;
          await db.update(accounts).set({ balance: newBal.toFixed(2) }).where(eq(accounts.id, acct.id));
        }
      }

      let generated = 0;
      let skipped = 0;

      const allInvoices = await db.select().from(invoices);
      const allInvoiceItems = await db.select().from(invoiceItems);
      const allItems = await db.select().from(items);
      for (const inv of allInvoices) {
        const invTotal = parseFloat(inv.total);
        const invVat = parseFloat(inv.taxAmount);
        const invNet = parseFloat(inv.subtotal) - parseFloat(inv.discountAmount);
        const invDate = typeof inv.date === "string" ? inv.date : new Date().toISOString().split("T")[0];
        if (invTotal <= 0) continue;

        let totalCost = 0;
        const invLines = allInvoiceItems.filter(li => li.invoiceId === inv.id);
        for (const li of invLines) {
          if (li.itemId) {
            const item = allItems.find(i => i.id === li.itemId);
            if (item) {
              const costPerUnit = parseFloat(item.costPrice);
              const qty = (li.saleUnit === "pack" && item.packSize > 1) ? li.quantity * item.packSize : li.quantity;
              totalCost += costPerUnit * qty;
            }
          }
        }

        if (inv.type === "invoice" && inv.status !== "draft") {
          const lines = [
            { accountCode: "1100", debit: invTotal, credit: 0, description: "Accounts Receivable" },
            { accountCode: "4000", debit: 0, credit: invNet, description: "Sales Revenue" },
            { accountCode: "2100", debit: 0, credit: invVat, description: "VAT Payable" },
          ];
          if (totalCost > 0) {
            lines.push(
              { accountCode: "5000", debit: totalCost, credit: 0, description: "Cost of Goods Sold" },
              { accountCode: "1200", debit: 0, credit: totalCost, description: "Inventory" },
            );
          }
          const result = await autoCreateJournalEntry({
            sourceType: "invoice", sourceId: inv.id, date: invDate,
            description: `Sales Invoice ${inv.invoiceNumber}`, reference: inv.invoiceNumber,
            lines,
          });
          result ? generated++ : skipped++;
        } else if (inv.type === "credit_note" && inv.status !== "draft") {
          const lines = [
            { accountCode: "4000", debit: invNet, credit: 0, description: "Sales Revenue reversal" },
            { accountCode: "2100", debit: invVat, credit: 0, description: "VAT Payable reversal" },
            { accountCode: "1100", debit: 0, credit: invTotal, description: "Accounts Receivable reversal" },
          ];
          if (totalCost > 0) {
            lines.push(
              { accountCode: "1200", debit: totalCost, credit: 0, description: "Inventory restored" },
              { accountCode: "5000", debit: 0, credit: totalCost, description: "COGS reversal" },
            );
          }
          const result = await autoCreateJournalEntry({
            sourceType: "credit_note", sourceId: inv.id, date: invDate,
            description: `Credit Note ${inv.invoiceNumber}`, reference: inv.invoiceNumber,
            lines,
          });
          result ? generated++ : skipped++;
        }
      }

      const allPayments = await db.select().from(payments);
      for (const pmt of allPayments) {
        const pmtAmount = parseFloat(pmt.amount);
        if (pmtAmount <= 0) continue;
        const pmtDate = typeof pmt.paymentDate === "string" ? pmt.paymentDate : new Date().toISOString().split("T")[0];
        const pmtAcctCode = pmt.paymentMethod === "cash" ? "1000" : "1010";
        const result = await autoCreateJournalEntry({
          sourceType: "payment", sourceId: pmt.id, date: pmtDate,
          description: "Customer Payment received", reference: pmt.reference || pmt.id,
          lines: [
            { accountCode: pmtAcctCode, debit: pmtAmount, credit: 0, description: pmt.paymentMethod === "cash" ? "Cash" : "Bank" },
            { accountCode: "1100", debit: 0, credit: pmtAmount, description: "Accounts Receivable" },
          ],
        });
        result ? generated++ : skipped++;
      }

      const allPI = await db.select().from(purchaseInvoices);
      for (const pi of allPI) {
        const piTotal = parseFloat(pi.total);
        const piVat = parseFloat(pi.vatAmount);
        const piNet = parseFloat(pi.subtotal);
        const piDate = typeof pi.date === "string" ? pi.date : new Date().toISOString().split("T")[0];
        if (piTotal <= 0) continue;
        const result = await autoCreateJournalEntry({
          sourceType: "purchase", sourceId: pi.id, date: piDate,
          description: `Purchase Invoice ${pi.invoiceNumber}`, reference: pi.invoiceNumber,
          lines: [
            { accountCode: "1200", debit: piNet, credit: 0, description: "Inventory" },
            { accountCode: "2100", debit: piVat, credit: 0, description: "Input VAT (VAT Receivable)" },
            { accountCode: "2000", debit: 0, credit: piTotal, description: "Accounts Payable" },
          ],
        });
        result ? generated++ : skipped++;
      }

      const allSP = await db.select().from(supplierPayments);
      for (const sp of allSP) {
        const spAmount = parseFloat(sp.amount);
        if (spAmount <= 0) continue;
        const spDate = typeof sp.paymentDate === "string" ? sp.paymentDate : new Date().toISOString().split("T")[0];
        const paymentAcctCode = sp.paymentMethod === "cash" ? "1000" : "1010";
        const result = await autoCreateJournalEntry({
          sourceType: "supplier_payment", sourceId: sp.id, date: spDate,
          description: `Supplier Payment`, reference: sp.reference || sp.id,
          lines: [
            { accountCode: "2000", debit: spAmount, credit: 0, description: "Accounts Payable" },
            { accountCode: paymentAcctCode, debit: 0, credit: spAmount, description: sp.paymentMethod === "cash" ? "Cash" : "Bank" },
          ],
        });
        result ? generated++ : skipped++;
      }

      const allExpenses = await db.select().from(expenses);
      for (const exp of allExpenses) {
        const expAmount = parseFloat(exp.amount);
        const expVat = parseFloat(exp.vatAmount || "0");
        const expTotal = expAmount + expVat;
        if (expAmount <= 0) continue;
        const expDate = typeof exp.date === "string" ? exp.date : new Date().toISOString().split("T")[0];
        const expAcct = await storage.getAccount(exp.expenseAccountId);
        const payAcct = await storage.getAccount(exp.paymentAccountId);
        const result = await autoCreateJournalEntry({
          sourceType: "expense", sourceId: exp.id, date: expDate,
          description: `Expense: ${exp.description}`, reference: exp.reference || exp.id,
          lines: [
            { accountCode: expAcct?.code || "6000", debit: expAmount, credit: 0, description: exp.description },
            ...(expVat > 0 ? [{ accountCode: "2100", debit: expVat, credit: 0, description: "Input VAT" }] : []),
            { accountCode: payAcct?.code || "1000", debit: 0, credit: expTotal, description: "Payment" },
          ],
        });
        result ? generated++ : skipped++;
      }

      // Rebuild supplier currentBalance from purchase invoices minus supplier payments
      const allSuppliers = await storage.getSuppliers();
      for (const sup of allSuppliers) {
        const supPI = allPI.filter(p => p.supplierId === sup.id);
        const totalOwed = supPI.reduce((s, p) => s + parseFloat(p.total), 0);
        const supPayments = allSP.filter(p => p.supplierId === sup.id);
        const totalPaid = supPayments.reduce((s, p) => s + parseFloat(p.amount), 0);
        const newBal = Math.max(0, totalOwed - totalPaid);
        await storage.updateSupplier(sup.id, { currentBalance: newBal.toFixed(2) });
      }

      const updatedAccts = await storage.getAccounts();
      const nonZero = updatedAccts.filter(a => parseFloat(a.balance) !== 0);
      res.json({ 
        message: `Recalculated. Generated ${generated} journal entries (${skipped} skipped). ${manualEntries.length} manual entries preserved. All account balances and supplier balances rebuilt.`, 
        nonZeroAccounts: nonZero.length,
        generated,
        skipped,
        manualPreserved: manualEntries.length
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/journal-entries", async (_req, res) => {
    const entries = await storage.getJournalEntries();
    res.json(entries);
  });

  // Audit endpoint — all entries with lines + account info in one payload
  app.get("/api/accounting/audit", async (_req, res) => {
    try {
      const allEntries = await db.select().from(journalEntries).orderBy(desc(journalEntries.date), desc(journalEntries.createdAt));
      const allLines = await db
        .select({
          id: journalEntryLines.id,
          journalEntryId: journalEntryLines.journalEntryId,
          accountId: journalEntryLines.accountId,
          debit: journalEntryLines.debit,
          credit: journalEntryLines.credit,
          description: journalEntryLines.description,
          accountCode: accounts.code,
          accountName: accounts.name,
          accountType: accounts.type,
        })
        .from(journalEntryLines)
        .leftJoin(accounts, eq(journalEntryLines.accountId, accounts.id));

      const linesMap: Record<string, typeof allLines> = {};
      for (const line of allLines) {
        if (!linesMap[line.journalEntryId]) linesMap[line.journalEntryId] = [];
        linesMap[line.journalEntryId].push(line);
      }

      const enriched = allEntries.map(entry => {
        const lines = linesMap[entry.id] || [];
        const totalDebit = lines.reduce((s, l) => s + parseFloat(String(l.debit || "0")), 0);
        const totalCredit = lines.reduce((s, l) => s + parseFloat(String(l.credit || "0")), 0);
        const balanced = Math.abs(totalDebit - totalCredit) < 0.01;
        return { ...entry, lines, totalDebit: totalDebit.toFixed(2), totalCredit: totalCredit.toFixed(2), balanced };
      });

      res.json(enriched);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Accounting Snapshots (Version Control) ──────────────────────────────────
  app.get("/api/accounting/snapshots", async (_req, res) => {
    try {
      const snaps = await db.select().from(accountingSnapshots).orderBy(desc(accountingSnapshots.createdAt));
      res.json(snaps);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/accounting/snapshots", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const { name, description, notes } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Snapshot name is required" });

      const allAccounts = await db.select().from(accounts);
      const allJEs = await db.select().from(journalEntries).orderBy(desc(journalEntries.entryNumber));

      const totalDebitVolume = allJEs.reduce((s, je) => s + parseFloat(String(je.totalAmount || "0")), 0);
      const lastEntry = allJEs[0];

      const snap = await db.insert(accountingSnapshots).values({
        name: name.trim(),
        description: description?.trim() || null,
        notes: notes?.trim() || null,
        createdByUsername: req.user.username,
        accountBalances: JSON.stringify(allAccounts.map(a => ({
          id: a.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, balance: a.balance,
        }))),
        journalEntryCount: allJEs.length,
        lastEntryNumber: lastEntry?.entryNumber ?? null,
        totalDebitVolume: totalDebitVolume.toFixed(2),
      }).returning();

      await logActivity(req.user.id, req.user.username, "create", "accounting_snapshot", snap[0].id, `Created snapshot "${name.trim()}" — ${allJEs.length} JEs, ${allAccounts.length} accounts`, null, null);
      res.json(snap[0]);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/accounting/snapshots/:id", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const [snap] = await db.select().from(accountingSnapshots).where(eq(accountingSnapshots.id, req.params.id));
      const snapName = snap?.name ?? req.params.id;
      await db.delete(accountingSnapshots).where(eq(accountingSnapshots.id, req.params.id));
      await logActivity(req.user.id, req.user.username, "delete", "accounting_snapshot", req.params.id, `Deleted snapshot "${snapName}"`, null, null);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/accounting/snapshots/diff", async (req, res) => {
    try {
      const { from: fromId, to: toId } = req.query as { from: string; to: string };
      if (!fromId || !toId) return res.status(400).json({ message: "from and to snapshot IDs required" });

      const [snapFrom] = await db.select().from(accountingSnapshots).where(eq(accountingSnapshots.id, fromId));
      const [snapTo]   = await db.select().from(accountingSnapshots).where(eq(accountingSnapshots.id, toId));
      if (!snapFrom || !snapTo) return res.status(404).json({ message: "Snapshot not found" });

      const fromAccounts: any[] = JSON.parse(snapFrom.accountBalances);
      const toAccounts:   any[] = JSON.parse(snapTo.accountBalances);

      const fromMap = Object.fromEntries(fromAccounts.map(a => [a.id, a]));
      const toMap   = Object.fromEntries(toAccounts.map(a => [a.id, a]));

      const allIds = [...new Set([...fromAccounts.map(a => a.id), ...toAccounts.map(a => a.id)])];
      const changes = allIds.map(id => {
        const before = fromMap[id];
        const after  = toMap[id];
        const balBefore = parseFloat(before?.balance ?? "0");
        const balAfter  = parseFloat(after?.balance ?? "0");
        const delta = balAfter - balBefore;
        return {
          id,
          code:    (after ?? before).code,
          name:    (after ?? before).name,
          type:    (after ?? before).type,
          before:  balBefore.toFixed(2),
          after:   balAfter.toFixed(2),
          delta:   delta.toFixed(2),
          added:   !before && !!after,
          removed: !!before && !after,
          changed: Math.abs(delta) >= 0.01,
        };
      }).filter(r => r.changed || r.added || r.removed);

      res.json({
        from: { id: snapFrom.id, name: snapFrom.name, createdAt: snapFrom.createdAt, journalEntryCount: snapFrom.journalEntryCount, lastEntryNumber: snapFrom.lastEntryNumber, totalDebitVolume: snapFrom.totalDebitVolume },
        to:   { id: snapTo.id,   name: snapTo.name,   createdAt: snapTo.createdAt,   journalEntryCount: snapTo.journalEntryCount,   lastEntryNumber: snapTo.lastEntryNumber,   totalDebitVolume: snapTo.totalDebitVolume },
        changes,
        summary: {
          totalChanges: changes.length,
          accountsAdded: changes.filter(c => c.added).length,
          accountsRemoved: changes.filter(c => c.removed).length,
          entriesAdded: (snapTo.journalEntryCount ?? 0) - (snapFrom.journalEntryCount ?? 0),
          volumeChange: (parseFloat(String(snapTo.totalDebitVolume)) - parseFloat(String(snapFrom.totalDebitVolume))).toFixed(2),
        },
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/accounting/snapshots/:id/rollback", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const [snap] = await db.select().from(accountingSnapshots).where(eq(accountingSnapshots.id, req.params.id));
      if (!snap) return res.status(404).json({ message: "Snapshot not found" });

      const savedBalances: any[] = JSON.parse(snap.accountBalances);

      // Reset all accounts to 0, then restore from snapshot
      await db.update(accounts).set({ balance: "0.00" });
      for (const saved of savedBalances) {
        await db.update(accounts).set({ balance: saved.balance }).where(eq(accounts.id, saved.id));
      }

      const msg = `Rolled back ${savedBalances.length} account balances to snapshot "${snap.name}" (${new Date(snap.createdAt).toLocaleDateString()}).`;
      await logActivity(req.user.id, req.user.username, "rollback", "accounting_snapshot", snap.id, msg, null, null);

      res.json({
        success: true,
        message: msg,
        accountsRestored: savedBalances.length,
        snapshotName: snap.name,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/accounting/full-reset", async (req, res) => {
    if (!req.user || req.user.role !== "superuser") {
      return res.status(403).json({ message: "Superuser access required" });
    }
    try {
      // 1. Delete all journal entry lines and entries
      await db.delete(journalEntryLines);
      await db.delete(journalEntries);

      // 2. Delete all customer payments
      await db.delete(payments);

      // 3. Delete all supplier payments
      await db.delete(supplierPayments);

      // 4. Reset customer balances to zero
      await db.update(customers).set({ currentBalance: "0.00" });

      // 5. Reset supplier balances to zero
      await db.update(suppliers).set({ currentBalance: "0.00" });

      // 6. Reset invoice statuses: paid/partial → sent (since payments are gone)
      await db.update(invoices)
        .set({ status: "sent" })
        .where(sql`${invoices.status} IN ('paid', 'partial') AND ${invoices.type} = 'invoice'`);

      // 7. Reset account balances to zero
      await db.update(accounts).set({ balance: "0.00" });

      // 8. Delete all accounting snapshots (now stale)
      await db.delete(accountingSnapshots);

      await logActivity(req.user.id, req.user.username, "full_reset", "accounting", "all",
        "Full accounting reset: cleared all journal entries, payments, customer/supplier balances, and account balances.", null, null);

      res.json({ ok: true, message: "Full accounting reset complete." });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/accounting/snapshots/logs", async (_req, res) => {
    try {
      const logs = await db.select().from(activityLogs)
        .where(eq(activityLogs.entity, "accounting_snapshot"))
        .orderBy(desc(activityLogs.createdAt))
        .limit(200);
      res.json(logs);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── Transaction Trace (Simulation) ──────────────────────────────────────────
  app.get("/api/accounting/trace", async (req, res) => {
    const { type, id } = req.query as { type: string; id: string };
    if (!type || !id) return res.status(400).json({ message: "type and id are required" });

    try {
      // 1. Find journal entry for this source
      const [je] = await db.select().from(journalEntries)
        .where(and(eq(journalEntries.sourceType, type), eq(journalEntries.sourceId, id)));

      let journalEntry: any = null;
      if (je) {
        const lines = await db.select({
          id: journalEntryLines.id,
          journalEntryId: journalEntryLines.journalEntryId,
          accountId: journalEntryLines.accountId,
          accountCode: accounts.code,
          accountName: accounts.name,
          accountType: accounts.type,
          accountSubtype: accounts.subtype,
          debit: journalEntryLines.debit,
          credit: journalEntryLines.credit,
          description: journalEntryLines.description,
        }).from(journalEntryLines)
          .leftJoin(accounts, eq(journalEntryLines.accountId, accounts.id))
          .where(eq(journalEntryLines.journalEntryId, je.id));

        const totalDebit = lines.reduce((s, l) => s + parseFloat(String(l.debit || "0")), 0);
        const totalCredit = lines.reduce((s, l) => s + parseFloat(String(l.credit || "0")), 0);
        journalEntry = {
          ...je,
          lines,
          totalDebit: totalDebit.toFixed(2),
          totalCredit: totalCredit.toFixed(2),
          balanced: Math.abs(totalDebit - totalCredit) < 0.01,
        };
      }

      // 2. Load source transaction
      let source: any = null;
      let sourceLabel = type;

      if (type === "invoice" || type === "credit_note" || type === "proforma" || type === "quotation") {
        const rows = await db.execute(sql`
          SELECT i.*, c.name as customer_name, c.code as customer_code, c.tax_id as customer_tax_id,
                 c.payment_terms, c.current_balance
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          WHERE i.id = ${id}
        `);
        const inv = (rows.rows as any[])[0];
        if (inv) {
          const itemRows = await db.execute(sql`
            SELECT ii.*, it.sku, it.name as item_name
            FROM invoice_items ii
            LEFT JOIN items it ON ii.item_id = it.id
            WHERE ii.invoice_id = ${id}
            ORDER BY ii.id
          `);
          source = { ...inv, lines: itemRows.rows };
          sourceLabel = inv.type || type;
        }
      } else if (type === "payment") {
        const rows = await db.execute(sql`
          SELECT p.*, c.name as customer_name, c.code as customer_code,
                 i.invoice_number, i.total as invoice_total, i.status as invoice_status
          FROM payments p
          LEFT JOIN customers c ON p.customer_id = c.id
          LEFT JOIN invoices i ON p.invoice_id = i.id
          WHERE p.id = ${id}
        `);
        source = (rows.rows as any[])[0] ?? null;
      } else if (type === "purchase") {
        const rows = await db.execute(sql`
          SELECT pi.*, s.name as supplier_name, s.code as supplier_code
          FROM purchase_invoices pi
          LEFT JOIN suppliers s ON pi.supplier_id = s.id
          WHERE pi.id = ${id}
        `);
        const pur = (rows.rows as any[])[0];
        if (pur) {
          const itemRows = await db.execute(sql`
            SELECT pii.*, it.sku, it.name as item_name
            FROM purchase_invoice_items pii
            LEFT JOIN items it ON pii.item_id = it.id
            WHERE pii.purchase_invoice_id = ${id}
            ORDER BY pii.id
          `);
          source = { ...pur, lines: itemRows.rows };
        }
      } else if (type === "supplier_payment") {
        const rows = await db.execute(sql`
          SELECT sp.*, s.name as supplier_name, s.code as supplier_code,
                 pi.invoice_number as purchase_invoice_number, pi.total as purchase_invoice_total
          FROM supplier_payments sp
          LEFT JOIN suppliers s ON sp.supplier_id = s.id
          LEFT JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
          WHERE sp.id = ${id}
        `);
        source = (rows.rows as any[])[0] ?? null;
      } else if (type === "expense") {
        const rows = await db.execute(sql`
          SELECT e.*, 
                 ea.code as expense_acct_code, ea.name as expense_acct_name,
                 pa.code as payment_acct_code, pa.name as payment_acct_name
          FROM expenses e
          LEFT JOIN accounts ea ON e.expense_account_id = ea.id
          LEFT JOIN accounts pa ON e.payment_account_id = pa.id
          WHERE e.id = ${id}
        `);
        source = (rows.rows as any[])[0] ?? null;
      }

      // 3. Integrity checks
      const checks: Array<{ name: string; pass: boolean; severity: string; detail: string; expected?: string; actual?: string }> = [];

      // Check: journal entry exists
      checks.push({
        name: "Journal entry generated",
        pass: !!journalEntry,
        severity: "error",
        detail: journalEntry
          ? `Entry ${journalEntry.entryNumber} found (${journalEntry.status})`
          : "No journal entry linked to this transaction. If status is draft/cancelled, this is expected.",
      });

      if (journalEntry) {
        // Check: balanced
        checks.push({
          name: "Entry is balanced (DR = CR)",
          pass: journalEntry.balanced,
          severity: "error",
          detail: journalEntry.balanced
            ? `DR €${journalEntry.totalDebit} = CR €${journalEntry.totalCredit} ✓`
            : `Imbalance detected`,
          expected: journalEntry.balanced ? undefined : journalEntry.totalDebit,
          actual: journalEntry.balanced ? undefined : journalEntry.totalCredit,
        });

        // Check: entry is posted
        checks.push({
          name: "Entry status is posted",
          pass: journalEntry.status === "posted",
          severity: "warning",
          detail: journalEntry.status === "posted" ? "Status: posted ✓" : `Status: ${journalEntry.status}`,
        });

        // Source-specific checks
        if (source && (type === "invoice" || type === "credit_note")) {
          const total = parseFloat(source.total || "0");
          const jeTotal = parseFloat(journalEntry.totalDebit);
          const diff = Math.abs(total - jeTotal);
          checks.push({
            name: "Journal total matches transaction total",
            pass: diff < 0.02,
            severity: "error",
            detail: diff < 0.02
              ? `Both = €${total.toFixed(2)} ✓`
              : `Mismatch detected`,
            expected: total.toFixed(2),
            actual: jeTotal.toFixed(2),
          });

          // VAT check
          const vatRate = parseFloat(source.tax_rate || "0");
          const subtotal = parseFloat(source.subtotal || "0");
          const expectedVat = parseFloat((subtotal * vatRate / 100).toFixed(2));
          const actualVat = parseFloat(source.tax_amount || "0");
          checks.push({
            name: "VAT calculation correct",
            pass: Math.abs(expectedVat - actualVat) < 0.02,
            severity: "warning",
            detail: Math.abs(expectedVat - actualVat) < 0.02
              ? `€${subtotal.toFixed(2)} × ${vatRate}% = €${actualVat.toFixed(2)} ✓`
              : `VAT mismatch`,
            expected: expectedVat.toFixed(2),
            actual: actualVat.toFixed(2),
          });

          // Check AR line exists
          const arLine = journalEntry.lines.find((l: any) => l.accountCode === "1100" || (l.accountName || "").toLowerCase().includes("receivable"));
          checks.push({
            name: "Accounts Receivable line exists",
            pass: !!arLine,
            severity: "error",
            detail: arLine
              ? `${arLine.accountCode} – ${arLine.accountName}: DR €${arLine.debit} ✓`
              : "No AR (1100) line found in journal entry.",
          });

          // Check revenue line exists
          const revLine = journalEntry.lines.find((l: any) => l.accountType === "revenue" || (l.accountName || "").toLowerCase().includes("revenue") || l.accountCode === "4000");
          checks.push({
            name: "Revenue account line exists",
            pass: !!revLine,
            severity: "error",
            detail: revLine
              ? `${revLine.accountCode} – ${revLine.accountName}: CR €${revLine.credit} ✓`
              : "No revenue account line found.",
          });
        }

        if (source && type === "payment") {
          const total = parseFloat(source.amount || "0");
          const jeTotal = parseFloat(journalEntry.totalDebit);
          checks.push({
            name: "Journal total matches payment amount",
            pass: Math.abs(total - jeTotal) < 0.02,
            severity: "error",
            detail: Math.abs(total - jeTotal) < 0.02
              ? `Both = €${total.toFixed(2)} ✓`
              : `Mismatch`,
            expected: total.toFixed(2),
            actual: jeTotal.toFixed(2),
          });
          const bankLine = journalEntry.lines.find((l: any) => l.accountType === "asset" && parseFloat(l.debit) > 0 && l.accountCode !== "1100");
          checks.push({
            name: "Bank/Cash account debited",
            pass: !!bankLine,
            severity: "error",
            detail: bankLine ? `${bankLine.accountCode} – ${bankLine.accountName}: DR €${bankLine.debit} ✓` : "No cash/bank debit line found.",
          });
        }

        if (source && type === "purchase") {
          const total = parseFloat(source.total || "0");
          const jeTotal = parseFloat(journalEntry.totalCredit);
          checks.push({
            name: "Journal total matches purchase total",
            pass: Math.abs(total - jeTotal) < 0.02,
            severity: "error",
            detail: Math.abs(total - jeTotal) < 0.02
              ? `Both = €${total.toFixed(2)} ✓`
              : `Mismatch`,
            expected: total.toFixed(2),
            actual: jeTotal.toFixed(2),
          });
          const apLine = journalEntry.lines.find((l: any) => l.accountCode === "2000" || (l.accountName || "").toLowerCase().includes("payable"));
          checks.push({
            name: "Accounts Payable line exists",
            pass: !!apLine,
            severity: "error",
            detail: apLine ? `${apLine.accountCode} – ${apLine.accountName}: CR €${apLine.credit} ✓` : "No AP line found.",
          });
        }

        if (source && type === "expense") {
          const total = parseFloat(source.amount || "0");
          const jeTotal = parseFloat(journalEntry.totalDebit);
          checks.push({
            name: "Journal total matches expense amount",
            pass: Math.abs(total - jeTotal) < 0.02,
            severity: "error",
            detail: Math.abs(total - jeTotal) < 0.02
              ? `Both = €${total.toFixed(2)} ✓`
              : `Mismatch`,
            expected: total.toFixed(2),
            actual: jeTotal.toFixed(2),
          });
        }

        // Check all lines have valid accounts
        const missingAccounts = journalEntry.lines.filter((l: any) => !l.accountCode);
        checks.push({
          name: "All lines linked to valid accounts",
          pass: missingAccounts.length === 0,
          severity: "error",
          detail: missingAccounts.length === 0
            ? `All ${journalEntry.lines.length} lines have valid accounts ✓`
            : `${missingAccounts.length} line(s) reference missing/deleted accounts`,
        });

        // Check all lines have correct normal balance direction
        const wrongDirection = journalEntry.lines.filter((l: any) => {
          const dr = parseFloat(l.debit || "0");
          const cr = parseFloat(l.credit || "0");
          if (dr > 0 && cr > 0) return true; // Line has both DR and CR
          return false;
        });
        checks.push({
          name: "No lines have both debit and credit",
          pass: wrongDirection.length === 0,
          severity: "error",
          detail: wrongDirection.length === 0
            ? "All lines are properly single-sided ✓"
            : `${wrongDirection.length} line(s) have both DR and CR values`,
        });
      }

      res.json({
        sourceType: type,
        sourceLabel,
        source: source || null,
        journalEntry,
        integrityChecks: checks,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/journal-entries/:id", async (req, res) => {
    const entry = await storage.getJournalEntry(req.params.id);
    if (!entry) return res.status(404).json({ message: "Journal entry not found" });
    res.json(entry);
  });

  app.post("/api/journal-entries", async (req, res) => {
    try {
      const { lines, ...data } = req.body;
      if (!lines || !Array.isArray(lines) || lines.length < 2) {
        return res.status(400).json({ message: "At least 2 lines required" });
      }
      const totalDebit = lines.reduce((s: number, l: any) => s + parseFloat(l.debit || "0"), 0);
      const totalCredit = lines.reduce((s: number, l: any) => s + parseFloat(l.credit || "0"), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return res.status(400).json({ message: `Debits (${totalDebit.toFixed(2)}) must equal Credits (${totalCredit.toFixed(2)})` });
      }
      const entryNumber = await storage.getNextJournalEntryNumber();
      const entry = await storage.createJournalEntry(
        { ...data, entryNumber, totalAmount: totalDebit.toFixed(2) },
        lines
      );
      res.json(entry);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/journal-entries/:id", async (req, res) => {
    try {
      const { lines, ...data } = req.body;
      if (!lines || !Array.isArray(lines) || lines.length < 2) {
        return res.status(400).json({ message: "At least 2 lines required" });
      }
      const totalDebit = lines.reduce((s: number, l: any) => s + parseFloat(l.debit || "0"), 0);
      const totalCredit = lines.reduce((s: number, l: any) => s + parseFloat(l.credit || "0"), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return res.status(400).json({ message: `Debits (${totalDebit.toFixed(2)}) must equal Credits (${totalCredit.toFixed(2)})` });
      }
      const updated = await storage.updateJournalEntry(req.params.id, { ...data, totalAmount: totalDebit.toFixed(2) }, lines);
      if (!updated) return res.status(404).json({ message: "Journal entry not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/journal-entries/:id", async (req, res) => {
    try {
      await storage.deleteJournalEntry(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Repost all auto-generated journal entries from source transactions
  app.post("/api/accounting/repost-journals", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      // 1. Delete all auto-generated journal entries and their lines
      await db.execute(sql`
        DELETE FROM journal_entry_lines
        WHERE journal_entry_id IN (
          SELECT id FROM journal_entries
          WHERE source_type IN ('invoice','credit_note','purchase','payment','supplier_payment','expense')
        )
      `);
      await db.execute(sql`
        DELETE FROM journal_entries
        WHERE source_type IN ('invoice','credit_note','purchase','payment','supplier_payment','expense')
      `);

      let created = 0;

      // 2. Repost purchase invoices
      const allPIs = await storage.getPurchaseInvoices();
      for (const pi of allPIs) {
        const piTotal = parseFloat(pi.total);
        const piVat = parseFloat(pi.vatAmount);
        const piNet = piTotal - piVat;
        if (piTotal <= 0) continue;
        const r = await autoCreateJournalEntry({
          sourceType: "purchase", sourceId: pi.id,
          date: typeof pi.date === "string" ? pi.date : new Date(pi.date).toISOString().split("T")[0],
          description: `Purchase Invoice ${pi.invoiceNumber}`, reference: pi.invoiceNumber,
          lines: [
            { accountCode: "1200", debit: piNet, credit: 0, description: "Inventory" },
            { accountCode: "2100", debit: piVat, credit: 0, description: "Input VAT (VAT Receivable)" },
            { accountCode: "2000", debit: 0, credit: piTotal, description: "Accounts Payable" },
          ],
        });
        if (r) created++;
      }

      // 3. Repost sales invoices and credit notes
      const allInvs = await storage.getInvoices();
      for (const inv of allInvs) {
        if (inv.status === "draft") continue;
        const invTotal = parseFloat(String(inv.total));
        const invVat = parseFloat(String(inv.taxAmount));
        const invNet = invTotal - invVat;
        if (invTotal <= 0) continue;
        const invDate = typeof inv.date === "string" ? inv.date : new Date(inv.date).toISOString().split("T")[0];

        // Calculate COGS from current item cost prices
        let totalCost = 0;
        const lineItems = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
        for (const li of lineItems) {
          if (li.itemId) {
            const item = await storage.getItem(li.itemId);
            if (item) {
              const costPerUnit = parseFloat(item.costPrice);
              const qty = (li.saleUnit === "pack" && item.packSize > 1) ? li.quantity * item.packSize : li.quantity;
              totalCost += costPerUnit * qty;
            }
          }
        }

        if (inv.type === "invoice") {
          const jlines: { accountCode: string; debit: number; credit: number; description: string }[] = [
            { accountCode: "1100", debit: invTotal, credit: 0, description: "Accounts Receivable" },
            { accountCode: "4000", debit: 0, credit: invNet, description: "Sales Revenue" },
            { accountCode: "2100", debit: 0, credit: invVat, description: "VAT Payable" },
          ];
          if (totalCost > 0) {
            jlines.push({ accountCode: "5000", debit: totalCost, credit: 0, description: "Cost of Goods Sold" });
            jlines.push({ accountCode: "1200", debit: 0, credit: totalCost, description: "Inventory" });
          }
          const r = await autoCreateJournalEntry({
            sourceType: "invoice", sourceId: inv.id, date: invDate,
            description: `Sales Invoice ${inv.invoiceNumber}`, reference: inv.invoiceNumber, lines: jlines,
          });
          if (r) created++;
        } else if (inv.type === "credit_note") {
          const jlines: { accountCode: string; debit: number; credit: number; description: string }[] = [
            { accountCode: "4000", debit: invNet, credit: 0, description: "Sales Revenue reversal" },
            { accountCode: "2100", debit: invVat, credit: 0, description: "VAT Payable reversal" },
            { accountCode: "1100", debit: 0, credit: invTotal, description: "Accounts Receivable reversal" },
          ];
          if (totalCost > 0) {
            jlines.push({ accountCode: "1200", debit: totalCost, credit: 0, description: "Inventory restored" });
            jlines.push({ accountCode: "5000", debit: 0, credit: totalCost, description: "COGS reversal" });
          }
          const r = await autoCreateJournalEntry({
            sourceType: "credit_note", sourceId: inv.id, date: invDate,
            description: `Credit Note ${inv.invoiceNumber}`, reference: inv.invoiceNumber, lines: jlines,
          });
          if (r) created++;
        }
      }

      // 4. Repost customer payments
      const allPmts = await storage.getAllPayments();
      for (const pmt of allPmts) {
        const pmtAmount = parseFloat(String(pmt.amount));
        if (pmtAmount <= 0) continue;
        const paymentAcctCode = (pmt as any).paymentMethod === "cash" ? "1000" : "1010";
        const customerName = (pmt as any).customerName ? ` — ${(pmt as any).customerName}` : "";
        const pmtDate = typeof pmt.paymentDate === "string" ? pmt.paymentDate : new Date(pmt.paymentDate).toISOString().split("T")[0];
        const r = await autoCreateJournalEntry({
          sourceType: "payment", sourceId: pmt.id, date: pmtDate,
          description: `Customer Payment received${customerName}`,
          reference: (pmt as any).reference || pmt.id,
          lines: [
            { accountCode: paymentAcctCode, debit: pmtAmount, credit: 0, description: (pmt as any).paymentMethod === "cash" ? "Cash" : "Bank" },
            { accountCode: "1100", debit: 0, credit: pmtAmount, description: "Accounts Receivable" },
          ],
        });
        if (r) created++;
      }

      // 5. Repost supplier payments
      const allSPs = await storage.getSupplierPayments();
      for (const sp of allSPs) {
        const spAmount = parseFloat(String(sp.amount));
        if (spAmount <= 0) continue;
        const paymentAcctCode = (sp as any).paymentMethod === "cash" ? "1000" : "1010";
        const spDate = typeof sp.paymentDate === "string" ? sp.paymentDate : new Date(sp.paymentDate).toISOString().split("T")[0];
        const supplier = await storage.getSupplier(sp.supplierId);
        const r = await autoCreateJournalEntry({
          sourceType: "supplier_payment", sourceId: sp.id, date: spDate,
          description: `Supplier Payment — ${supplier?.name || sp.supplierId}`,
          reference: (sp as any).reference || sp.id,
          lines: [
            { accountCode: "2000", debit: spAmount, credit: 0, description: `Accounts Payable — ${supplier?.name || ""}` },
            { accountCode: paymentAcctCode, debit: 0, credit: spAmount, description: (sp as any).paymentMethod === "cash" ? "Cash" : "Bank" },
          ],
        });
        if (r) created++;
      }

      // 6. Repost expenses
      const allExps = await storage.getExpenses();
      const allAccounts = await storage.getAccounts();
      const vatAccount = allAccounts.find(a => a.code === "2100");
      for (const exp of allExps) {
        const expAmount = parseFloat(String(exp.amount));
        const vatAmt = parseFloat(String((exp as any).vatAmount || "0"));
        const totalWithVat = expAmount + vatAmt;
        const expDate = typeof exp.date === "string" ? exp.date : new Date(exp.date).toISOString().split("T")[0];
        const lines: any[] = [
          { accountId: (exp as any).expenseAccountId, debit: exp.amount, credit: "0", description: exp.description },
        ];
        if (vatAmt > 0 && vatAccount) {
          lines.push({ accountId: vatAccount.id, debit: String(vatAmt), credit: "0", description: "VAT on expense" });
        }
        lines.push({ accountId: (exp as any).paymentAccountId, debit: "0", credit: totalWithVat.toFixed(2), description: exp.description });
        const entryNumber = await storage.getNextJournalEntryNumber();
        const je = await storage.createJournalEntry(
          { entryNumber, date: expDate, description: `Expense: ${exp.description}`, sourceType: "expense", sourceId: exp.id, status: "posted", totalAmount: totalWithVat.toFixed(2) },
          lines
        );
        if (je) {
          created++;
          await db.update(expenses).set({ journalEntryId: je.id }).where(sql`id = ${exp.id}`);
        }
      }

      res.json({ success: true, created, message: `Successfully reposted ${created} journal entries` });
    } catch (e: any) {
      console.error("Repost journals error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/expenses", async (_req, res) => {
    const exp = await storage.getExpenses();
    res.json(exp);
  });

  async function buildExpenseJournalLines(body: any) {
    const totalWithVat = parseFloat(String(body.amount)) + parseFloat(String(body.vatAmount || "0"));
    const lines: any[] = [
      { accountId: body.expenseAccountId, debit: String(body.amount), credit: "0", description: body.description },
    ];
    if (parseFloat(String(body.vatAmount || "0")) > 0) {
      const vatAccounts = await storage.getAccounts();
      const vatAccount = vatAccounts.find((a: any) => a.code === "2100");
      if (vatAccount) {
        lines.push({ accountId: vatAccount.id, debit: String(body.vatAmount), credit: "0", description: "VAT on expense" });
      }
    }
    lines.push({ accountId: body.paymentAccountId, debit: "0", credit: totalWithVat.toFixed(2), description: body.description });
    return { lines, totalWithVat };
  }

  app.post("/api/expenses", async (req, res) => {
    try {
      const expense = await storage.createExpense(req.body);
      const { lines, totalWithVat } = await buildExpenseJournalLines(req.body);
      const entryNumber = await storage.getNextJournalEntryNumber();
      const je = await storage.createJournalEntry(
        { entryNumber, date: req.body.date, description: `Expense: ${req.body.description}`, sourceType: "expense", sourceId: expense.id, status: "posted", totalAmount: totalWithVat.toFixed(2) },
        lines
      );
      await db.update(expenses).set({ journalEntryId: je.id }).where(sql`id = ${expense.id}`);
      res.json(expense);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/expenses/:id", async (req, res) => {
    try {
      const existing = await db.select().from(expenses).where(sql`id = ${req.params.id}`);
      if (!existing.length) return res.status(404).json({ message: "Expense not found" });
      const expense = await storage.updateExpense(req.params.id, req.body);
      if (!expense) return res.status(404).json({ message: "Expense not found" });

      // Regenerate journal entry for this expense
      const body = { ...existing[0], ...req.body };
      const { lines, totalWithVat } = await buildExpenseJournalLines(body);
      const existingJeId = (existing[0] as any).journalEntryId;
      if (existingJeId) {
        await storage.updateJournalEntry(existingJeId,
          { date: body.date, description: `Expense: ${body.description}`, totalAmount: totalWithVat.toFixed(2) },
          lines
        );
      } else {
        const entryNumber = await storage.getNextJournalEntryNumber();
        const je = await storage.createJournalEntry(
          { entryNumber, date: body.date, description: `Expense: ${body.description}`, sourceType: "expense", sourceId: expense.id, status: "posted", totalAmount: totalWithVat.toFixed(2) },
          lines
        );
        await db.update(expenses).set({ journalEntryId: je.id }).where(sql`id = ${expense.id}`);
      }
      res.json(expense);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/expenses/:id", async (req, res) => {
    try {
      const [exp] = await db.select().from(expenses).where(sql`id = ${req.params.id}`);
      if (!exp) return res.status(404).json({ message: "Expense not found" });
      if ((exp as any).journalEntryId) {
        await storage.deleteJournalEntry((exp as any).journalEntryId);
      }
      await db.delete(expenses).where(sql`id = ${req.params.id}`);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/reports/trial-balance", async (_req, res) => {
    const tb = await storage.getTrialBalance();
    res.json(tb);
  });

  app.get("/api/reports/profit-loss/:from/:to", async (req, res) => {
    const pl = await storage.getProfitAndLoss(req.params.from, req.params.to);
    res.json(pl);
  });

  app.get("/api/reports/balance-sheet/:asOf", async (req, res) => {
    const bs = await storage.getBalanceSheet(req.params.asOf);
    res.json(bs);
  });

  app.get("/api/reports/vat-return/:from/:to", async (req, res) => {
    const { from, to } = req.params;
    const [salesInvs, creditNotesList, purchaseInvs, expensesList, allCustomers, allSuppliers] = await Promise.all([
      db.select().from(invoices).where(and(gte(invoices.date, from), lte(invoices.date, to), eq(invoices.type, "invoice"), sql`${invoices.status} != 'draft'`)),
      db.select().from(invoices).where(and(gte(invoices.date, from), lte(invoices.date, to), eq(invoices.type, "credit_note"), sql`${invoices.status} != 'draft'`)),
      db.select().from(purchaseInvoices).where(and(gte(purchaseInvoices.date, from), lte(purchaseInvoices.date, to), sql`${purchaseInvoices.status} != 'draft'`)),
      db.select().from(expenses).where(and(gte(expenses.date, from), lte(expenses.date, to))),
      db.select({ id: customers.id, name: customers.name }).from(customers),
      db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers),
    ]);

    const custMap: Record<string, string> = {};
    allCustomers.forEach(c => { custMap[c.id] = c.name; });
    const suppMap: Record<string, string> = {};
    allSuppliers.forEach(s => { suppMap[s.id] = s.name; });

    const salesVat = salesInvs.reduce((s, i) => s + parseFloat(i.taxAmount || "0"), 0);
    const salesNet = salesInvs.reduce((s, i) => s + parseFloat(i.subtotal || "0"), 0);
    const salesGross = salesInvs.reduce((s, i) => s + parseFloat(i.total || "0"), 0);

    const cnVat = creditNotesList.reduce((s, i) => s + parseFloat(i.taxAmount || "0"), 0);
    const cnNet = creditNotesList.reduce((s, i) => s + parseFloat(i.subtotal || "0"), 0);

    const purchaseVat = purchaseInvs.reduce((s, i) => s + parseFloat(i.vatAmount || "0"), 0);
    const purchaseNet = purchaseInvs.reduce((s, i) => s + parseFloat(i.subtotal || "0"), 0);

    const expenseVat = expensesList.reduce((s, i) => s + parseFloat(i.vatAmount || "0"), 0);
    const expenseNet = expensesList.reduce((s, i) => s + parseFloat(i.amount || "0"), 0);

    const outputVat = salesVat - cnVat;
    const outputNet = salesNet - cnNet;
    const inputVat = purchaseVat + expenseVat;
    const inputNet = purchaseNet + expenseNet;
    const netVatPayable = outputVat - inputVat;

    res.json({
      period: { from, to },
      sales: {
        count: salesInvs.length,
        netAmount: salesNet.toFixed(2),
        vatAmount: salesVat.toFixed(2),
        grossAmount: salesGross.toFixed(2),
        items: salesInvs.sort((a, b) => a.date.localeCompare(b.date)).map(i => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          customerName: custMap[i.customerId || ""] || "—",
          date: i.date,
          netAmount: parseFloat(i.subtotal || "0").toFixed(2),
          vatAmount: parseFloat(i.taxAmount || "0").toFixed(2),
          grossAmount: parseFloat(i.total || "0").toFixed(2),
        })),
      },
      creditNotes: {
        count: creditNotesList.length,
        netAmount: cnNet.toFixed(2),
        vatAmount: cnVat.toFixed(2),
        items: creditNotesList.sort((a, b) => a.date.localeCompare(b.date)).map(i => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          customerName: custMap[i.customerId || ""] || "—",
          date: i.date,
          netAmount: parseFloat(i.subtotal || "0").toFixed(2),
          vatAmount: parseFloat(i.taxAmount || "0").toFixed(2),
          grossAmount: parseFloat(i.total || "0").toFixed(2),
        })),
      },
      purchases: {
        count: purchaseInvs.length,
        netAmount: purchaseNet.toFixed(2),
        vatAmount: purchaseVat.toFixed(2),
        items: purchaseInvs.sort((a, b) => a.date.localeCompare(b.date)).map(i => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          supplierRef: i.supplierInvoiceRef || "—",
          supplierName: suppMap[i.supplierId || ""] || "—",
          date: i.date,
          netAmount: parseFloat(i.subtotal || "0").toFixed(2),
          vatAmount: parseFloat(i.vatAmount || "0").toFixed(2),
          grossAmount: parseFloat(i.total || "0").toFixed(2),
        })),
      },
      expenses: {
        count: expensesList.length,
        netAmount: expenseNet.toFixed(2),
        vatAmount: expenseVat.toFixed(2),
        items: expensesList.sort((a, b) => a.date.localeCompare(b.date)).map(i => ({
          id: i.id,
          description: i.description,
          date: i.date,
          netAmount: parseFloat(i.amount || "0").toFixed(2),
          vatAmount: parseFloat(i.vatAmount || "0").toFixed(2),
          grossAmount: (parseFloat(i.amount || "0") + parseFloat(i.vatAmount || "0")).toFixed(2),
        })),
      },
      outputVat: outputVat.toFixed(2),
      outputNet: outputNet.toFixed(2),
      inputVat: inputVat.toFixed(2),
      inputNet: inputNet.toFixed(2),
      netVatPayable: netVatPayable.toFixed(2),
    });
  });

  app.get("/api/reports/general-ledger/:accountId/:from/:to", async (req, res) => {
    const gl = await storage.getGeneralLedger(req.params.accountId, req.params.from, req.params.to);
    res.json(gl);
  });

  return httpServer;
}

function generateInvoiceHtml(inv: any, customer: any, typeLabel: string, autoPrint: boolean = false, settings: Record<string, string> = {}) {
  const items = inv.items || [];
  const hasDiscountPercent = items.some((li: any) => parseFloat(li.discountPercent || "0") > 0);
  const hasDiscount = items.some((li: any) => parseFloat(li.discount || "0") > 0);
  const hasBarcodes = items.some((li: any) => li.barcode);
  const overallDiscount = parseFloat(inv.discountAmount || "0");

  const companyName = settings.company_name || "FC GASTRONOBILE LTD";
  const companyAddress = settings.company_address || "";
  const companyPhone = settings.company_phone || "";
  const companyEmail = settings.company_email || "";
  const companyTaxId = settings.company_tax_id || "";
  const companyRegNo = settings.company_reg_no || "";
  const companyIban = settings.company_iban || "";
  const companySwift = settings.company_swift || "";
  const companyBankName = settings.company_bank_name || "";
  const currencySymbol = settings.currency_symbol || "\u20AC";
  const invoiceFooter = settings.invoice_footer || "Thank you for your business";

  const unitDisplayLabels: Record<string, string> = { pc: "pc", bottle: "btl", pack: "pk", "6-pack": "6pk", "12-pack": "12pk" };

  const itemRows = items.map((li: any, idx: number) => {
    const qty = li.quantity != null && Number(li.quantity) > 0 ? Number(li.quantity) : (li.quantity != null ? li.quantity : "—");
    const unit = li.saleUnit || "pc";
    const unitLabel = unitDisplayLabels[unit] || unit;
    const discPercent = parseFloat(li.discountPercent || "0");
    const discAmount = parseFloat(li.discount || "0");

    return `
    <tr class="${idx % 2 === 1 ? 'alt-row' : ''}">
      <td class="cell">${li.description || ""}</td>
      ${hasBarcodes ? `<td class="cell barcode-cell">${li.barcode || "-"}</td>` : ""}
      <td class="cell center">${qty} ${unitLabel}</td>
      <td class="cell right">${currencySymbol}${parseFloat(li.unitPrice).toFixed(2)}</td>
      ${hasDiscountPercent ? `<td class="cell right">${discPercent > 0 ? discPercent.toFixed(1) + "%" : "-"}</td>` : ""}
      ${hasDiscount ? `<td class="cell right">${discAmount > 0 ? currencySymbol + discAmount.toFixed(2) : "-"}</td>` : ""}
      <td class="cell right bold">${currencySymbol}${parseFloat(li.total).toFixed(2)}</td>
    </tr>`;
  }).join("");

  const hasBankDetails = companyIban || companySwift || companyBankName;

  const printScript = autoPrint ? `<script>window.onload = function() { window.print(); }</script>` : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${typeLabel} - ${inv.invoiceNumber}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; padding: 0; background: #f5f5f5; }
  .page { max-width: 800px; margin: 0 auto; background: #fff; padding: 48px; min-height: 100vh; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; padding-bottom: 24px; border-bottom: 3px solid #1a1a1a; }
  .brand { }
  .brand-top { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
  .brand-logo { height: 48px; width: auto; object-fit: contain; }
  .brand-name { font-size: 22px; font-weight: 800; color: #1a1a1a; letter-spacing: -0.5px; }
  .brand-sub { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 2px; margin-top: 2px; }
  .brand-detail { font-size: 11px; color: #666; line-height: 1.6; margin-top: 4px; }
  .doc-info { text-align: right; }
  .doc-type { font-size: 22px; font-weight: 700; color: #333; text-transform: uppercase; letter-spacing: 1px; }
  .doc-number { font-size: 14px; color: #666; margin-top: 4px; }
  .parties { display: flex; justify-content: space-between; gap: 40px; margin-bottom: 32px; }
  .party { flex: 1; }
  .party-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #999; font-weight: 600; margin-bottom: 8px; }
  .party-name { font-size: 15px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
  .party-detail { font-size: 12px; color: #555; line-height: 1.6; }
  .meta-row { display: flex; gap: 24px; margin-bottom: 28px; padding: 14px 18px; background: #f5f5f5; border-radius: 6px; border: 1px solid #f0ebe6; }
  .meta-item { flex: 1; }
  .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; font-weight: 600; }
  .meta-value { font-size: 13px; font-weight: 600; color: #333; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th { background: #1a1a1a; color: #fff; padding: 10px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; text-align: left; }
  thead th.center { text-align: center; }
  thead th.right { text-align: right; }
  .cell { padding: 10px 12px; font-size: 12px; border-bottom: 1px solid #f0f0f0; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 600; }
  .alt-row { background: #fdfcfb; }
  .barcode-cell { font-family: 'Courier New', Courier, monospace; font-size: 11px; letter-spacing: 0.5px; color: #555; }
  .totals-section { display: flex; justify-content: flex-end; margin-bottom: 28px; }
  .totals-box { width: 280px; }
  .totals-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 13px; }
  .totals-row.subtotal { color: #555; }
  .totals-row.tax { color: #555; }
  .totals-row.grand { font-size: 18px; font-weight: 800; color: #1a1a1a; padding-top: 12px; margin-top: 4px; border-top: 2px solid #1a1a1a; }
  .notes-box { padding: 16px 20px; background: #f5f5f5; border-radius: 6px; border-left: 3px solid #1a1a1a; margin-bottom: 32px; }
  .notes-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; font-weight: 600; margin-bottom: 4px; }
  .notes-text { font-size: 12px; color: #444; line-height: 1.6; }
  .bank-details { padding: 16px 20px; background: #f8f9fa; border-radius: 6px; border: 1px solid #e9ecef; margin-bottom: 32px; }
  .bank-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #999; font-weight: 600; margin-bottom: 6px; }
  .bank-text { font-size: 12px; color: #444; line-height: 1.8; }
  .footer { text-align: center; padding-top: 24px; border-top: 1px solid #eee; }
  .footer p { font-size: 11px; color: #aaa; line-height: 1.8; }
  .no-print { text-align: center; margin-bottom: 16px; padding: 12px; }
  .no-print button { padding: 10px 28px; font-size: 14px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; margin: 0 6px; }
  .btn-print { background: #1a1a1a; color: #fff; }
  .btn-print:hover { background: #5a2530; }
  .btn-close { background: #e5e5e5; color: #333; }
  .btn-close:hover { background: #d5d5d5; }
  @page { margin: 0; size: A4; }
  @media print {
    body { background: #fff; padding: 0; margin: 10mm 15mm; }
    .page { padding: 0; max-width: 100%; box-shadow: none; min-height: auto !important; }
    .no-print { display: none !important; }
    .header { border-bottom-color: #1a1a1a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin-bottom: 20px !important; padding-bottom: 16px !important; }
    .parties { margin-bottom: 20px !important; }
    .meta-row { margin-bottom: 16px !important; background: #f5f5f5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th { background: #1a1a1a !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .totals-row.grand { color: #1a1a1a !important; border-top-color: #1a1a1a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .totals-section { margin-bottom: 16px !important; }
    .notes-box { margin-bottom: 16px !important; }
    .bank-details { margin-bottom: 16px !important; }
    .footer { padding-top: 12px !important; }
    .alt-row { background: #fdfcfb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="no-print">
    <button class="btn-print" onclick="window.print()">Print Document</button>
    <button class="btn-close" onclick="window.close()">Close</button>
  </div>
  <div class="page">
    <div class="header">
      <div class="brand">
        <div class="brand-top">
          <img src="/logo.png" alt="Logo" class="brand-logo" />
          <div class="brand-name">${companyName}</div>
        </div>
        <div class="brand-detail">
          ${companyAddress ? companyAddress + "<br>" : ""}
          ${companyPhone ? "Tel: " + companyPhone : ""}${companyEmail ? " | " + companyEmail : ""}
          ${companyTaxId ? "<br>TIN: " + companyTaxId : ""}${companyRegNo ? " | Reg: " + companyRegNo : ""}
        </div>
      </div>
      <div class="doc-info">
        <div class="doc-type">${typeLabel}</div>
        <div class="doc-number">${inv.invoiceNumber}</div>
      </div>
    </div>

    <div class="parties">
      <div class="party">
        <div class="party-label">Bill To</div>
        <div class="party-name">${customer?.name || "N/A"}</div>
        <div class="party-detail">
          ${(inv as any).deliveryLocation ? `<strong>${(inv as any).deliveryLocation}</strong><br>` : (customer as any)?.location ? `<strong>${(customer as any).location}</strong><br>` : ""}
          ${customer?.address ? customer.address + "<br>" : ""}
          ${customer?.city || ""}
          ${customer?.taxId ? "<br>Tax ID: " + customer.taxId : ""}
        </div>
      </div>
      <div class="party" style="text-align:right;">
        <div class="party-label">Document Details</div>
        <div class="party-detail">
          <strong>Date:</strong> ${new Date(inv.date).toLocaleDateString("en-GB")}<br>
          ${inv.dueDate ? "<strong>Due:</strong> " + new Date(inv.dueDate).toLocaleDateString("en-GB") + "<br>" : ""}
          <strong>Status:</strong> ${inv.status}<br>
          <strong>Terms:</strong> ${customer?.paymentTerms || "cash"}
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          ${hasBarcodes ? '<th>Barcode</th>' : ""}
          <th class="center">Qty</th>
          <th class="right">Unit Price</th>
          ${hasDiscountPercent ? '<th class="right">Disc %</th>' : ""}
          ${hasDiscount ? '<th class="right">Discount</th>' : ""}
          <th class="right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <div class="totals-section">
      <div class="totals-box">
        ${overallDiscount > 0 ? `
        <div class="totals-row subtotal">
          <span>Lines Subtotal</span>
          <span>${currencySymbol}${(parseFloat(inv.subtotal) + overallDiscount).toFixed(2)}</span>
        </div>
        <div class="totals-row discount">
          <span>Discount</span>
          <span style="color:#c0392b;">-${currencySymbol}${overallDiscount.toFixed(2)}</span>
        </div>
        ` : ""}
        <div class="totals-row subtotal">
          <span>Subtotal</span>
          <span>${currencySymbol}${parseFloat(inv.subtotal).toFixed(2)}</span>
        </div>
        <div class="totals-row tax">
          <span>VAT (${inv.taxRate}%)</span>
          <span>${currencySymbol}${parseFloat(inv.taxAmount).toFixed(2)}</span>
        </div>
        <div class="totals-row grand">
          <span>Total</span>
          <span>${currencySymbol}${parseFloat(inv.total).toFixed(2)}</span>
        </div>
      </div>
    </div>

    ${inv.notes ? `
    <div class="notes-box">
      <div class="notes-label">Notes</div>
      <div class="notes-text">${inv.notes}</div>
    </div>` : ""}

    ${hasBankDetails ? `
    <div class="bank-details">
      <div class="bank-label">Bank Details</div>
      <div class="bank-text">
        ${companyBankName ? "<strong>Bank:</strong> " + companyBankName + "<br>" : ""}
        ${companyIban ? "<strong>IBAN:</strong> " + companyIban + "<br>" : ""}
        ${companySwift ? "<strong>SWIFT/BIC:</strong> " + companySwift : ""}
      </div>
    </div>` : ""}

    <div class="footer">
      <p>${companyName} - Wholesale Wine & Spirits</p>
      <p>${invoiceFooter}</p>
    </div>
  </div>
  ${printScript}
</body>
</html>`;
}

function generateStatementHtml(customer: any, statement: any, autoPrint: boolean = false, settings: Record<string, string> = {}) {
  const companyName = settings.company_name || "FC GASTRONOBILE LTD";
  const companyAddress = settings.company_address || "";
  const companyPhone = settings.company_phone || "";
  const companyEmail = settings.company_email || "";
  const companyRegNo = settings.company_reg_no || "";
  const companyTaxId = settings.company_tax_id || "";
  const companyIban = settings.company_iban || "";
  const companyBankName = settings.company_bank_name || "";
  const companySwift = settings.company_swift || "";
  const currencySymbol = settings.currency_symbol || "\u20AC";
  const fmt = (v: number | string) => `${currencySymbol}${parseFloat(String(v) || "0").toFixed(2)}`;

  const paymentTermsLabel: Record<string, string> = {
    cash: "Cash on Delivery", credit_7: "Net 7 Days", credit_14: "Net 14 Days",
    credit_30: "Net 30 Days", credit_60: "Net 60 Days", credit_90: "Net 90 Days",
  };
  const methodLabels: Record<string, string> = {
    cash: "Cash", bank_transfer: "Bank Transfer", cheque: "Cheque", card: "Card", other: "Other",
  };
  const typeLabels: Record<string, string> = {
    invoice: "Invoice", credit_note: "Credit Note", proforma: "Proforma", quotation: "Quotation",
  };

  const statementInvoices: any[] = statement?.invoices || [];
  const statementPayments: any[] = statement?.payments || [];
  const stmtDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const balanceDue = parseFloat(statement?.balance || "0");
  const balanceAsOfPrevMonthEnd = parseFloat(statement?.balanceAsOfPrevMonthEnd ?? statement?.balance ?? "0");
  const prevMonthEndLabel: string = statement?.prevMonthEndLabel || stmtDate;
  const ag = statement?.aging || {};

  // Build a single chronological activity list (invoices + payments merged, sorted by date)
  type Activity = { date: Date; dateStr: string; type: "invoice" | "payment"; ref: string; description: string; dueDate: string; amount: number; isCredit: boolean; };
  const activities: Activity[] = [];

  for (const inv of statementInvoices) {
    const d = inv.date ? new Date(inv.date) : new Date();
    const dueStr = inv.effectiveDueDate
      ? new Date(inv.effectiveDueDate).toLocaleDateString("en-GB")
      : inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-GB") : "—";
    activities.push({
      date: d,
      dateStr: d.toLocaleDateString("en-GB"),
      type: "invoice",
      ref: inv.invoiceNumber || "—",
      description: typeLabels[inv.type] || inv.type,
      dueDate: dueStr,
      amount: parseFloat(inv.total || "0"),
      isCredit: inv.type === "credit_note",
    });
  }
  for (const pmt of statementPayments) {
    const d = pmt.date ? new Date(pmt.date) : new Date();
    const method = methodLabels[pmt.paymentMethod] || pmt.paymentMethod || "Other";
    const ref = [pmt.reference, pmt.invoiceNumber].filter(Boolean).join(" / ") || "—";
    activities.push({
      date: d,
      dateStr: d.toLocaleDateString("en-GB"),
      type: "payment",
      ref,
      description: `Payment Received (${method})`,
      dueDate: "—",
      amount: parseFloat(pmt.amount || "0"),
      isCredit: false,
    });
  }
  activities.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Running balance
  let runningBalance = 0;
  const activityRows = activities.map((a, idx) => {
    if (a.type === "payment") {
      runningBalance -= a.amount;
    } else if (a.isCredit) {
      runningBalance -= a.amount;
    } else {
      runningBalance += a.amount;
    }
    const isPayment = a.type === "payment" || a.isCredit;
    const bg = idx % 2 === 1 ? "background:#f9f9f9;" : "";
    return `<tr style="${bg}">
      <td style="padding:8px 10px;font-size:11px;color:#555;white-space:nowrap;">${a.dateStr}</td>
      <td style="padding:8px 10px;font-size:11px;font-weight:600;color:#1a1a1a;">${a.ref}</td>
      <td style="padding:8px 10px;font-size:11px;color:#555;">${a.description}</td>
      <td style="padding:8px 10px;font-size:11px;color:#555;text-align:center;white-space:nowrap;">${a.dueDate}</td>
      <td style="padding:8px 10px;font-size:11px;text-align:right;font-weight:600;color:${isPayment ? "#2e7d32" : "#1a1a1a"};">${isPayment ? `(${fmt(a.amount)})` : fmt(a.amount)}</td>
      <td style="padding:8px 10px;font-size:12px;text-align:right;font-weight:700;color:${runningBalance > 0 ? "#1a1a1a" : "#2e7d32"};">${fmt(Math.abs(runningBalance))}${runningBalance < 0 ? "&nbsp;CR" : ""}</td>
    </tr>`;
  }).join("");

  // Aging grid columns: Current | 1-30 | 31-60 | 61-90 | >90 | Amount Due
  const agCurrent = parseFloat(ag.withinTermsFuture || "0") + parseFloat(ag.dueThisMonth || "0");
  const ag1_30 = parseFloat(ag.overdue1_30 || "0");
  const ag31_60 = parseFloat(ag.overdue31_60 || "0");
  const ag60plus = parseFloat(ag.overdue60plus || "0");
  // Split 60+ into 61-90 and >90 (we only have combined; show as one column for now)
  const agingCols = [
    { label: "Current", value: agCurrent },
    { label: "1-30 Days\nPast Due", value: ag1_30 },
    { label: "31-60 Days\nPast Due", value: ag31_60 },
    { label: "Over 60 Days\nPast Due", value: ag60plus },
    { label: "Amount Due", value: balanceAsOfPrevMonthEnd, highlight: true },
  ];
  const agingCells = agingCols.map(col => `
    <td style="padding:10px 8px;text-align:center;border-right:1px solid #ddd;${col.highlight ? "background:#1a1a1a;" : ""}">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:${col.highlight ? "#aaa" : "#888"};font-weight:600;margin-bottom:4px;white-space:pre-line;">${col.label}</div>
      <div style="font-size:13px;font-weight:800;color:${col.highlight ? "#fff" : col.value > 0 ? "#1a1a1a" : "#999"};">${col.value > 0 ? fmt(col.value) : "—"}</div>
    </td>`).join("");

  const printScript = autoPrint ? `<script>window.onload = function() { window.print(); }</script>` : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Statement - ${customer.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; background: #e8e8e8; }
  .page { max-width: 820px; margin: 0 auto; background: #fff; padding: 36px 40px; min-height: 100vh; }
  .no-print { text-align:center; padding:12px; background:#fff; border-bottom:1px solid #ddd; }
  .no-print button { padding:8px 24px; font-size:13px; font-weight:600; border:none; border-radius:5px; cursor:pointer; margin:0 5px; }
  .btn-print { background:#1a1a1a; color:#fff; }
  .btn-close { background:#e0e0e0; color:#333; }
  @page { size: A4; margin: 0; }
  @media print {
    body { background:#fff; }
    .no-print { display:none !important; }
    .page { padding:14mm 12mm; max-width:100%; }
    .aging-highlight { background:#1a1a1a !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    thead tr { background:#1a1a1a !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
</style>
</head>
<body>
<div class="no-print">
  <button class="btn-print" onclick="window.print()">&#128438; Print Statement</button>
  <button class="btn-close" onclick="window.close()">Close</button>
</div>
<div class="page">

  <!-- TOP HEADER -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <tr>
      <td style="width:55%;vertical-align:top;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
          <img src="/logo.png" alt="" style="height:44px;width:auto;object-fit:contain;" />
          <div>
            <div style="font-size:18px;font-weight:800;color:#1a1a1a;line-height:1.1;">${companyName}</div>
            ${companyRegNo ? `<div style="font-size:10px;color:#888;margin-top:2px;">Reg. No: ${companyRegNo}</div>` : ""}
          </div>
        </div>
        <div style="font-size:10px;color:#555;line-height:1.7;">
          ${companyAddress ? `${companyAddress.replace(/\n/g,"<br>")}<br>` : ""}
          ${companyPhone ? `Tel: ${companyPhone}` : ""}${companyPhone && companyEmail ? " &nbsp;|&nbsp; " : ""}${companyEmail ? companyEmail : ""}
          ${companyTaxId ? `<br>VAT/Tax ID: ${companyTaxId}` : ""}
        </div>
      </td>
      <td style="width:45%;vertical-align:top;text-align:right;">
        <div style="font-size:26px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#1a1a1a;line-height:1;">Statement</div>
        <div style="font-size:11px;color:#666;margin-top:6px;">Date: <strong>${stmtDate}</strong></div>
        <div style="font-size:11px;color:#666;margin-top:2px;">Account No: <strong>${customer.code}</strong></div>
        <div style="font-size:11px;color:#666;margin-top:2px;">Terms: <strong>${paymentTermsLabel[customer.paymentTerms] || customer.paymentTerms}</strong></div>
      </td>
    </tr>
  </table>

  <!-- BILL TO + AMOUNT DUE -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <tr>
      <td style="width:55%;vertical-align:top;padding:16px 20px;background:#f7f7f7;border:1px solid #ddd;border-radius:4px;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#999;font-weight:700;margin-bottom:6px;">Bill To</div>
        <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:3px;">${customer.name}</div>
        ${customer.address ? `<div style="font-size:11px;color:#555;line-height:1.6;">${customer.address.replace(/\n/g,"<br>")}</div>` : ""}
        ${customer.city ? `<div style="font-size:11px;color:#555;">${customer.city}</div>` : ""}
        ${customer.taxId ? `<div style="font-size:11px;color:#777;margin-top:3px;">Tax ID: ${customer.taxId}</div>` : ""}
      </td>
      <td style="width:10%;"></td>
      <td style="width:35%;vertical-align:top;text-align:center;padding:16px 20px;background:#1a1a1a;border-radius:4px;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#aaa;font-weight:700;margin-bottom:8px;">Amount Due</div>
        <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px;">${fmt(balanceAsOfPrevMonthEnd)}</div>
        <div style="font-size:9px;color:#888;margin-top:8px;text-transform:uppercase;letter-spacing:0.5px;">As of ${prevMonthEndLabel}</div>
      </td>
    </tr>
  </table>

  <!-- ACTIVITY TABLE -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:0;">
    <thead>
      <tr style="background:#1a1a1a;">
        <th style="padding:9px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;color:#fff;text-align:left;">Date</th>
        <th style="padding:9px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;color:#fff;text-align:left;">Reference</th>
        <th style="padding:9px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;color:#fff;text-align:left;">Description</th>
        <th style="padding:9px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;color:#fff;text-align:center;">Due Date</th>
        <th style="padding:9px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;color:#fff;text-align:right;">Amount</th>
        <th style="padding:9px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;color:#fff;text-align:right;">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${activityRows || `<tr><td colspan="6" style="padding:16px;text-align:center;color:#999;font-size:12px;">No activity</td></tr>`}
      <!-- Total row -->
      <tr style="border-top:2px solid #1a1a1a;">
        <td colspan="4" style="padding:10px;font-size:11px;font-weight:700;text-align:right;text-transform:uppercase;letter-spacing:0.5px;color:#555;">Total Balance Due</td>
        <td colspan="2" style="padding:10px;font-size:14px;font-weight:900;text-align:right;color:#1a1a1a;">${fmt(balanceDue)}</td>
      </tr>
    </tbody>
  </table>

  <!-- AGING GRID -->
  <table style="width:100%;border-collapse:collapse;border:1px solid #ddd;margin-top:24px;">
    <thead>
      <tr style="background:#f0f0f0;">
        <th colspan="5" style="padding:7px 10px;font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:700;color:#555;text-align:left;border-bottom:1px solid #ddd;">Aging Summary</th>
      </tr>
    </thead>
    <tbody>
      <tr>${agingCells}</tr>
    </tbody>
  </table>

  ${companyIban ? `
  <!-- REMIT TO -->
  <table style="width:100%;border-collapse:collapse;margin-top:24px;">
    <tr>
      <td style="padding:16px 20px;background:#f7f7f7;border:1px solid #ddd;border-radius:4px;vertical-align:top;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#999;font-weight:700;margin-bottom:8px;">Remit To / Payment Details</div>
        <table style="border-collapse:collapse;width:100%;">
          ${companyBankName ? `<tr><td style="font-size:10px;color:#888;padding:2px 0;width:100px;">Bank</td><td style="font-size:11px;font-weight:600;color:#1a1a1a;padding:2px 0;">${companyBankName}</td></tr>` : ""}
          <tr><td style="font-size:10px;color:#888;padding:2px 0;">IBAN</td><td style="font-size:11px;font-weight:700;color:#1a1a1a;padding:2px 0;letter-spacing:0.5px;">${companyIban}</td></tr>
          ${companySwift ? `<tr><td style="font-size:10px;color:#888;padding:2px 0;">SWIFT/BIC</td><td style="font-size:11px;font-weight:600;color:#1a1a1a;padding:2px 0;">${companySwift}</td></tr>` : ""}
          <tr><td style="font-size:10px;color:#888;padding:2px 0;">Reference</td><td style="font-size:11px;color:#555;padding:2px 0;">Please quote: <strong>${customer.code}</strong></td></tr>
        </table>
      </td>
    </tr>
  </table>` : ""}

  <!-- FOOTER -->
  <div style="margin-top:28px;padding-top:16px;border-top:1px solid #eee;text-align:center;">
    <p style="font-size:10px;color:#aaa;">${companyName} &mdash; Thank you for your business</p>
  </div>

</div>
${printScript}
</body>
</html>`;
}
