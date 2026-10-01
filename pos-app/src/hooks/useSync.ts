/**
 * Sync engine hooks — background polling for catalog, inbox, outbox, and heartbeat.
 *
 * Mirror server routing: when `config.mirror_server_url` is set, the outbox
 * flush is sent to the mirror first (local relay). If the mirror is unreachable,
 * the primary `server_url` is used as fallback. This allows store-local servers
 * to act as a resilience layer before data propagates to the cloud.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SyncStatus, SyncTelemetry, TerminalConfig, PeripheralHealth } from "../types";
import {
  syncCatalog,
  syncInbox,
  flushOutbox,
  getSyncStatus,
  getSyncTelemetry,
  sendHeartbeat,
  setSyncNetworkStatus,
  syncNow,
  getActivePriceOverrides,
  getInboxNotifications,
} from "../lib/db";

export interface UseSyncReturn {
  status: SyncStatus;
  telemetry: SyncTelemetry;
  syncNowBusy: boolean;
  peripheralHealth: PeripheralHealth | null;
  notifications: Array<{ id: string; message_type: string; payload: string }>;
  timedPriceOverrides: Map<string, number>;
  triggerCatalogSync: () => Promise<void>;
  triggerInboxSync: () => Promise<void>;
  triggerOutboxFlush: () => Promise<void>;
  triggerSyncNow: () => Promise<void>;
}

const CATALOG_INTERVAL_MS   = 15 * 60 * 1000;  // 15 min
const INBOX_INTERVAL_MS     =  5 * 60 * 1000;  // 5 min
const OUTBOX_INTERVAL_MS    = 30 * 1000;        // 30 s
// SCO Monitor polls every 10 seconds, so publish lane changes at the same cadence.
const HEARTBEAT_INTERVAL_MS = 10 * 1000;
const TELEMETRY_POLL_INTERVAL_MS = 1 * 1000;

const initialTelemetry: SyncTelemetry = {
  schemaVersion: 1,
  platform: "native",
  buildVersion: "",
  deviceId: "",
  sequence: 0,
  runId: null,
  phase: "idle",
  syncing: false,
  online: false,
  serverReachable: null,
  lastAttemptAt: null,
  startedAt: null,
  progressAt: null,
  lastServerContactAt: null,
  lastCatalogSyncAt: null,
  lastTransactionSyncAt: null,
  lastSuccessAt: null,
  catalogReceived: 0,
  catalogCommitted: 0,
  catalogPages: 0,
  transactionsConfirmed: 0,
  auditsConfirmed: 0,
  outboxPending: 0,
  outboxFailed: 0,
  auditPending: 0,
  auditFailed: 0,
  error: null,
  retryAt: null,
  inboxPending: 0,
  inboxReceived: 0,
};

export function useSync(isConfigured: boolean, config: TerminalConfig | null = null): UseSyncReturn {
  const coordinatorBusy = useRef(false);
  const [status, setStatus] = useState<SyncStatus>({
    online: false,
    syncing: false,
    outbox_pending: 0,
    outbox_failed: 0,
  });
  const [notifications, setNotifications] = useState<
    Array<{ id: string; message_type: string; payload: string }>
  >([]);
  const [timedPriceOverrides, setTimedPriceOverrides] = useState<Map<string, number>>(new Map());
  const [peripheralHealth, setPeripheralHealth] = useState<PeripheralHealth | null>(null);
  const [telemetry, setTelemetry] = useState<SyncTelemetry>(initialTelemetry);
  const [syncNowBusy, setSyncNowBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getSyncStatus();
      setStatus(s);
    } catch {}
  }, []);

  const refreshTelemetry = useCallback(async () => {
    try {
      const snapshot = await getSyncTelemetry();
      setTelemetry(snapshot);
    } catch {}
  }, []);

  const refreshTimedPrices = useCallback(async () => {
    try {
      const overrides = await getActivePriceOverrides();
      setTimedPriceOverrides(
        new Map(overrides.map((o) => [o.product_id, o.override_price]))
      );
    } catch {}
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const items = await getInboxNotifications();
      setNotifications(items);
    } catch {}
  }, []);

  const runCoordinated = useCallback(async (operation: () => Promise<unknown>) => {
    if (coordinatorBusy.current) return;
    coordinatorBusy.current = true;
    setSyncNowBusy(true);
    try {
      await operation();
    } catch {
      // Rust persists a redacted diagnostic and terminal phase for the panel.
    } finally {
      coordinatorBusy.current = false;
      setSyncNowBusy(false);
      await Promise.all([refreshStatus(), refreshTelemetry()]);
    }
  }, [refreshStatus, refreshTelemetry]);

  const triggerCatalogSync = useCallback(async () => runCoordinated(async () => {
    try {
      await syncCatalog();
      await refreshTimedPrices();
    } catch {}
  }), [refreshTimedPrices, runCoordinated]);

  const triggerInboxSync = useCallback(() => runCoordinated(async () => {
    try {
      await syncInbox();
      await refreshTimedPrices();
      await refreshNotifications();
    } catch {}
  }), [refreshTimedPrices, refreshNotifications, runCoordinated]);

  /**
   * Mirror-first outbox flush.
   *
   * Flow:
   *   1. If mirror_server_url is configured → invoke flush_outbox_mirror(mirrorUrl)
   *      which tries the mirror, falls back to primary in Rust if mirror unreachable.
   *   2. If no mirror → invoke standard flush_outbox (primary only).
   *
   * This ensures locally-hosted mirror servers are preferred for low-latency
   * sync while the central server remains the authoritative fallback.
   */
  const triggerOutboxFlush = useCallback(() => runCoordinated(async () => {
    try {
      const mirrorUrl = config?.mirror_server_url;
      if (mirrorUrl && mirrorUrl.trim()) {
        // Mirror-first routing via dedicated Rust command
        await invoke("flush_outbox_mirror", { mirrorUrl: mirrorUrl.trim() });
      } else {
        await flushOutbox();
      }
    } catch {
      // Any failure (both mirror and primary failed) — status will show failed count
    }
  }), [config, runCoordinated]);

  const triggerSyncNow = useCallback(() => runCoordinated(async () => {
    await syncNow();
    await refreshTimedPrices();
    await refreshNotifications();
  }), [refreshTimedPrices, refreshNotifications, runCoordinated]);

  // Kick off background polling when terminal is configured
  useEffect(() => {
    if (!isConfigured) return;

    const beat = () => {
      sendHeartbeat()
        .then((r) => {
          setPeripheralHealth(r.peripheral_status);
          if (r.peripheral_status.sync) setTelemetry(r.peripheral_status.sync);
          return Promise.all([refreshStatus(), refreshTelemetry()]);
        })
        .catch(() => {});
    };

    const updateNetwork = () => {
      const online = window.navigator.onLine;
      setSyncNetworkStatus(online).catch(() => {});
      setTelemetry((current) => ({ ...current, online }));
    };

    // Initial heartbeat + status
    beat();
    updateNetwork();
    refreshTimedPrices();
    refreshNotifications();
    refreshTelemetry();

    // Heartbeat every 1 min
    const heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    const telemetryTimer = setInterval(refreshTelemetry, TELEMETRY_POLL_INTERVAL_MS);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);

    // Catalog sync every 15 min
    const catalogTimer = setInterval(triggerCatalogSync, CATALOG_INTERVAL_MS);

    // Inbox sync every 5 min
    const inboxTimer = setInterval(triggerInboxSync, INBOX_INTERVAL_MS);

    // Outbox flush every 30 s (mirror-first if mirror_server_url set)
    const outboxTimer = setInterval(triggerOutboxFlush, OUTBOX_INTERVAL_MS);

    return () => {
      clearInterval(heartbeatTimer);
      clearInterval(telemetryTimer);
      clearInterval(catalogTimer);
      clearInterval(inboxTimer);
      clearInterval(outboxTimer);
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
    };
  }, [isConfigured, refreshStatus, refreshTimedPrices, refreshNotifications,
      refreshTelemetry, triggerCatalogSync, triggerInboxSync, triggerOutboxFlush]);

  return {
    status,
    telemetry,
    syncNowBusy,
    peripheralHealth,
    notifications,
    timedPriceOverrides,
    triggerCatalogSync,
    triggerInboxSync,
    triggerOutboxFlush,
    triggerSyncNow,
  };
}
