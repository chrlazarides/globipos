import app from "./app";
import { createServer } from "node:http";
import { registerRoutes, generateBackupJson } from "./routes/routes";
import { storage } from "./storage";
import { sendBackupEmail } from "./email";
import { seedDatabase, ensureDefaultSettings } from "./seed";
import { initializeCustomerAiRuntimeHealth } from "./customer-ai-service";
import { loadWaStateFromDb, startWaCartPruning } from "./chatbot-service";
import { logger } from "./lib/logger";
import { getTenantId, getTenantIds, isMultiTenantMode, runWithTenant, verifyTenantDatabases } from "./db";

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
  await verifyTenantDatabases();
  const tenantIds = isMultiTenantMode() ? getTenantIds() : [getTenantId()];
  if (isMultiTenantMode() && tenantIds.length === 0) {
    throw new Error("Multi-tenant mode has no configured tenants; refusing to initialize tenant background work");
  }
  for (const tenantId of tenantIds) {
    await runWithTenant(tenantId, async () => {
      // The legacy seed installs demo data and a known default administrator.
      // New tenant databases must be migrated and provisioned explicitly.
      if (!isMultiTenantMode()) {
        await seedDatabase().catch((err) => logger.error({ err, tenantId }, "Database seed failed"));
        await ensureDefaultSettings().catch((err) => logger.error({ err, tenantId }, "Default settings initialization failed"));
      }
    });
  }

  for (const tenantId of tenantIds) {
    await runWithTenant(tenantId, async () => {
      await loadWaStateFromDb()
        .catch((err) => logger.error({ err, tenantId }, "WhatsApp cart state restore failed"));
    });
  }
  startWaCartPruning(tenantIds);

  if (isMultiTenantMode()) {
    logger.warn("Central deployment-domain monitor is disabled in multi-tenant mode");
  }
  await registerRoutes(httpServer, app, {
    skipBackgroundJobs: isMultiTenantMode(),
    scheduleTenantJobs: isMultiTenantMode(),
  });

  for (const tenantId of tenantIds) {
    await runWithTenant(tenantId, async () => {
      await initializeCustomerAiRuntimeHealth().catch((err) =>
        logger.error({ err, tenantId }, "Customer AI health initialization failed")
      );
    });
  }

  app.use((err: any, _req: unknown, res: any, next: (error?: unknown) => void) => {
    const status = err.status || err.statusCode || 500;
    if (res.headersSent) return next(err);
    logger.error({ err }, "Internal Server Error");
    return res.status(status).json({ message: err.message || "Internal Server Error" });
  });

  const runScheduledBackupForTenant = async () => {
    try {
      const autoSetting = await storage.getSetting("backup_auto");
      if (autoSetting?.value !== "true") return;
      const lastSetting = await storage.getSetting("backup_last_date");
      const lastDate = lastSetting?.value ? new Date(lastSetting.value) : null;
      const now = new Date();
      const hoursSinceLast = lastDate ? (now.getTime() - lastDate.getTime()) / 3_600_000 : Infinity;
      if (hoursSinceLast < 24) return;
      const toEmail = (await storage.getSetting("backup_email"))?.value || "";
      if (!toEmail) return;
      const companyName = (await storage.getSetting("company_name"))?.value || "Company";
      const backup = await generateBackupJson(lastDate && hoursSinceLast < 192 ? lastDate.toISOString() : undefined);
      const result = await sendBackupEmail(toEmail, companyName, backup, now.toISOString().split("T")[0]);
      if (result.success) {
        await storage.upsertSetting("backup_last_date", now.toISOString(), "Last Backup Date", "backup");
      } else {
        logger.error({ error: result.error }, "Scheduled backup failed");
      }
    } catch (err) {
      logger.error({ err }, "Scheduled backup error");
    }
  };
  const runScheduledBackup = async () => {
    for (const tenantId of tenantIds) {
      await runWithTenant(tenantId, runScheduledBackupForTenant);
    }
  };

  setTimeout(runScheduledBackup, 60_000);
  setInterval(runScheduledBackup, 3_600_000);
  const runOverdueSweep = async () => {
    for (const tenantId of tenantIds) {
      await runWithTenant(tenantId, () =>
        storage.autoMarkOverdue().catch((err) => logger.error({ err, tenantId }, "Overdue invoice sweep failed"))
      );
    }
  };
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
