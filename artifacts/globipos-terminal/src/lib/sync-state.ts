import { getConfig, getQueueCounts, getSyncSnapshot, saveSyncSnapshot } from "./db";
import type { TerminalConfig } from "../types";

export type SyncPhase = "idle" | "cashiers" | "catalog-download" | "catalog-save" | "transactions" |
  "audits" | "complete" | "failed" | "partial" | "interrupted";

/** Aggregate observations only. No credentials, sale payloads or customer details. */
export interface SyncSnapshot {
  schemaVersion: 1;
  platform: "pwa" | "native";
  deviceId: string;
  runId: string | null;
  phase: SyncPhase;
  syncing: boolean;
  online: boolean;
  serverReachable: boolean | null;
  lastAttemptAt: string | null;
  startedAt: string | null;
  progressAt: string | null;
  lastServerContactAt: string | null;
  lastCatalogSyncAt: string | null;
  lastTransactionSyncAt: string | null;
  lastSuccessAt: string | null;
  catalogReceived: number;
  catalogCommitted: number;
  catalogPages: number;
  transactionsConfirmed: number;
  auditsConfirmed: number;
  outboxPending: number;
  outboxFailed: number;
  auditPending: number;
  auditFailed: number;
  error: string | null;
  retryAt: string | null;
}

export const SYNC_LOCK = "globipos-terminal-sync";
export const phaseLabels: Record<SyncPhase, string> = {
  idle: "Waiting for sync", cashiers: "Updating cashiers", "catalog-download": "Downloading catalog",
  "catalog-save": "Saving catalog", transactions: "Uploading transactions", audits: "Uploading audit records",
  complete: "Sync complete", failed: "Sync failed", partial: "Needs attention", interrupted: "Sync interrupted",
};

export function emptySyncSnapshot(): SyncSnapshot {
  return {
    schemaVersion: 1, platform: "pwa", deviceId: "", runId: null, phase: "idle", syncing: false,
    online: typeof navigator !== "undefined" ? navigator.onLine : false, serverReachable: null,
    lastAttemptAt: null, startedAt: null, progressAt: null, lastServerContactAt: null,
    lastCatalogSyncAt: null, lastTransactionSyncAt: null, lastSuccessAt: null,
    catalogReceived: 0, catalogCommitted: 0, catalogPages: 0, transactionsConfirmed: 0, auditsConfirmed: 0,
    outboxPending: 0, outboxFailed: 0, auditPending: 0, auditFailed: 0, error: null, retryAt: null,
  };
}

let snapshot = emptySyncSnapshot();
let identity = "";
let binding: TerminalConfig | null = null;
let revision = 0;
const listeners = new Set<() => void>();
export const getLiveSyncSnapshot = () => snapshot;
export function subscribeSync(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(next: SyncSnapshot) { snapshot = next; revision++; listeners.forEach(listener => listener()); }

export async function refreshSyncSnapshot(): Promise<SyncSnapshot> {
  const before = revision;
  const config = await getConfig();
  if (!config) return snapshot;
  const key = `${config.server_url}:${config.terminal_code}`;
  binding = config;
  const stored = await getSyncSnapshot(config.server_url, config.terminal_code);
  if (before !== revision) return snapshot;
  if (identity !== key || stored) {
    identity = key;
    snapshot = stored ?? { ...emptySyncSnapshot(), deviceId: crypto.randomUUID() };
  }
  // The Web Lock is released on crash/close; don't mistake another active tab for a crashed run.
  if (snapshot.syncing && navigator.locks) {
    const locks = await navigator.locks.query();
    if (!locks.held?.some(lock => lock.name === SYNC_LOCK)) {
      snapshot = { ...snapshot, syncing: false, phase: "interrupted", error: "Previous sync was interrupted. Retry safely." };
      await saveSyncSnapshot(config.server_url, config.terminal_code, snapshot);
    }
  }
  const next = snapshot;
  const queues = await getQueueCounts();
  if (before !== revision) return snapshot;
  publish({ ...next, online: navigator.onLine, ...queues });
  return snapshot;
}

export async function updateSyncSnapshot(patch: Partial<SyncSnapshot>): Promise<SyncSnapshot> {
  if (!binding) await refreshSyncSnapshot();
  const next = { ...snapshot, ...patch, online: navigator.onLine };
  if (binding) await saveSyncSnapshot(binding.server_url, binding.terminal_code, next);
  publish(next);
  return next;
}

/** Use after the page and this snapshot were committed in the same IndexedDB transaction. */
export function publishCommittedSnapshot(next: SyncSnapshot) { publish(next); }

export function syncLabel(state: SyncSnapshot, now = Date.now()): string {
  if (!state.online) return "Offline";
  if (state.syncing) {
    if (state.progressAt && now - Date.parse(state.progressAt) > 60_000) return "Sync stalled — waiting";
    return phaseLabels[state.phase];
  }
  if (state.phase === "failed" || state.phase === "partial" || state.phase === "interrupted") return phaseLabels[state.phase];
  if (state.serverReachable === false) return "Server unavailable";
  if (state.outboxPending + state.outboxFailed + state.auditPending + state.auditFailed > 0) return "Pending sync";
  if (!state.lastServerContactAt || now - Date.parse(state.lastServerContactAt) > 90_000) return "Server status unknown";
  if (!state.lastCatalogSyncAt) return "Catalog not synced";
  return "Last sync complete";
}

export function cyprusTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not yet";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Nicosia", dateStyle: "short", timeStyle: "medium",
  }).format(new Date(value));
}