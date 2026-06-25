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
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
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

app.use(requireAuth);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
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
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const { seedDatabase, ensureDefaultSettings } = await import("./seed");
  await seedDatabase().catch(e => console.error("Seed error:", e));
  await ensureDefaultSettings().catch(e => console.error("Settings init error:", e));

  // Schema migration: add opening_balance column if it doesn't exist
  try {
    await db.execute(sql`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0;
    `);
  } catch (e) {
    console.error("[migration] opening_balance column error:", e);
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
      const result = await sendBackupEmail(toEmail, companySetting?.value || "Mediterranean Fine Foods", json, date);
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
