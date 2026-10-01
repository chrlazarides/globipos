import { getConfig, saveCatalogPage, getOutbox, saveCashiers, getSyncCursor, getActiveProductsCount, getAuditOutbox, setConfig, markQueueFailure, getQueueCounts, confirmQueueItem, nextSyncReportSequence, hasCatalogStaging, clearSyncCursor } from "./db";
import type { Category, Product, CashierSession, TerminalConfig } from "../types";
import { fetchOnce, fetchWithRetry, normalizeServerUrl, HttpError } from "./utils";
import { mapCashier, mapCategory, mapProduct, toAuditEntry, toBillPayload } from "./terminal-contract";
import { getLiveSyncSnapshot, refreshSyncSnapshot, updateSyncSnapshot, publishCommittedSnapshot, SYNC_LOCK } from "./sync-state";

class RejectedSyncRecord extends Error {}

export async function registerTerminal(serverUrl: string, terminalCode: string): Promise<TerminalConfig> {
  const origin = normalizeServerUrl(serverUrl);
  
  const text = await fetchOnce(`${origin}/api/pos/terminals/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminalCode, catalogSyncVersion: 1 })
  });
  
  const data = JSON.parse(text);
  
  if (!data?.terminal?.id || !data?.terminal?.name || !data?.location?.id || !data?.location?.name) {
    throw new Error("Terminal registration response is incomplete");
  }
  const previous = await getConfig();
  const config: TerminalConfig = {
    server_url: origin,
    terminal_code: terminalCode,
    voucher_device_key: previous && previous.terminal_id === data.terminal.id ? previous.voucher_device_key : undefined,
    terminal_id: data.terminal?.id || "",
    terminal_name: data.terminal?.name || "",
    location_id: data.location?.id || "",
    location_name: data.location?.name || "",
    price_level: data.terminal?.priceLevel || 1,
    initial_sync_complete: false,
  };
  
  if (Array.isArray(data.cashiers)) await saveCashiers(data.cashiers.map(mapCashier));
  
  await setConfig(config);
  return config;
}

async function performCashierSync(): Promise<void> {
  const config = await getConfig();
  if (!config) throw new Error("No config available");
  
  const text = await fetchWithRetry(`${config.server_url}/api/pos/sync/cashiers`, {
    headers: { "X-Terminal-Code": config.terminal_code }
  });
  
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Cashier sync response is invalid");
  const cashiers: CashierSession[] = data.map(mapCashier);
  
  await saveCashiers(cashiers);
  await updateSyncSnapshot({ lastServerContactAt: new Date().toISOString(), serverReachable: true });
}

async function performCatalogSync(onProgress?: (progress: number) => void): Promise<number> {
  const config = await getConfig();
  if (!config) throw new Error("No config available");
  
  const limit = 250;
  const baseUrl = config.server_url;
  let cursor = await getSyncCursor(baseUrl, config.terminal_code);
  // Cursors left by older builds did not have a staged catalog. Restart safely.
  if (cursor && !(await hasCatalogStaging())) {
    await clearSyncCursor(baseUrl, config.terminal_code);
    cursor = null;
  }
  let firstPage = cursor === null;
  
  while (true) {
    await updateSyncSnapshot({ phase: "catalog-download", progressAt: new Date().toISOString() });
    const url = new URL(`${baseUrl}/api/sync/catalog`);
    url.searchParams.set("limit", limit.toString());
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }
    
    const text = await fetchWithRetry(url.toString(), {
      headers: { "X-Terminal-Code": config.terminal_code }
    });
    
    const data = JSON.parse(text);
    if (!Array.isArray(data.items) || !Array.isArray(data.categories) || typeof data.done !== "boolean") {
      throw new Error("Catalog sync response is invalid");
    }
    if (!data.done && (typeof data.nextCursor !== "string" || !data.nextCursor)) {
      throw new Error("Catalog sync response is missing nextCursor");
    }
    const categories: Category[] = data.categories.map(mapCategory);
    const products: Product[] = data.items.map(mapProduct);
    const now = new Date().toISOString();
    await updateSyncSnapshot({
      phase: "catalog-save", lastServerContactAt: now, serverReachable: true, progressAt: now,
      catalogReceived: getLiveSyncSnapshot().catalogReceived + products.length,
    });
    const nextCursor = data.done ? null : data.nextCursor as string;
    const committed = {
      ...getLiveSyncSnapshot(),
      catalogCommitted: getLiveSyncSnapshot().catalogCommitted + products.length,
      catalogPages: getLiveSyncSnapshot().catalogPages + 1,
      progressAt: now,
      lastCatalogSyncAt: data.done ? now : getLiveSyncSnapshot().lastCatalogSyncAt,
    };
    await saveCatalogPage(
      categories.length > 0 ? categories : null,
      products,
      firstPage,
      baseUrl,
      config.terminal_code,
      nextCursor,
      committed,
    );
    publishCommittedSnapshot(committed);
    
    if (data.done) {
      if (onProgress) onProgress(100);
      break;
    }
    cursor = nextCursor;
    firstPage = false;
  }
  window.dispatchEvent(new Event("globipos:catalog-updated"));
  return getActiveProductsCount();
}

async function performOutboxFlush(retryFailed: boolean): Promise<number> {
  const config = await getConfig();
  if (!config) return 0;
  
  const outbox = await getOutbox();
  let synced = 0;
  const baseUrl = config.server_url;
  
  for (const item of outbox) {
    if (item.sync_retryable === false && !retryFailed) continue;
    try {
      await updateSyncSnapshot({ phase: "transactions", progressAt: new Date().toISOString() });
      const bill = toBillPayload(item.order, item.lines);
      const text = await fetchOnce(`${baseUrl}/api/sync/bills`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Terminal-Code": config.terminal_code
        },
        body: JSON.stringify({ bills: [bill] })
      });
      const response = JSON.parse(text);
      const result = response?.results?.find((entry: any) => entry.orderNumber === bill.orderNumber);
      if (result?.status !== "ok") throw new RejectedSyncRecord("Server did not accept this bill");
      const now = new Date().toISOString();
      const confirmed = {
        ...getLiveSyncSnapshot(), transactionsConfirmed: synced + 1, lastTransactionSyncAt: now, lastServerContactAt: now,
        serverReachable: true, progressAt: now,
      };
      await confirmQueueItem("outbox", item.id, baseUrl, config.terminal_code, confirmed);
      synced++;
      publishCommittedSnapshot(confirmed);
    } catch (e) {
      await recordQueueFailure("outbox", item.id, e);
    }
  }

  const audits = await getAuditOutbox();
  for (const item of audits) {
    if (item.sync_retryable === false && !retryFailed) continue;
    try {
      await updateSyncSnapshot({ phase: "audits", progressAt: new Date().toISOString() });
      const text = await fetchOnce(`${baseUrl}/api/pos/sync/audit-logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Terminal-Code": config.terminal_code
        },
        body: JSON.stringify({ entries: [toAuditEntry(item)] })
      });
      const response = JSON.parse(text);
      if (response?.status !== "ok") throw new RejectedSyncRecord("Server did not accept this audit record");
      const confirmed = {
        ...getLiveSyncSnapshot(),
        auditsConfirmed: getLiveSyncSnapshot().auditsConfirmed + 1,
        lastServerContactAt: new Date().toISOString(), serverReachable: true, progressAt: new Date().toISOString(),
      };
      await confirmQueueItem("audit", item.id, baseUrl, config.terminal_code, confirmed);
      publishCommittedSnapshot(confirmed);
    } catch (e) {
      await recordQueueFailure("audit", item.id, e);
    }
  }
  
  return synced;
}

export function safeSyncError(error: unknown): string {
  if (error instanceof RejectedSyncRecord) return "Server rejected a queued record. It was kept locally for review.";
  if (error instanceof HttpError) return `Server returned HTTP ${error.status}. Check terminal access and server health.`;
  if (error instanceof Error && error.name === "AbortError") return "Request timed out. Pending records are retained.";
  if (error instanceof Error && error.message === "Another terminal window is syncing. Wait for it to finish.") return error.message;
  if (error instanceof Error && error.message.includes("secure Web Locks")) return "This browser cannot safely coordinate POS sync. Update your browser and use HTTPS.";
  return "Sync could not be confirmed. Check the connection or server response; pending records are retained.";
}

async function recordQueueFailure(store: "outbox" | "audit", id: number, error: unknown) {
  const retryable = !(error instanceof RejectedSyncRecord) &&
    (!(error instanceof HttpError) || error.status === 408 || error.status === 429 || error.status >= 500);
  await markQueueFailure(store, id, retryable);
  await updateSyncSnapshot({
    error: safeSyncError(error), ...await getQueueCounts(),
    ...(error instanceof HttpError ? {} : { serverReachable: false }),
    retryAt: retryable ? new Date(Date.now() + 30_000).toISOString() : null,
  });
}

type SyncKind = "catalog" | "outbox" | "cashiers" | "full";
let activeRun: Promise<{ products: number; uploaded: number }> | null = null;
let activeKind: SyncKind | null = null;

async function runSync(kind: SyncKind, onProgress?: (progress: number) => void, retryFailed = false) {
  if (activeRun) {
    if (activeKind === kind || activeKind === "full") return activeRun;
    await activeRun.catch(() => {});
    return runSync(kind, onProgress, retryFailed);
  }
  activeKind = kind;
  activeRun = (async () => {
    if (!navigator.locks) throw new Error("A browser with secure Web Locks is required for safe sync.");
    return navigator.locks.request(SYNC_LOCK, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error("Another terminal window is syncing. Wait for it to finish.");
      await refreshSyncSnapshot();
      const previous = getLiveSyncSnapshot();
      const previousIssue = kind !== "full" && ["failed", "partial", "interrupted"].includes(previous.phase)
        ? previous.error ?? "A previous sync needs attention. Run Sync Now." : null;
      const now = new Date().toISOString();
      await updateSyncSnapshot({
        syncing: true, phase: kind === "outbox" ? "transactions" : kind === "catalog" ? "catalog-download" : "cashiers",
        runId: crypto.randomUUID(), startedAt: now, progressAt: now, lastAttemptAt: now, error: null, retryAt: null,
        ...(kind === "catalog" || kind === "full" ? { catalogReceived: 0, catalogCommitted: 0, catalogPages: 0 } : {}),
        ...(kind === "outbox" || kind === "full" ? { transactionsConfirmed: 0, auditsConfirmed: 0 } : {}),
      });
      try {
        if (!navigator.onLine) throw new Error("Device offline");
        let products = 0;
        let uploaded = 0;
        if (kind === "full" || kind === "cashiers") await performCashierSync();
        if (kind === "full" || kind === "catalog") products = await performCatalogSync(onProgress);
        if (kind === "full" || kind === "outbox") uploaded = await performOutboxFlush(retryFailed);
        const queues = await getQueueCounts();
        const partial = !!previousIssue || queues.outboxPending + queues.outboxFailed + queues.auditPending + queues.auditFailed > 0;
        await updateSyncSnapshot({
          ...queues, syncing: false, phase: partial ? "partial" : "complete", progressAt: new Date().toISOString(),
          ...(previousIssue ? { error: previousIssue } : {}),
          ...(!partial && kind === "full" ? { lastSuccessAt: new Date().toISOString() } : {}),
        });
        return { products, uploaded };
      } catch (error) {
        await updateSyncSnapshot({
          syncing: false, phase: "failed", error: safeSyncError(error), serverReachable: false,
          progressAt: new Date().toISOString(), ...await getQueueCounts(),
        });
        throw error;
      } finally {
        void reportSyncStatus().catch(() => {});
      }
    });
  })().finally(() => { activeRun = null; activeKind = null; });
  return activeRun;
}

export async function syncCashiers(): Promise<void> { await runSync("cashiers"); }
export async function syncCatalog(onProgress?: (progress: number) => void): Promise<number> {
  return (await runSync("catalog", onProgress)).products;
}
export async function flushOutbox(): Promise<number> {
  const queues = await getQueueCounts();
  if (queues.outboxPending + queues.outboxFailed + queues.auditPending + queues.auditFailed === 0) return 0;
  return (await runSync("outbox")).uploaded;
}
export async function syncAll(retryRejected = false) { return runSync("full", undefined, retryRejected); }

let reporting: Promise<void> | null = null;
export function reportSyncStatus(): Promise<void> {
  if (reporting) return reporting;
  reporting = (async () => {
    const config = await getConfig();
    if (!config || !navigator.onLine) return;
    const sequence = await nextSyncReportSequence(config.server_url, config.terminal_code);
    const state = { ...getLiveSyncSnapshot(), ...await getQueueCounts(), sequence };
    const text = await fetchOnce(`${config.server_url}/api/pos/terminals/${encodeURIComponent(config.terminal_id)}/heartbeat`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Terminal-Code": config.terminal_code },
      body: JSON.stringify({ outboxQueueSize: state.outboxPending + state.outboxFailed, syncStatus: state }),
    });
    if (JSON.parse(text)?.ok !== true) throw new Error("Heartbeat not confirmed");
    if (!getLiveSyncSnapshot().syncing) await updateSyncSnapshot({ serverReachable: true, lastServerContactAt: new Date().toISOString() });
  })().catch(async error => {
    if (!getLiveSyncSnapshot().syncing) await updateSyncSnapshot({ serverReachable: false, error: safeSyncError(error) });
    throw error;
  }).finally(() => { reporting = null; });
  return reporting;
}
