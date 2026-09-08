import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes, generateBackupJson } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { sendBackupEmail } from "./email";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import { db } from "./db";
import { sql } from "drizzle-orm";

const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(cookieParser());

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // The customer PWA uses the same-origin camera for in-store barcode scanning.
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  const isProd = process.env.NODE_ENV === "production";
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
  ];
  if (isProd) {
    cspDirectives.push("frame-ancestors 'none'");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.setHeader("Content-Security-Policy", cspDirectives.join("; "));
  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api/public/")) return next();
  return requireAuth(req, res, next);
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

const SENSITIVE_LOG_KEY = /(?:password|secret|token|credential|api[_-]?key|authorization|cookie)/i;
const SENSITIVE_RESPONSE_PATHS = new Set([
  "/api/customer/preferences",
  "/api/customer/feedback",
  "/api/customer-feedback",
]);

function redactResponseForLog(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(item => redactResponseForLog(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_LOG_KEY.test(key) ? "[REDACTED]" : redactResponseForLog(item, depth + 1),
    ]),
  );
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && !SENSITIVE_RESPONSE_PATHS.has(path)) {
        logLine += ` :: ${JSON.stringify(redactResponseForLog(capturedJsonResponse))}`;
      } else if (capturedJsonResponse && SENSITIVE_RESPONSE_PATHS.has(path)) {
        logLine += " :: [personal response omitted]";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // This migration must run before seeding because Drizzle selects the full users
  // row shape while ensuring the default administrator exists.
  try {
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS whatsapp_quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS whatsapp_quiet_hours_start INTEGER NOT NULL DEFAULT 22,
        ADD COLUMN IF NOT EXISTS whatsapp_quiet_hours_end INTEGER NOT NULL DEFAULT 8,
        ADD COLUMN IF NOT EXISTS whatsapp_quiet_hours_timezone TEXT NOT NULL DEFAULT 'Europe/Nicosia',
        ADD COLUMN IF NOT EXISTS whatsapp_quiet_hours_migrated BOOLEAN NOT NULL DEFAULT FALSE;
    `);
  } catch (e) {
    console.error("[migration] users WhatsApp quiet-hours columns error:", e);
  }

  // Keep customer PWA features available on installations where file migrations
  // have not yet been applied.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS customer_preferences (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id VARCHAR NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
        dietary_preferences TEXT[] NOT NULL DEFAULT '{}',
        disliked_ingredients TEXT[] NOT NULL DEFAULT '{}',
        preferred_categories TEXT[] NOT NULL DEFAULT '{}',
        recommendation_goals TEXT[] NOT NULL DEFAULT '{}',
        budget_preference TEXT,
        notification_recommendations BOOLEAN NOT NULL DEFAULT TRUE,
        notification_order_updates BOOLEAN NOT NULL DEFAULT TRUE,
        notification_offers BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE customer_preferences
        ADD COLUMN IF NOT EXISTS notification_recommendations BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notification_order_updates BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notification_offers BOOLEAN NOT NULL DEFAULT TRUE;
      CREATE TABLE IF NOT EXISTS customer_feedback (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id VARCHAR NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        order_id VARCHAR REFERENCES portal_orders(id) ON DELETE SET NULL,
        context TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment TEXT,
        sentiment TEXT NOT NULL,
        sentiment_score NUMERIC(3,2) NOT NULL CHECK (sentiment_score BETWEEN -1 AND 1),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS customer_notifications (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id VARCHAR NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        type TEXT NOT NULL,
        action_url TEXT,
        read_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS customer_feedback_customer_created_idx ON customer_feedback(customer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS customer_notifications_customer_created_idx ON customer_notifications(customer_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS customer_ai_health (
        scope TEXT PRIMARY KEY DEFAULT 'global',
        fallback_count INTEGER NOT NULL DEFAULT 0,
        recommendation_fallback_count INTEGER NOT NULL DEFAULT 0,
        feedback_fallback_count INTEGER NOT NULL DEFAULT 0,
        consecutive_fallback_count INTEGER NOT NULL DEFAULT 0,
        failure_revision INTEGER NOT NULL DEFAULT 0,
        last_failure_category TEXT,
        last_failure_at TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT customer_ai_health_scope_check CHECK (scope = 'global'),
        CONSTRAINT customer_ai_health_category_check CHECK (
          last_failure_category IS NULL OR last_failure_category IN
            ('configuration', 'authentication', 'rate_limit', 'timeout', 'model', 'invalid_response', 'provider')
        ),
        CONSTRAINT customer_ai_health_counts_check CHECK (
          fallback_count >= 0 AND recommendation_fallback_count >= 0
          AND feedback_fallback_count >= 0 AND consecutive_fallback_count >= 0
          AND failure_revision >= 0
        )
      );
      ALTER TABLE customer_ai_health
        ADD COLUMN IF NOT EXISTS failure_revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE customer_ai_health
        ALTER COLUMN scope SET DEFAULT 'global';
      INSERT INTO customer_ai_health (
        scope, fallback_count, recommendation_fallback_count,
        feedback_fallback_count, consecutive_fallback_count, failure_revision,
        last_failure_category, last_failure_at, updated_at
      )
      SELECT
        'global', fallback_count, recommendation_fallback_count,
        feedback_fallback_count, consecutive_fallback_count, failure_revision,
        last_failure_category, last_failure_at, updated_at
      FROM customer_ai_health
      WHERE scope = 'local'
      ON CONFLICT (scope) DO UPDATE SET
        fallback_count = LEAST(2147483647::bigint, customer_ai_health.fallback_count::bigint + EXCLUDED.fallback_count)::integer,
        recommendation_fallback_count = LEAST(2147483647::bigint, customer_ai_health.recommendation_fallback_count::bigint + EXCLUDED.recommendation_fallback_count)::integer,
        feedback_fallback_count = LEAST(2147483647::bigint, customer_ai_health.feedback_fallback_count::bigint + EXCLUDED.feedback_fallback_count)::integer,
        consecutive_fallback_count = LEAST(2147483647::bigint, customer_ai_health.consecutive_fallback_count::bigint + EXCLUDED.consecutive_fallback_count)::integer,
        failure_revision = LEAST(2147483647::bigint, customer_ai_health.failure_revision::bigint + EXCLUDED.failure_revision)::integer,
        last_failure_category = CASE
          WHEN customer_ai_health.last_failure_at IS NULL OR EXCLUDED.last_failure_at >= customer_ai_health.last_failure_at
          THEN EXCLUDED.last_failure_category
          ELSE customer_ai_health.last_failure_category
        END,
        last_failure_at = GREATEST(customer_ai_health.last_failure_at, EXCLUDED.last_failure_at),
        updated_at = GREATEST(customer_ai_health.updated_at, EXCLUDED.updated_at);
      DELETE FROM customer_ai_health WHERE scope = 'local';
    `);
  } catch (e) {
    console.error("[migration] customer PWA tables error:", e);
    throw e;
  }

  const { seedDatabase, ensureDefaultSettings } = await import("./seed");
  await seedDatabase().catch(e => console.error("Seed error:", e));
  await ensureDefaultSettings().catch(e => console.error("Settings init error:", e));
  const { initializeCustomerAiRuntimeHealth } = await import("./customer-ai-service");
  await initializeCustomerAiRuntimeHealth();

  // Schema migration: add opening_balance column if it doesn't exist
  try {
    await db.execute(sql`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0;
    `);
  } catch (e) {
    console.error("[migration] opening_balance column error:", e);
  }

  // Schema migration: add source column to portal_orders for WhatsApp vs portal distinction
  try {
    await db.execute(sql`
      ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'portal';
    `);
  } catch (e) {
    console.error("[migration] portal_orders.source column error:", e);
  }

  // Schema migration: add invoice_id column to portal_orders for order→invoice cross-reference
  try {
    await db.execute(sql`
      ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS invoice_id VARCHAR;
    `);
  } catch (e) {
    console.error("[migration] portal_orders.invoice_id column error:", e);
  }

  // Schema migration: create staff_push_subscriptions table if it doesn't exist
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS staff_push_subscriptions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
  } catch (e) {
    console.error("[migration] staff_push_subscriptions table error:", e);
  }

  // Schema migration: create wa_cart_state table if it doesn't exist (WhatsApp cart/pending-item persistence)
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS wa_cart_state (
        conversation_id VARCHAR PRIMARY KEY,
        cart JSONB NOT NULL DEFAULT '[]',
        pending_item JSONB,
        pending_expires_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
  } catch (e) {
    console.error("[migration] wa_cart_state table error:", e);
  }

  // Schema migration: create pos_audit_logs table if it doesn't exist (terminal audit log sync)
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pos_audit_logs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        terminal_id VARCHAR NOT NULL,
        local_id INTEGER NOT NULL,
        cashier_id TEXT,
        cashier_name TEXT,
        action TEXT NOT NULL,
        entity TEXT,
        entity_id TEXT,
        detail TEXT,
        device_created_at TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS pos_audit_terminal_local_idx ON pos_audit_logs (terminal_id, local_id);
    `);
  } catch (e) {
    console.error("[migration] pos_audit_logs table error:", e);
  }

  // One-time opening balance migration — sets carry-over balances from previous system
  // Idempotent: only sets where opening_balance is still 0
  try {
    await db.execute(sql`
      UPDATE customers SET opening_balance = 9559.06
        WHERE code = 'CUST0001' AND opening_balance = 0;
      UPDATE customers SET opening_balance = 1756.27
        WHERE code = 'THEOSKEPASTI' AND opening_balance = 0;
      UPDATE customers SET opening_balance = 584.57
        WHERE code = 'MINTHIS' AND opening_balance = 0;
      UPDATE customers SET opening_balance = 2792.24
        WHERE code = 'MLPK' AND opening_balance = 0;
      UPDATE customers SET opening_balance = 6830.43
        WHERE code = 'MAR-AZUL-AYN' AND opening_balance = 0;
      UPDATE customers SET opening_balance = 2728.63
        WHERE code = 'MAR-AZUL-NIC' AND opening_balance = 0;
    `);
    console.log("[migration] Opening balances applied.");
  } catch (e) {
    console.error("[migration] Opening balance migration error:", e);
  }

  try {
    const { loadWaStateFromDb, startWaCartPruning } = await import("./chatbot-service");
    await loadWaStateFromDb();
    startWaCartPruning();
  } catch (e) {
    console.error("[wa-cart] startup restore failed:", e);
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // Scheduled daily backup — checks every hour
  const runScheduledBackup = async () => {
    try {
      const autoSetting = await storage.getSetting("backup_auto");
      if (autoSetting?.value !== "true") return;
      const lastSetting = await storage.getSetting("backup_last_date");
      const lastDate = lastSetting?.value ? new Date(lastSetting.value) : null;
      const now = new Date();
      const hoursSinceLast = lastDate ? (now.getTime() - lastDate.getTime()) / 3600000 : Infinity;
      if (hoursSinceLast < 24) return;
      const emailSetting = await storage.getSetting("backup_email");
      const companySetting = await storage.getSetting("company_name");
      const toEmail = emailSetting?.value || "";
      if (!toEmail) return;
      const date = now.toISOString().split("T")[0];
      // Use differential if last backup is within 8 days, otherwise full
      const since = (lastDate && hoursSinceLast < 192) ? lastDate.toISOString() : undefined;
      const json = await generateBackupJson(since);
      const parsed = JSON.parse(json);
      const result = await sendBackupEmail(toEmail, companySetting?.value || "Company", json, date);
      if (result.success) {
        await storage.upsertSetting("backup_last_date", now.toISOString(), "Last Backup Date", "backup");
        console.log(`[backup] ${parsed.backupType} backup sent to ${toEmail} (${Object.values(parsed.tableCounts).reduce((s: number, v: any) => s + v, 0)} records)`);
      } else {
        console.error(`[backup] Failed to send backup: ${result.error}`);
      }
    } catch (e) {
      console.error("[backup] Scheduled backup error:", e);
    }
  };
  // Run once shortly after startup, then every hour
  setTimeout(runScheduledBackup, 60000);
  setInterval(runScheduledBackup, 3600000);

  // Auto-mark overdue invoices at startup and every hour
  const runOverdueSweep = async () => {
    try { await storage.autoMarkOverdue(); } catch (e) { console.error("[overdue] sweep error:", e); }
  };
  runOverdueSweep();
  setInterval(runOverdueSweep, 3600000);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
