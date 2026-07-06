import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/App";

const CHIME_MUTED_KEY = "whatsapp_alert_muted";
const SEEN_IDS_KEY = "whatsapp_alert_seen_ids";
const QUIET_HOURS_ENABLED_KEY = "whatsapp_alert_quiet_hours_enabled";
const QUIET_HOURS_START_KEY = "whatsapp_alert_quiet_hours_start";
const QUIET_HOURS_END_KEY = "whatsapp_alert_quiet_hours_end";
const QUIET_HOURS_OVERRIDE_KEY = "whatsapp_alert_quiet_hours_override";

const DEFAULT_QUIET_START = 22;
const DEFAULT_QUIET_END = 8;

function loadQuietHoursEnabled(): boolean {
  try { return localStorage.getItem(QUIET_HOURS_ENABLED_KEY) === "true"; } catch { return false; }
}

function loadQuietHour(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 23) return parsed;
    }
  } catch {}
  return fallback;
}

function isWithinQuietHours(startHour: number, endHour: number, now: Date = new Date()): boolean {
  const hour = now.getHours();
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

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
  quietHoursEnabled: boolean;
  setQuietHoursEnabled: (enabled: boolean) => void;
  quietHoursStart: number;
  quietHoursEnd: number;
  setQuietHours: (startHour: number, endHour: number) => void;
  isQuietNow: boolean;
  quietHoursOverrideActive: boolean;
  overrideQuietHours: () => void;
  cancelQuietHoursOverride: () => void;
}

const WhatsAppAlertContext = createContext<WhatsAppAlertContextValue>({
  newOrderCount: 0,
  clearNewOrders: () => {},
  chimeMuted: false,
  toggleChimeMuted: () => {},
  quietHoursEnabled: false,
  setQuietHoursEnabled: () => {},
  quietHoursStart: DEFAULT_QUIET_START,
  quietHoursEnd: DEFAULT_QUIET_END,
  setQuietHours: () => {},
  isQuietNow: false,
  quietHoursOverrideActive: false,
  overrideQuietHours: () => {},
  cancelQuietHoursOverride: () => {},
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
  const [quietHoursEnabled, setQuietHoursEnabledState] = useState(loadQuietHoursEnabled);
  const [quietHoursStart, setQuietHoursStart] = useState(() => loadQuietHour(QUIET_HOURS_START_KEY, DEFAULT_QUIET_START));
  const [quietHoursEnd, setQuietHoursEnd] = useState(() => loadQuietHour(QUIET_HOURS_END_KEY, DEFAULT_QUIET_END));
  const [quietHoursOverrideActive, setQuietHoursOverrideActive] = useState(() => {
    try { return sessionStorage.getItem(QUIET_HOURS_OVERRIDE_KEY) === "true"; } catch { return false; }
  });
  const [isQuietNow, setIsQuietNow] = useState(() =>
    quietHoursEnabled && !quietHoursOverrideActive && isWithinQuietHours(quietHoursStart, quietHoursEnd)
  );

  const seenIdsRef = useRef<Set<string> | null>(loadSeenIds());
  const chimeMutedRef = useRef(chimeMuted);
  const quietHoursRef = useRef({ enabled: quietHoursEnabled, start: quietHoursStart, end: quietHoursEnd, overrideActive: quietHoursOverrideActive });

  const persistOverride = useCallback((active: boolean) => {
    setQuietHoursOverrideActive(active);
    try {
      if (active) sessionStorage.setItem(QUIET_HOURS_OVERRIDE_KEY, "true");
      else sessionStorage.removeItem(QUIET_HOURS_OVERRIDE_KEY);
    } catch {}
  }, []);

  useEffect(() => {
    chimeMutedRef.current = chimeMuted;
  }, [chimeMuted]);

  useEffect(() => {
    quietHoursRef.current = { enabled: quietHoursEnabled, start: quietHoursStart, end: quietHoursEnd, overrideActive: quietHoursOverrideActive };
    const withinWindow = isWithinQuietHours(quietHoursStart, quietHoursEnd);
    // Once the quiet window ends, the override no longer has anything to override — clear it.
    if (quietHoursOverrideActive && !withinWindow) {
      persistOverride(false);
    }
    setIsQuietNow(quietHoursEnabled && !quietHoursOverrideActive && withinWindow);
  }, [quietHoursEnabled, quietHoursStart, quietHoursEnd, quietHoursOverrideActive, persistOverride]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { enabled, start, end, overrideActive } = quietHoursRef.current;
      const withinWindow = isWithinQuietHours(start, end);
      if (overrideActive && !withinWindow) {
        persistOverride(false);
        return;
      }
      setIsQuietNow(enabled && !overrideActive && withinWindow);
    }, 60000);
    return () => clearInterval(interval);
  }, [persistOverride]);

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
        const { enabled: quietEnabled, start: quietStart, end: quietEnd, overrideActive } = quietHoursRef.current;
        const withinQuietHours = quietEnabled && !overrideActive && isWithinQuietHours(quietStart, quietEnd);
        if (!chimeMutedRef.current && !withinQuietHours) {
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

  const setQuietHoursEnabled = useCallback((enabled: boolean) => {
    setQuietHoursEnabledState(enabled);
    try { localStorage.setItem(QUIET_HOURS_ENABLED_KEY, String(enabled)); } catch {}
  }, []);

  const setQuietHours = useCallback((startHour: number, endHour: number) => {
    setQuietHoursStart(startHour);
    setQuietHoursEnd(endHour);
    try {
      localStorage.setItem(QUIET_HOURS_START_KEY, String(startHour));
      localStorage.setItem(QUIET_HOURS_END_KEY, String(endHour));
    } catch {}
  }, []);

  const overrideQuietHours = useCallback(() => {
    persistOverride(true);
  }, [persistOverride]);

  const cancelQuietHoursOverride = useCallback(() => {
    persistOverride(false);
  }, [persistOverride]);

  return (
    <WhatsAppAlertContext.Provider
      value={{
        newOrderCount,
        clearNewOrders,
        chimeMuted,
        toggleChimeMuted,
        quietHoursEnabled,
        setQuietHoursEnabled,
        quietHoursStart,
        quietHoursEnd,
        setQuietHours,
        isQuietNow,
        quietHoursOverrideActive,
        overrideQuietHours,
        cancelQuietHoursOverride,
      }}
    >
      {children}
    </WhatsAppAlertContext.Provider>
  );
}
