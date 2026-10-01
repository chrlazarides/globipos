import { useEffect, useReducer, useSyncExternalStore } from "react";
import { getLiveSyncSnapshot, refreshSyncSnapshot, subscribeSync } from "../lib/sync-state";

export function useLiveSync() {
  const state = useSyncExternalStore(subscribeSync, getLiveSyncSnapshot, getLiveSyncSnapshot);
  const [, repaint] = useReducer((current: number) => current + 1, 0);
  useEffect(() => {
    const refresh = () => { void refreshSyncSnapshot().catch(() => {}); };
    refresh();
    const timer = window.setInterval(() => { repaint(); refresh(); }, 2_000);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);
  return state;
}