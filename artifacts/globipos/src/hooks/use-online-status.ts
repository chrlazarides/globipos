import { useState, useEffect, useCallback } from "react";
import { offlineStore } from "@/lib/offline-store";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await offlineStore.getPendingInvoices();
      setPendingCount(pending.length);
    } catch {
      setPendingCount(0);
    }
  }, []);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    refreshPendingCount();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refreshPendingCount]);

  const syncPending = useCallback(async () => {
    if (!navigator.onLine || syncing) return;
    setSyncing(true);
    try {
      const pending = await offlineStore.getPendingInvoices();
      if (pending.length === 0) {
        setSyncing(false);
        return;
      }
      let synced = 0;
      let failed = 0;
      for (const inv of pending as any[]) {
        try {
          await apiRequest("POST", "/api/invoices", inv.payload);
          await offlineStore.removePendingInvoice(inv.offlineId);
          synced++;
        } catch {
          failed++;
        }
      }
      await refreshPendingCount();
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      if (synced > 0) {
        toast({ title: `Synced ${synced} offline invoice${synced > 1 ? "s" : ""}` });
      }
      if (failed > 0) {
        toast({ title: `${failed} invoice${failed > 1 ? "s" : ""} failed to sync`, variant: "destructive" });
      }
    } catch {
      toast({ title: "Sync failed", variant: "destructive" });
    }
    setSyncing(false);
  }, [syncing, refreshPendingCount, toast]);

  useEffect(() => {
    if (isOnline) {
      syncPending();
    }
  }, [isOnline]);

  return { isOnline, pendingCount, syncing, syncPending, refreshPendingCount };
}
