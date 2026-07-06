import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { getStaff } from "@/lib/auth";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { ClipboardList, Plus, CheckCircle2, History, X, WifiOff } from "lucide-react";

interface StockTakeSession {
  id: string;
  reference: string;
  locationLabel: string | null;
  status: string;
  createdByUsername: string;
  createdAt: string;
  submittedAt: string | null;
}

interface StockTakeLine {
  id: string;
  itemId: string;
  itemName: string;
  sku: string;
  systemQuantity: number;
  countedQuantity: number;
  notes: string | null;
  scannedAt: string;
}

interface ItemLite { id: string; name: string; sku: string; barcode: string | null; stockQuantity: number; }

type CountMode = "increment" | "enter-qty";

interface PendingLine {
  itemId: string;
  itemName: string;
  sku: string;
  systemQuantity: number;
  countedQuantity: number;
}

function draftKey(sessionId: string) {
  return `pda_stock_take_draft_${sessionId}`;
}

function loadDraft(sessionId: string): Record<string, PendingLine> {
  try {
    const raw = localStorage.getItem(draftKey(sessionId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDraft(sessionId: string, draft: Record<string, PendingLine>) {
  localStorage.setItem(draftKey(sessionId), JSON.stringify(draft));
}

function clearDraft(sessionId: string) {
  localStorage.removeItem(draftKey(sessionId));
}

export default function StockTake() {
  const qc = useQueryClient();
  const staff = getStaff();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [newSessionReference, setNewSessionReference] = useState("");
  const [countInput, setCountInput] = useState("");
  const [pendingItem, setPendingItem] = useState<ItemLite | null>(null);
  const [mode, setMode] = useState<CountMode>("increment");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [draft, setDraft] = useState<Record<string, PendingLine>>({});

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (activeSessionId) setDraft(loadDraft(activeSessionId));
    else setDraft({});
  }, [activeSessionId]);

  const sessionsQuery = useQuery<StockTakeSession[]>({ queryKey: ["/api/pda/stock-take/sessions"] });
  const activeSessionQuery = useQuery<StockTakeSession & { lines: StockTakeLine[] }>({
    queryKey: [`/api/pda/stock-take/sessions/${activeSessionId}`],
    enabled: !!activeSessionId,
  });

  const createSession = useMutation({
    mutationFn: async () =>
      apiFetch<StockTakeSession>("/api/pda/stock-take/sessions", {
        method: "POST",
        body: JSON.stringify({ reference: newSessionReference || `Stock Take ${new Date().toLocaleDateString()}` }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/pda/stock-take/sessions"] });
      setActiveSessionId(data.id);
      setNewSessionReference("");
    },
  });

  // Pushes a line to the backend; if the request fails (e.g. offline), the count
  // stays buffered in localStorage (keyed by session) and is retried automatically
  // once connectivity returns, so an in-progress count is never lost.
  const syncLine = useMutation({
    mutationFn: async (line: PendingLine) => {
      if (!activeSessionId) return;
      return apiFetch(`/api/pda/stock-take/sessions/${activeSessionId}/lines`, {
        method: "POST",
        body: JSON.stringify({
          itemId: line.itemId,
          itemName: line.itemName,
          sku: line.sku,
          systemQuantity: line.systemQuantity,
          countedQuantity: line.countedQuantity,
        }),
      });
    },
    onSuccess: (_data, line) => {
      qc.invalidateQueries({ queryKey: [`/api/pda/stock-take/sessions/${activeSessionId}`] });
      setDraft((prev) => {
        const { [line.itemId]: _removed, ...rest } = prev;
        if (activeSessionId) saveDraft(activeSessionId, rest);
        return rest;
      });
    },
  });

  const lookupItem = useMutation({
    mutationFn: async (code: string) => apiFetch<ItemLite>(`/api/items/barcode/${encodeURIComponent(code)}`),
    onSuccess: (item) => {
      if (mode === "increment" && activeSessionId) {
        const existingLine = activeSessionQuery.data?.lines.find((l) => l.itemId === item.id);
        const baseCount = draft[item.id]?.countedQuantity ?? existingLine?.countedQuantity ?? 0;
        const next: PendingLine = {
          itemId: item.id,
          itemName: item.name,
          sku: item.sku,
          systemQuantity: item.stockQuantity,
          countedQuantity: baseCount + 1,
        };
        const updated = { ...draft, [item.id]: next };
        setDraft(updated);
        saveDraft(activeSessionId, updated);
        syncLine.mutate(next);
      } else {
        setPendingItem(item);
        setCountInput(String(item.stockQuantity));
      }
    },
    onError: () => alert("No item found for that barcode."),
  });

  // Retry any buffered lines once we're back online.
  useEffect(() => {
    if (isOnline && activeSessionId) {
      Object.values(draft).forEach((line) => syncLine.mutate(line));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, activeSessionId]);

  const submitLine = useMutation({
    mutationFn: async () => {
      if (!pendingItem || !activeSessionId) return;
      return apiFetch(`/api/pda/stock-take/sessions/${activeSessionId}/lines`, {
        method: "POST",
        body: JSON.stringify({
          itemId: pendingItem.id,
          itemName: pendingItem.name,
          sku: pendingItem.sku,
          systemQuantity: pendingItem.stockQuantity,
          countedQuantity: parseInt(countInput) || 0,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/pda/stock-take/sessions/${activeSessionId}`] });
      setPendingItem(null);
      setCountInput("");
    },
  });

  const submitSession = useMutation({
    mutationFn: async () => apiFetch(`/api/pda/stock-take/sessions/${activeSessionId}/submit`, { method: "POST" }),
    onSuccess: () => {
      if (activeSessionId) clearDraft(activeSessionId);
      qc.invalidateQueries({ queryKey: ["/api/pda/stock-take/sessions"] });
      setActiveSessionId(null);
    },
  });

  if (!activeSessionId) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><ClipboardList className="w-5 h-5" /> Stock Take</h1>
          <p className="text-sm text-muted-foreground">Start a new counting session or resume one in progress</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <input
            value={newSessionReference}
            onChange={(e) => setNewSessionReference(e.target.value)}
            placeholder="Session name (optional)"
            className="w-full rounded-lg border border-border bg-background py-2.5 px-3 text-sm"
            data-testid="input-session-name"
          />
          <button
            onClick={() => createSession.mutate()}
            disabled={createSession.isPending}
            className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 font-medium flex items-center justify-center gap-2"
            data-testid="button-new-session"
          >
            <Plus className="w-4 h-4" /> New Stock Take Session
          </button>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1"><History className="w-3.5 h-3.5" /> Recent Sessions</h2>
          {sessionsQuery.data?.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSessionId(s.id)}
              className="w-full text-left bg-card border border-border rounded-lg p-3 flex items-center justify-between"
              data-testid={`card-session-${s.id}`}
            >
              <div>
                <p className="text-sm font-medium">{s.reference}</p>
                <p className="text-xs text-muted-foreground">by {s.createdByUsername} · {new Date(s.createdAt).toLocaleDateString()}</p>
              </div>
              <span className={`text-xs rounded-full px-2 py-0.5 ${s.status === "submitted" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                {s.status}
              </span>
            </button>
          ))}
          {sessionsQuery.data?.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No sessions yet</p>
          )}
        </div>
      </div>
    );
  }

  const session = activeSessionQuery.data;
  const bufferedCount = Object.keys(draft).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">{session?.reference || "Stock Take"}</h1>
          <p className="text-sm text-muted-foreground">{session?.lines.length || 0} item(s) counted</p>
        </div>
        <button onClick={() => setActiveSessionId(null)} className="text-muted-foreground" data-testid="button-close-session">
          <X className="w-5 h-5" />
        </button>
      </div>

      {!isOnline && (
        <div className="flex items-center gap-2 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-lg p-2.5" data-testid="text-offline-banner">
          <WifiOff className="w-3.5 h-3.5 shrink-0" /> Offline — scans are saved on this device and will sync automatically when you're back online.
        </div>
      )}
      {isOnline && bufferedCount > 0 && (
        <div className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg p-2.5" data-testid="text-sync-banner">
          Syncing {bufferedCount} buffered count(s)…
        </div>
      )}

      {session?.status === "submitted" ? (
        <div className="flex items-center gap-2 text-success bg-success/10 rounded-lg p-3 text-sm">
          <CheckCircle2 className="w-4 h-4" /> This session has been submitted and stock updated.
        </div>
      ) : (
        <>
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            <button
              onClick={() => setMode("increment")}
              className={`flex-1 py-2 font-medium ${mode === "increment" ? "bg-primary text-primary-foreground" : "bg-card"}`}
              data-testid="button-mode-increment"
            >
              Scan to Increment
            </button>
            <button
              onClick={() => setMode("enter-qty")}
              className={`flex-1 py-2 font-medium ${mode === "enter-qty" ? "bg-primary text-primary-foreground" : "bg-card"}`}
              data-testid="button-mode-enter-qty"
            >
              Scan then Enter Qty
            </button>
          </div>

          {pendingItem ? (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3" data-testid="card-pending-item">
              <p className="font-medium text-sm">{pendingItem.name}</p>
              <p className="text-xs text-muted-foreground">SKU {pendingItem.sku} · System: {pendingItem.stockQuantity}</p>
              <input
                value={countInput}
                onChange={(e) => setCountInput(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                autoFocus
                placeholder="Counted quantity"
                className="w-full text-center text-2xl font-mono rounded-lg border border-border bg-background py-3"
                data-testid="input-counted-qty"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setPendingItem(null)}
                  className="flex-1 rounded-lg bg-muted py-2.5 text-sm"
                  data-testid="button-cancel-count"
                >
                  Cancel
                </button>
                <button
                  onClick={() => submitLine.mutate()}
                  disabled={submitLine.isPending}
                  className="flex-1 rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium"
                  data-testid="button-save-count"
                >
                  Save Count
                </button>
              </div>
            </div>
          ) : (
            <BarcodeScanner onScan={(code) => lookupItem.mutate(code)} />
          )}

          <button
            onClick={() => { if (confirm("Submit this session? Stock quantities will be updated immediately.")) submitSession.mutate(); }}
            disabled={submitSession.isPending || !session?.lines.length}
            className="w-full bg-success text-success-foreground rounded-lg py-3 font-medium disabled:opacity-40"
            data-testid="button-submit-session"
          >
            Submit Session & Update Stock
          </button>
        </>
      )}

      <div className="space-y-2">
        {session?.lines.map((line) => (
          <div key={line.id} className="bg-card border border-border rounded-lg p-3 flex items-center justify-between" data-testid={`row-line-${line.itemId}`}>
            <div>
              <p className="text-sm font-medium">{line.itemName}</p>
              <p className="text-xs text-muted-foreground">SKU {line.sku}</p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{line.systemQuantity} →</span>
              <span className={`font-semibold ${line.countedQuantity !== line.systemQuantity ? "text-destructive" : ""}`}>
                {line.countedQuantity}
              </span>
              {session?.status !== "submitted" && (
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => {
                      const next: PendingLine = {
                        itemId: line.itemId,
                        itemName: line.itemName,
                        sku: line.sku,
                        systemQuantity: line.systemQuantity,
                        countedQuantity: Math.max(0, line.countedQuantity - 1),
                      };
                      const updated = { ...draft, [line.itemId]: next };
                      setDraft(updated);
                      saveDraft(activeSessionId!, updated);
                      syncLine.mutate(next);
                    }}
                    className="w-6 h-6 rounded bg-muted text-xs"
                    data-testid={`button-decrement-${line.itemId}`}
                  >
                    −
                  </button>
                  <button
                    onClick={() => {
                      const next: PendingLine = {
                        itemId: line.itemId,
                        itemName: line.itemName,
                        sku: line.sku,
                        systemQuantity: line.systemQuantity,
                        countedQuantity: line.countedQuantity + 1,
                      };
                      const updated = { ...draft, [line.itemId]: next };
                      setDraft(updated);
                      saveDraft(activeSessionId!, updated);
                      syncLine.mutate(next);
                    }}
                    className="w-6 h-6 rounded bg-muted text-xs"
                    data-testid={`button-increment-${line.itemId}`}
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
