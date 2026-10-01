import { useState } from "react";
import { RefreshCw, Wifi, WifiOff, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { useLiveSync } from "../hooks/use-live-sync";
import { cyprusTime, phaseLabels, syncLabel } from "../lib/sync-state";
import { syncAll, safeSyncError } from "../lib/sync";

export function SyncDetails() {
  const state = useLiveSync();
  const [message, setMessage] = useState<string | null>(null);
  const queues = state.outboxPending + state.outboxFailed + state.auditPending + state.auditFailed;
  async function syncNow() {
    setMessage(null);
    try { await syncAll(true); } catch (error) { setMessage(safeSyncError(error)); }
  }
  function diagnostics() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "globipos-sync-diagnostics.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  return (
    <div className="space-y-4 text-sm" data-testid="sync-details">
      <div className="rounded-lg bg-muted p-3" role="status" aria-live="polite">
        <p className="font-semibold">{syncLabel(state)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Network: {state.online ? "online" : "offline"} · Server: {!state.online ? "not checked while offline" :
            state.serverReachable === false ? "unavailable" : !state.lastServerContactAt || Date.now() - Date.parse(state.lastServerContactAt) > 90_000
              ? "unknown / last contact is stale" : "contact confirmed"}
        </p>
        {state.syncing && <p className="mt-1 text-xs">{phaseLabels[state.phase]} · {state.startedAt ? `${Math.max(0, Math.floor((Date.now() - Date.parse(state.startedAt)) / 1000))}s elapsed` : ""}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric title="Catalog records received" value={state.catalogReceived} />
        <Metric title="Catalog records saved" value={state.catalogCommitted} />
        <Metric title="Catalog pages saved" value={state.catalogPages} />
        <Metric title="Queued bills acknowledged" value={state.transactionsConfirmed} />
        <Metric title="Audit records confirmed" value={state.auditsConfirmed} />
        <Metric title="Total queued records" value={queues} />
      </div>
      <p className="text-xs text-muted-foreground">Counts describe the most recent run of each channel. Catalog records are staged until the full download completes; they are not stock units moved. No percentage is shown because the server does not supply a total.</p>
      <div className="rounded-lg border border-border p-3">
        <p>Transactions: <b>{state.outboxPending}</b> pending · <b className={state.outboxFailed ? "text-destructive" : ""}>{state.outboxFailed}</b> failed</p>
        <p>Audit records: <b>{state.auditPending}</b> pending · <b className={state.auditFailed ? "text-destructive" : ""}>{state.auditFailed}</b> failed</p>
      </div>
      <dl className="space-y-2 text-xs">
        {[
          ["Last attempt", state.lastAttemptAt], ["Last verified server contact", state.lastServerContactAt],
          ["Last complete catalog sync", state.lastCatalogSyncAt], ["Last confirmed transaction upload", state.lastTransactionSyncAt],
          ["Last fully successful cycle", state.lastSuccessAt], ["Last progress", state.progressAt], ["Scheduled queue retry", state.retryAt],
        ].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-1"><dt className="text-muted-foreground">{label}</dt><dd>{cyprusTime(value)}</dd></div>)}
      </dl>
      <p className="text-xs text-muted-foreground">All times: Cyprus (Europe/Nicosia). Pending work survives reloads.</p>
      {(state.error || message) && <p className="rounded-lg bg-destructive/10 p-3 text-destructive" role="alert">{message ?? state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void syncNow()} disabled={state.syncing || !state.online}
          className="flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" data-testid="sync-now">
          <RefreshCw className={`h-4 w-4 ${state.syncing ? "animate-spin" : ""}`} />{state.syncing ? "Syncing…" : queues ? "Sync Now / Retry" : "Sync Now"}
        </button>
        <button type="button" onClick={diagnostics} className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2">
          <Download className="h-4 w-4" />Diagnostics
        </button>
      </div>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: number }) {
  return <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{title}</p><p className="mt-1 text-lg font-semibold">{value.toLocaleString()}</p></div>;
}

export function SyncIndicator() {
  const state = useLiveSync();
  const [open, setOpen] = useState(false);
  const attention = !state.online || state.serverReachable === false ||
    ["failed", "partial", "interrupted"].includes(state.phase) || state.outboxFailed + state.auditFailed > 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button type="button" onClick={() => setOpen(true)} aria-label="Open live sync status" data-testid="sync-indicator"
        className={`flex min-h-9 max-w-56 items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs ${attention ? "text-amber-500" : "text-muted-foreground"}`}>
        {state.syncing ? <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> : state.online ? <Wifi className="h-4 w-4 shrink-0" /> : <WifiOff className="h-4 w-4 shrink-0" />}
        <span className="truncate">{syncLabel(state)}</span>
      </button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Live sync status</DialogTitle><DialogDescription>Actual processing, server confirmations and retained queues.</DialogDescription></DialogHeader>
        <SyncDetails />
      </DialogContent>
    </Dialog>
  );
}