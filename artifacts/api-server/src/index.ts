import app from "./app";
import { createServer } from "node:http";
import { registerRoutes, generateBackupJson } from "./routes/routes";
import { storage } from "./storage";
import { sendBackupEmail } from "./email";
import { seedDatabase, ensureDefaultSettings } from "./seed";
import { initializeCustomerAiRuntimeHealth } from "./customer-ai-service";
import { loadWaStateFromDb, startWaCartPruning } from "./chatbot-service";
import { startDeviceSyncRelay } from "./device-sync-relay";
import { logger } from "./lib/logger";
import { createScheduledBackupRunner } from "./scheduled-backup";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

async function initializeApplication() {
  await seedDatabase().catch((err) => logger.error({ err }, "Database seed failed"));
  await ensureDefaultSettings().catch((err) => logger.error({ err }, "Default settings initialization failed"));
  await initializeCustomerAiRuntimeHealth().catch((err) => logger.error({ err }, "Customer AI health initialization failed"));
  await loadWaStateFromDb().then(startWaCartPruning).catch((err) => logger.error({ err }, "WhatsApp cart state restore failed"));

  await registerRoutes(httpServer, app);
  startDeviceSyncRelay();

  app.use((err: any, _req: unknown, res: any, next: (error?: unknown) => void) => {
    const status = err.status || err.statusCode || 500;
    if (res.headersSent) return next(err);
    logger.error({ err }, "Internal Server Error");
    return res.status(status).json({ message: err.message || "Internal Server Error" });
  });

  const runScheduledBackup = createScheduledBackupRunner({
    getSetting: (key) => storage.getSetting(key),
    generateBackupJson,
    sendBackupEmail,
    setLastBackupDate: (date) => storage.upsertSetting("backup_last_date", date, "Last Backup Date", "backup"),
    logger,
  });

  setTimeout(runScheduledBackup, 60_000);
  setInterval(runScheduledBackup, 3_600_000);
  const runOverdueSweep = () => storage.autoMarkOverdue().catch((err) => logger.error({ err }, "Overdue invoice sweep failed"));
  runOverdueSweep();
  setInterval(runOverdueSweep, 3_600_000);

  httpServer.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "Server listening");
  });
}

initializeApplication().catch((err) => {
  logger.error({ err }, "Failed to initialize server");
  process.exit(1);
});
