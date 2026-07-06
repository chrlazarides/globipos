import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { getStaff } from "@/lib/auth";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { ClipboardList, Plus, CheckCircle2, History, X } from "lucide-react";

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

export default function StockTake() {
  const qc = useQueryClient();
  const staff = getStaff();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [newSessionReference, setNewSessionReference] = useState("");
  const [countInput, setCountInput] = useState("");
  const [pendingItem, setPendingItem] = useState<ItemLite | null>(null);

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

  const lookupItem = useMutation({
    mutationFn: async (code: string) => apiFetch<ItemLite>(`/api/items/barcode/${encodeURIComponent(code)}`),
    onSuccess: (item) => { setPendingItem(item); setCountInput(String(item.stockQuantity)); },
    onError: () => alert("No item found for that barcode."),
  });

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

      {session?.status === "submitted" ? (
        <div className="flex items-center gap-2 text-success bg-success/10 rounded-lg p-3 text-sm">
          <CheckCircle2 className="w-4 h-4" /> This session has been submitted and stock updated.
        </div>
      ) : (
        <>
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
            <div className="text-right text-sm">
              <span className="text-muted-foreground">{line.systemQuantity} →</span>{" "}
              <span className={`font-semibold ${line.countedQuantity !== line.systemQuantity ? "text-destructive" : ""}`}>
                {line.countedQuantity}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
