import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes, generateBackupJson } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { sendBackupEmail } from "./email";
import { storage } from "./storage";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

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
      const json = await generateBackupJson();
      const result = await sendBackupEmail(toEmail, companySetting?.value || "VinTrade", json, date);
      if (result.success) {
        await storage.upsertSetting("backup_last_date", now.toISOString(), "Last Backup Date", "backup");
        console.log(`[backup] Daily backup sent to ${toEmail}`);
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
