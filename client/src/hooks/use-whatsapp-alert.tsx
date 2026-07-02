import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/App";

const CHIME_MUTED_KEY = "whatsapp_alert_muted";
const SEEN_IDS_KEY = "whatsapp_alert_seen_ids";

function loadSeenIds(): Set<string> | null {
  try {
    const raw = sessionStorage.getItem(SEEN_IDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed as string[]);
    }
  } catch {}
  return null;
}

function saveSeenIds(ids: Set<string>) {
  try {
    sessionStorage.setItem(SEEN_IDS_KEY, JSON.stringify(Array.from(ids)));
  } catch {}
}

interface WhatsAppAlertContextValue {
  newOrderCount: number;
  clearNewOrders: () => void;
  chimeMuted: boolean;
  toggleChimeMuted: () => void;
}

const WhatsAppAlertContext = createContext<WhatsAppAlertContextValue>({
  newOrderCount: 0,
  clearNewOrders: () => {},
  chimeMuted: false,
  toggleChimeMuted: () => {},
});

export const useWhatsAppAlert = () => useContext(WhatsAppAlertContext);

function playChime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    function note(freq: number, startOffset: number, duration: number) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, now + startOffset);
      gain.gain.linearRampToValueAtTime(0.28, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
    }

    note(880, 0, 0.4);
    note(1108.73, 0.18, 0.45);
    note(1318.51, 0.36, 0.55);

    setTimeout(() => ctx.close(), 1200);
  } catch {
  }
}

export function WhatsAppAlertProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superuser";

  const [newOrderCount, setNewOrderCount] = useState(0);
  const [chimeMuted, setChimeMuted] = useState(() => {
    try { return localStorage.getItem(CHIME_MUTED_KEY) === "true"; } catch { return false; }
  });
  const seenIdsRef = useRef<Set<string> | null>(loadSeenIds());
  const chimeMutedRef = useRef(chimeMuted);

  useEffect(() => {
    chimeMutedRef.current = chimeMuted;
  }, [chimeMuted]);

  const fetchPendingWhatsApp = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch("/api/admin/portal-orders?status=pending&source=whatsapp", {
        credentials: "include",
      });
      if (!res.ok) return;
      const orders: { id: string }[] = await res.json();
      const currentIds = new Set(orders.map(o => o.id));

      if (seenIdsRef.current === null) {
        seenIdsRef.current = currentIds;
        saveSeenIds(currentIds);
        return;
      }

      let brandNew = 0;
      for (const id of currentIds) {
        if (!seenIdsRef.current.has(id)) {
          brandNew++;
        }
      }

      if (brandNew > 0) {
        setNewOrderCount(prev => prev + brandNew);
        if (!chimeMutedRef.current) {
          playChime();
        }
      }

      seenIdsRef.current = currentIds;
      saveSeenIds(currentIds);
    } catch {
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchPendingWhatsApp();
    const interval = setInterval(fetchPendingWhatsApp, 30000);
    return () => clearInterval(interval);
  }, [isAdmin, fetchPendingWhatsApp]);

  const clearNewOrders = useCallback(() => {
    setNewOrderCount(0);
  }, []);

  const toggleChimeMuted = useCallback(() => {
    setChimeMuted(prev => {
      const next = !prev;
      try { localStorage.setItem(CHIME_MUTED_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  return (
    <WhatsAppAlertContext.Provider value={{ newOrderCount, clearNewOrders, chimeMuted, toggleChimeMuted }}>
      {children}
    </WhatsAppAlertContext.Provider>
  );
}
