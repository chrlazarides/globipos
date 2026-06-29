/**
 * Sync engine hooks — background polling for catalog, inbox, outbox, and heartbeat.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { SyncStatus } from "../types";
import {
  syncCatalog,
  syncInbox,
  flushOutbox,
  getSyncStatus,
  sendHeartbeat,
  getActivePriceOverrides,
  getInboxNotifications,
} from "../lib/db";

export interface UseSyncReturn {
  status: SyncStatus;
  notifications: Array<{ id: string; message_type: string; payload: string }>;
  timedPriceOverrides: Map<string, number>;
  triggerCatalogSync: () => Promise<void>;
  triggerInboxSync: () => Promise<void>;
  triggerOutboxFlush: () => Promise<void>;
}

const CATALOG_INTERVAL_MS  = 15 * 60 * 1000;  // 15 min
const INBOX_INTERVAL_MS    =  5 * 60 * 1000;  // 5 min
const OUTBOX_INTERVAL_MS   = 30 * 1000;        // 30 s
const HEARTBEAT_INTERVAL_MS = 60 * 1000;       // 1 min

export function useSync(isConfigured: boolean): UseSyncReturn {
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

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getSyncStatus();
      setStatus(s);
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

  const triggerCatalogSync = useCallback(async () => {
    setStatus((s) => ({ ...s, syncing: true }));
    try {
      await syncCatalog();
      await refreshTimedPrices();
    } catch {}
    setStatus((s) => ({ ...s, syncing: false }));
    await refreshStatus();
  }, [refreshStatus, refreshTimedPrices]);

  const triggerInboxSync = useCallback(async () => {
    try {
      await syncInbox();
      await refreshTimedPrices();
      await refreshNotifications();
    } catch {}
    await refreshStatus();
  }, [refreshStatus, refreshTimedPrices, refreshNotifications]);

  const triggerOutboxFlush = useCallback(async () => {
    try {
      await flushOutbox();
    } catch {}
    await refreshStatus();
  }, [refreshStatus]);

  // Kick off background polling when terminal is configured
  useEffect(() => {
    if (!isConfigured) return;

    // Initial heartbeat + status
    sendHeartbeat().then(refreshStatus).catch(() => {});
    refreshTimedPrices();
    refreshNotifications();

    // Heartbeat every 1 min
    const heartbeatTimer = setInterval(() => {
      sendHeartbeat().then(refreshStatus).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    // Catalog sync every 15 min
    const catalogTimer = setInterval(triggerCatalogSync, CATALOG_INTERVAL_MS);

    // Inbox sync every 5 min
    const inboxTimer = setInterval(triggerInboxSync, INBOX_INTERVAL_MS);

    // Outbox flush every 30 s
    const outboxTimer = setInterval(triggerOutboxFlush, OUTBOX_INTERVAL_MS);

    return () => {
      clearInterval(heartbeatTimer);
      clearInterval(catalogTimer);
      clearInterval(inboxTimer);
      clearInterval(outboxTimer);
    };
  }, [isConfigured, refreshStatus, refreshTimedPrices, refreshNotifications, triggerCatalogSync, triggerInboxSync, triggerOutboxFlush]);

  return {
    status,
    notifications,
    timedPriceOverrides,
    triggerCatalogSync,
    triggerInboxSync,
    triggerOutboxFlush,
  };
}
