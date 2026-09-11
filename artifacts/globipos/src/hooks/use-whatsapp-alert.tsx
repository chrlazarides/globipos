import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/App";
import {
  calculateServerClockOffset,
  DEFAULT_STORE_TIME_ZONE,
  getQuietHoursEndInTimeZone,
  getServerCorrectedNow,
  isWithinQuietHoursInTimeZone,
} from "@shared/quiet-hours";

// Manual chime mute remains device-local. Scheduled quiet hours follow the signed-in staff
// account, while the temporary urgent-order override is shared store-wide.
const CHIME_MUTED_KEY = "whatsapp_alert_muted";
const SEEN_IDS_KEY = "whatsapp_alert_seen_ids";
const LEGACY_QUIET_HOURS_ENABLED_KEY = "whatsapp_alert_quiet_hours_enabled";
const LEGACY_QUIET_HOURS_START_KEY = "whatsapp_alert_quiet_hours_start";
const LEGACY_QUIET_HOURS_END_KEY = "whatsapp_alert_quiet_hours_end";

const DEFAULT_QUIET_START = 22;
const DEFAULT_QUIET_END = 8;

function loadLegacyQuietHours(): { enabled: boolean; startHour: number; endHour: number } | null {
  try {
    const enabledRaw = localStorage.getItem(LEGACY_QUIET_HOURS_ENABLED_KEY);
    const startRaw = localStorage.getItem(LEGACY_QUIET_HOURS_START_KEY);
    const endRaw = localStorage.getItem(LEGACY_QUIET_HOURS_END_KEY);
    if (enabledRaw === null && startRaw === null && endRaw === null) return null;
    const parsedStart = Number.parseInt(startRaw ?? "", 10);
    const parsedEnd = Number.parseInt(endRaw ?? "", 10);
    return {
      enabled: enabledRaw === "true",
      startHour: Number.isInteger(parsedStart) && parsedStart >= 0 && parsedStart <= 23 ? parsedStart : DEFAULT_QUIET_START,
      endHour: Number.isInteger(parsedEnd) && parsedEnd >= 0 && parsedEnd <= 23 ? parsedEnd : DEFAULT_QUIET_END,
    };
  } catch {
    return null;
  }
}

function clearLegacyQuietHours() {
  try {
    localStorage.removeItem(LEGACY_QUIET_HOURS_ENABLED_KEY);
    localStorage.removeItem(LEGACY_QUIET_HOURS_START_KEY);
    localStorage.removeItem(LEGACY_QUIET_HOURS_END_KEY);
  } catch {}
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
  quietHoursTimeZone: string;
  setQuietHours: (startHour: number, endHour: number) => void;
  quietHoursLoaded: boolean;
  quietHoursSaving: boolean;
  quietHoursSyncError: string | null;
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
  quietHoursTimeZone: DEFAULT_STORE_TIME_ZONE,
  setQuietHours: () => {},
  quietHoursLoaded: false,
  quietHoursSaving: false,
  quietHoursSyncError: null,
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

    const note = (freq: number, startOffset: number, duration: number) => {
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
    };

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
  const [quietHoursEnabled, setQuietHoursEnabledState] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState(DEFAULT_QUIET_START);
  const [quietHoursEnd, setQuietHoursEnd] = useState(DEFAULT_QUIET_END);
  const [quietHoursTimeZone, setQuietHoursTimeZone] = useState(DEFAULT_STORE_TIME_ZONE);
  const [quietHoursLoaded, setQuietHoursLoaded] = useState(false);
  const [quietHoursSaving, setQuietHoursSaving] = useState(false);
  const [quietHoursSyncError, setQuietHoursSyncError] = useState<string | null>(null);
  const [quietHoursOverrideActive, setQuietHoursOverrideActive] = useState(false);
  const [isQuietNow, setIsQuietNow] = useState(() =>
    quietHoursEnabled && !quietHoursOverrideActive && isWithinQuietHoursInTimeZone(quietHoursStart, quietHoursEnd, quietHoursTimeZone)
  );

  const seenIdsRef = useRef<Set<string> | null>(loadSeenIds());
  const chimeMutedRef = useRef(chimeMuted);
  const quietHoursRef = useRef({ enabled: quietHoursEnabled, start: quietHoursStart, end: quietHoursEnd, timeZone: quietHoursTimeZone, overrideActive: quietHoursOverrideActive });
  const quietHoursLoadedRef = useRef(false);
  const quietHoursSavingRef = useRef(false);
  const quietHoursEditVersionRef = useRef(0);
  const quietHoursSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const quietHoursAccountGenerationRef = useRef(0);
  const quietHoursFetchGenerationRef = useRef(0);
  const serverClockOffsetRef = useRef(0);
  const currentUserIdRef = useRef(user?.id);
  currentUserIdRef.current = user?.id;

  const persistOverride = useCallback(async (active: boolean, expiresAt?: Date) => {
    setQuietHoursOverrideActive(active);
    quietHoursRef.current.overrideActive = active;
    try {
      const res = await fetch("/api/staff/whatsapp/quiet-hours-override", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active, expiresAt: active ? expiresAt?.toISOString() : null }),
      });
      if (!res.ok) throw new Error("Failed to update quiet-hours override");
      const state = await res.json() as { active: boolean };
      setQuietHoursOverrideActive(state.active);
      quietHoursRef.current.overrideActive = state.active;
    } catch {
      setQuietHoursOverrideActive(!active);
      quietHoursRef.current.overrideActive = !active;
    }
  }, []);

  const fetchOverride = useCallback(async () => {
    if (!isAdmin) return null;
    try {
      const res = await fetch("/api/staff/whatsapp/quiet-hours-override", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return null;
      const state = await res.json() as { active: boolean };
      setQuietHoursOverrideActive(state.active);
      quietHoursRef.current.overrideActive = state.active;
      return state.active;
    } catch {
      return null;
    }
  }, [isAdmin]);

  useEffect(() => {
    chimeMutedRef.current = chimeMuted;
  }, [chimeMuted]);

  const loadQuietHours = useCallback(async () => {
    if (!user || quietHoursSavingRef.current) return;
    const accountGeneration = quietHoursAccountGenerationRef.current;
    const fetchGeneration = ++quietHoursFetchGenerationRef.current;
    const editVersion = quietHoursEditVersionRef.current;
    const requestStartedAt = Date.now();
    try {
      const res = await fetch("/api/users/me/whatsapp-quiet-hours", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load quiet hours");
      const responseReceivedAt = Date.now();
      let preference = await res.json() as { enabled: boolean; startHour: number; endHour: number; migrated: boolean; timezone: string; serverTime: string };
      if (
        accountGeneration !== quietHoursAccountGenerationRef.current ||
        fetchGeneration !== quietHoursFetchGenerationRef.current ||
        quietHoursSavingRef.current ||
        editVersion !== quietHoursEditVersionRef.current
      ) return;
      serverClockOffsetRef.current = calculateServerClockOffset(
        preference.serverTime,
        requestStartedAt,
        responseReceivedAt,
      );

      if (!preference.migrated) {
        const legacy = loadLegacyQuietHours();
        if (legacy) {
          const migrationRes = await fetch("/api/users/me/whatsapp-quiet-hours", {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...legacy, migrateLegacy: true }),
          });
          if (!migrationRes.ok) throw new Error("Failed to migrate quiet hours");
          preference = await migrationRes.json();
          clearLegacyQuietHours();
          if (
            accountGeneration !== quietHoursAccountGenerationRef.current ||
            fetchGeneration !== quietHoursFetchGenerationRef.current
          ) return;
        }
      }

      setQuietHoursEnabledState(preference.enabled);
      setQuietHoursStart(preference.startHour);
      setQuietHoursEnd(preference.endHour);
      setQuietHoursTimeZone(preference.timezone);
      quietHoursLoadedRef.current = true;
      setQuietHoursLoaded(true);
      setQuietHoursSyncError(null);
    } catch {
      setQuietHoursSyncError("Could not sync quiet hours. Check your connection and try again.");
    }
  }, [user?.id]);

  useEffect(() => {
    quietHoursAccountGenerationRef.current++;
    quietHoursFetchGenerationRef.current++;
    quietHoursEditVersionRef.current++;
    quietHoursSaveQueueRef.current = Promise.resolve();
    quietHoursSavingRef.current = false;
    setQuietHoursSaving(false);
    quietHoursLoadedRef.current = false;
    setQuietHoursLoaded(false);
    setQuietHoursSyncError(null);
    if (!user) return;

    loadQuietHours();
    const interval = window.setInterval(loadQuietHours, 30000);
    const onFocus = () => loadQuietHours();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") loadQuietHours();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      quietHoursAccountGenerationRef.current++;
      quietHoursFetchGenerationRef.current++;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user?.id, loadQuietHours]);

  useEffect(() => {
    quietHoursRef.current = { enabled: quietHoursEnabled, start: quietHoursStart, end: quietHoursEnd, timeZone: quietHoursTimeZone, overrideActive: quietHoursOverrideActive };
    const withinWindow = isWithinQuietHoursInTimeZone(
      quietHoursStart,
      quietHoursEnd,
      quietHoursTimeZone,
      getServerCorrectedNow(serverClockOffsetRef.current),
    );
    setIsQuietNow(quietHoursEnabled && !quietHoursOverrideActive && withinWindow);
  }, [quietHoursEnabled, quietHoursStart, quietHoursEnd, quietHoursTimeZone, quietHoursOverrideActive]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { enabled, start, end, timeZone, overrideActive } = quietHoursRef.current;
      const withinWindow = isWithinQuietHoursInTimeZone(
        start,
        end,
        timeZone,
        getServerCorrectedNow(serverClockOffsetRef.current),
      );
      setIsQuietNow(enabled && !overrideActive && withinWindow);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchPendingWhatsApp = useCallback(async () => {
    if (!isAdmin || !quietHoursLoadedRef.current) return;
    try {
      const sharedOverride = await fetchOverride();
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
      for (const id of Array.from(currentIds)) {
        if (!seenIdsRef.current.has(id)) {
          brandNew++;
        }
      }

      if (brandNew > 0) {
        setNewOrderCount(prev => prev + brandNew);
        const { enabled: quietEnabled, start: quietStart, end: quietEnd, timeZone, overrideActive } = quietHoursRef.current;
        const effectiveOverride = sharedOverride ?? overrideActive;
        const withinQuietHours = quietEnabled && !effectiveOverride && isWithinQuietHoursInTimeZone(
          quietStart,
          quietEnd,
          timeZone,
          getServerCorrectedNow(serverClockOffsetRef.current),
        );
        if (!chimeMutedRef.current && !withinQuietHours) {
          playChime();
        }
      }

      seenIdsRef.current = currentIds;
      saveSeenIds(currentIds);
    } catch {
    }
  }, [isAdmin, fetchOverride]);

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

  const saveQuietHours = useCallback((enabled: boolean, startHour: number, endHour: number) => {
    const accountGeneration = quietHoursAccountGenerationRef.current;
    const accountUserId = user?.id;
    if (!accountUserId) return;
    const editVersion = ++quietHoursEditVersionRef.current;
    quietHoursSavingRef.current = true;
    setQuietHoursSaving(true);
    setQuietHoursSyncError(null);

    quietHoursSaveQueueRef.current = quietHoursSaveQueueRef.current
      .catch(() => {})
      .then(async () => {
        if (
          accountGeneration !== quietHoursAccountGenerationRef.current ||
          accountUserId !== currentUserIdRef.current
        ) return;
        const res = await fetch("/api/users/me/whatsapp-quiet-hours", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled, startHour, endHour }),
        });
        if (!res.ok) throw new Error("Failed to save quiet hours");
        const saved = await res.json() as { enabled: boolean; startHour: number; endHour: number };
        if (editVersion === quietHoursEditVersionRef.current) {
          setQuietHoursEnabledState(saved.enabled);
          setQuietHoursStart(saved.startHour);
          setQuietHoursEnd(saved.endHour);
          setQuietHoursSyncError(null);
        }
      })
      .catch(() => {
        setQuietHoursSyncError("Quiet hours were not saved. Check your connection and try again.");
      })
      .finally(() => {
        if (editVersion === quietHoursEditVersionRef.current) {
          quietHoursSavingRef.current = false;
          setQuietHoursSaving(false);
        }
      });
  }, [user?.id]);

  const setQuietHoursEnabled = useCallback((enabled: boolean) => {
    setQuietHoursEnabledState(enabled);
    saveQuietHours(enabled, quietHoursStart, quietHoursEnd);
  }, [quietHoursStart, quietHoursEnd, saveQuietHours]);

  const setQuietHours = useCallback((startHour: number, endHour: number) => {
    setQuietHoursStart(startHour);
    setQuietHoursEnd(endHour);
    saveQuietHours(quietHoursEnabled, startHour, endHour);
  }, [quietHoursEnabled, saveQuietHours]);

  const overrideQuietHours = useCallback(() => {
    void persistOverride(
      true,
      getQuietHoursEndInTimeZone(
        quietHoursStart,
        quietHoursEnd,
        quietHoursTimeZone,
        getServerCorrectedNow(serverClockOffsetRef.current),
      ),
    );
  }, [persistOverride, quietHoursStart, quietHoursEnd, quietHoursTimeZone]);

  const cancelQuietHoursOverride = useCallback(() => {
    void persistOverride(false);
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
        quietHoursTimeZone,
        setQuietHours,
        quietHoursLoaded,
        quietHoursSaving,
        quietHoursSyncError,
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
