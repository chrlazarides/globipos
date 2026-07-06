/**
 * Sync engine hooks — background polling for catalog, inbox, outbox, and heartbeat.
 *
 * Mirror server routing: when `config.mirror_server_url` is set, the outbox
 * flush is sent to the mirror first (local relay). If the mirror is unreachable,
 * the primary `server_url` is used as fallback. This allows store-local servers
 * to act as a resilience layer before data propagates to the cloud.
 */
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SyncStatus, TerminalConfig, PeripheralHealth } from "../types";
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
  peripheralHealth: PeripheralHealth | null;
  notifications: Array<{ id: string; message_type: string; payload: string }>;
  timedPriceOverrides: Map<string, number>;
  triggerCatalogSync: () => Promise<void>;
  triggerInboxSync: () => Promise<void>;
  triggerOutboxFlush: () => Promise<void>;
}

const CATALOG_INTERVAL_MS   = 15 * 60 * 1000;  // 15 min
const INBOX_INTERVAL_MS     =  5 * 60 * 1000;  // 5 min
const OUTBOX_INTERVAL_MS    = 30 * 1000;        // 30 s
const HEARTBEAT_INTERVAL_MS = 60 * 1000;        // 1 min

export function useSync(isConfigured: boolean, config: TerminalConfig | null = null): UseSyncReturn {
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
  const triggerOutboxFlush = useCallback(async () => {
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
    await refreshStatus();
  }, [config, refreshStatus]);

  // Kick off background polling when terminal is configured
  useEffect(() => {
    if (!isConfigured) return;

    const beat = () => {
      sendHeartbeat()
        .then((r) => {
          setPeripheralHealth(r.peripheral_status);
          return refreshStatus();
        })
        .catch(() => {});
    };

    // Initial heartbeat + status
    beat();
    refreshTimedPrices();
    refreshNotifications();

    // Heartbeat every 1 min
    const heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    // Catalog sync every 15 min
    const catalogTimer = setInterval(triggerCatalogSync, CATALOG_INTERVAL_MS);

    // Inbox sync every 5 min
    const inboxTimer = setInterval(triggerInboxSync, INBOX_INTERVAL_MS);

    // Outbox flush every 30 s (mirror-first if mirror_server_url set)
    const outboxTimer = setInterval(triggerOutboxFlush, OUTBOX_INTERVAL_MS);

    return () => {
      clearInterval(heartbeatTimer);
      clearInterval(catalogTimer);
      clearInterval(inboxTimer);
      clearInterval(outboxTimer);
    };
  }, [isConfigured, refreshStatus, refreshTimedPrices, refreshNotifications,
      triggerCatalogSync, triggerInboxSync, triggerOutboxFlush]);

  return {
    status,
    peripheralHealth,
    notifications,
    timedPriceOverrides,
    triggerCatalogSync,
    triggerInboxSync,
    triggerOutboxFlush,
  };
}
