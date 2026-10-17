// File-backed test storage boundary. The production sync controller is real.
// This proves controller restart/retry, NOT IndexedDB/browser crash durability.
import { readFileSync, writeFileSync } from "node:fs";
const context = () => {
  if (!globalThis.__moneySync) throw new Error("Sync fixture not installed");
  return globalThis.__moneySync;
};
const read = () => JSON.parse(readFileSync(context().disk, "utf8"));
const write = records => writeFileSync(context().disk, JSON.stringify(records));
const unavailable = () => { throw new Error("Unexpected catalogue/registration operation in money sync fixture"); };
export const saveCatalogPage = unavailable;
export const saveCashiers = unavailable;
export const setConfig = unavailable;
export const clearSyncCursor = unavailable;
export const getSyncCursor = unavailable;
export const getActiveProductsCount = unavailable;
export const hasCatalogStaging = unavailable;
export const getConfig = async () => ({
  server_url: "https://money.invalid", terminal_code: "TEST-001", terminal_id: "sample-terminal",
});
export const getOutbox = async () => read();
export const getAuditOutbox = async () => [];
export async function getQueueCounts() {
  const rows = read();
  return {
    outboxPending: rows.filter(r => !r.failed).length, outboxFailed: rows.filter(r => r.failed).length,
    auditPending: 0, auditFailed: 0,
  };
}
export async function markQueueFailure(store, id, retryable) {
  if (store !== "outbox") throw new Error("Unexpected queue");
  write(read().map(row => row.id === id ? { ...row, failed: true, sync_retryable: retryable } : row));
}
export async function confirmQueueItem(store, id, server, terminal, confirmed) {
  if (store !== "outbox" || server !== "https://money.invalid" || terminal !== "TEST-001") {
    throw new Error("Acknowledgement escaped original terminal binding");
  }
  context().confirmations++;
  write(read().filter(row => row.id !== id));
  context().snapshot = confirmed;
}
export const SYNC_LOCK = "money-fixture-lock";
export const getLiveSyncSnapshot = () => context().snapshot;
export const refreshSyncSnapshot = async () => {};
export const updateSyncSnapshot = async patch => Object.assign(context().snapshot, patch);
export const publishCommittedSnapshot = state => { context().snapshot = state; };
export const nextSyncReportSequence = async () => ++context().sequence;

export async function fetchOnce(url, options) {
  const c = context();
  if (url.endsWith("/heartbeat")) return JSON.stringify({ ok: true });
  if (url !== "https://money.invalid/api/sync/bills") throw new Error(`Unexpected fixture URL: ${url}`);
  c.requests++;
  if (c.wait) await c.wait;
  const payload = JSON.parse(options.body);
  if (!Array.isArray(payload.bills) || payload.bills.length !== 1) throw new Error("Unexpected sync payload");
  const incoming = c.validate(payload.bills[0]);
  if (c.reject) return JSON.stringify({ results: [{ orderNumber: incoming.orderNumber, status: "error" }] });
  const existing = c.server.get(incoming.orderNumber);
  if (existing && !c.matches(existing, incoming)) throw new Error("Conflicting retry");
  if (!existing) {
    c.server.set(incoming.orderNumber, structuredClone(incoming));
    c.posts++;
  }
  if (c.loseReply) { c.loseReply = false; throw new Error("Fixture lost reply after acceptance"); }
  return JSON.stringify({ results: [{ orderNumber: incoming.orderNumber, status: "ok" }] });
}
export const fetchWithRetry = fetchOnce;
