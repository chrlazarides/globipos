type RetryOptions = {
  wait?: (milliseconds: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number) => void;
};

// Drizzle wraps PostgreSQL errors in `cause`; inspect the underlying failure.
export function isTransientBackupDatabaseError(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current = error; current && typeof current === "object" && !seen.has(current);) {
    seen.add(current);
    const failure = current as { code?: string; message?: string; cause?: unknown };
    if (typeof failure.code === "string" && (
      /^08/.test(failure.code) ||
      ["57P01", "57P02", "57P03", "53300", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"].includes(failure.code)
    )) return true;
    if (typeof failure.message === "string" &&
      /^(connection (?:terminated|closed)(?: unexpectedly)?|timeout exceeded when trying to connect|client has encountered a connection error and is not queryable)\.?$/i.test(failure.message)
    ) return true;
    current = failure.cause;
  }
  return false;
}

export async function retryBackupDatabaseOperation<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const delays = [2_000, 10_000];
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= delays.length || !isTransientBackupDatabaseError(error)) throw error;
      options.onRetry?.(attempt + 1, delays[attempt]);
      await wait(delays[attempt]);
    }
  }
}

type BackupDependencies = {
  getSetting: (key: string) => Promise<{ value: string | null } | undefined>;
  generateBackupJson: (since?: string) => Promise<string>;
  sendBackupEmail: (
    email: string, company: string, json: string, date: string,
    backupType?: string, sinceDate?: string | null,
  ) => Promise<{ success: boolean; error?: string }>;
  setLastBackupDate: (date: string) => Promise<unknown>;
  logger: {
    warn: (fields: object, message: string) => void;
    error: (fields: object, message: string) => void;
    info: (fields: object, message: string) => void;
  };
  now?: () => Date;
  retryOptions?: RetryOptions;
};

export function createScheduledBackupRunner(deps: BackupDependencies): () => Promise<void> {
  let running = false;
  const retry = <T>(operation: () => Promise<T>) => retryBackupDatabaseOperation(operation, {
    ...deps.retryOptions,
    onRetry: (attempt, delayMs) => {
      deps.logger.warn({ attempt, delayMs }, "Scheduled backup database interrupted; retrying");
      deps.retryOptions?.onRetry?.(attempt, delayMs);
    },
  });

  return async () => {
    if (running) return;
    running = true;
    try {
      // Restart preparation from scratch if any read fails. Never send partial data.
      const prepared = await retry(async () => {
        if ((await deps.getSetting("backup_auto"))?.value !== "true") return null;
        const lastValue = (await deps.getSetting("backup_last_date"))?.value;
        const parsedLast = lastValue ? new Date(lastValue) : null;
        const lastDate = parsedLast && Number.isFinite(parsedLast.getTime()) ? parsedLast : null;
        const now = deps.now?.() ?? new Date();
        const hoursSinceLast = lastDate ? (now.getTime() - lastDate.getTime()) / 3_600_000 : Infinity;
        if (hoursSinceLast < 24) return null;
        const email = (await deps.getSetting("backup_email"))?.value || "";
        if (!email) return null;
        const company = (await deps.getSetting("company_name"))?.value || "Company";
        const since = lastDate && hoursSinceLast < 192 ? lastDate.toISOString() : undefined;
        const json = await deps.generateBackupJson(since);
        return { email, company, json, since, date: now.toISOString() };
      });
      if (!prepared) return;

      // Email delivery is not replayed by a database retry.
      const result = await deps.sendBackupEmail(
        prepared.email, prepared.company, prepared.json, prepared.date.split("T")[0],
        prepared.since ? "differential" : "full", prepared.since ?? null,
      );
      if (!result.success) {
        deps.logger.error({ error: result.error }, "Scheduled backup failed");
        return;
      }
      try {
        // This same-value write is safe to retry, unlike sending the email again.
        await retry(() => deps.setLastBackupDate(prepared.date));
      } catch (err) {
        deps.logger.error({ err }, "Scheduled backup email sent but last backup date could not be saved");
        return;
      }
      deps.logger.info({}, "Scheduled backup completed");
    } catch (err) {
      deps.logger.error({ err }, "Scheduled backup error");
    } finally {
      running = false;
    }
  };
}