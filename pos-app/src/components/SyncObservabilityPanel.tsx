import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  Loader2Icon,
  RefreshCwIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import type { SyncTelemetry } from "../types";

interface SyncObservabilityPanelProps {
  telemetry: SyncTelemetry;
  isLight: boolean;
  busy: boolean;
  onSyncNow: () => void;
}

const phaseLabels: Record<SyncTelemetry["phase"], string> = {
  idle: "Idle",
  cashiers: "Cashiers",
  "catalog-download": "Catalog download",
  "catalog-save": "Catalog save",
  inbox: "Inbox sync",
  transactions: "Transactions",
  audits: "Audits",
  complete: "Complete",
  failed: "Failed",
  partial: "Partially complete",
  interrupted: "Interrupted",
};

export function SyncObservabilityPanel({
  telemetry,
  isLight,
  busy,
  onSyncNow,
}: SyncObservabilityPanelProps) {
  const panel = isLight
    ? "bg-white border-slate-200 text-slate-800 shadow-xl"
    : "bg-gray-900 border-gray-700 text-gray-100 shadow-2xl";
  const muted = isLight ? "text-slate-500" : "text-gray-400";
  const rule = isLight ? "border-slate-200" : "border-gray-700";
  const progressAge = ageOf(telemetry.progressAt);
  const stalled = telemetry.syncing && progressAge.seconds !== null && progressAge.seconds >= 150;
  const phaseText = stalled
    ? `Stalled · no progress for ${progressAge.label}`
    : telemetry.syncing
      ? `Running · ${phaseLabels[telemetry.phase]}`
      : phaseLabels[telemetry.phase];
  const statusTone = telemetry.phase === "failed" || stalled
    ? "text-red-500"
    : telemetry.phase === "partial" || telemetry.syncing
      ? "text-amber-500"
      : telemetry.phase === "complete"
        ? "text-emerald-500"
        : muted;
  const OnlineIcon = telemetry.online ? WifiIcon : WifiOffIcon;
  const serverLabel = telemetry.serverReachable === true
    ? "Reachable"
    : telemetry.serverReachable === false
      ? "Unreachable"
      : "Not verified";

  return (
    <section
      className={`absolute right-0 top-full z-[100] mt-2 w-[min(26rem,calc(100vw-1rem))] rounded-xl border p-4 ${panel}`}
      role="dialog"
      aria-label="Synchronization details"
      data-testid="panel-sync-details"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Live sync status</h2>
          <p className={`mt-1 flex items-center gap-1.5 text-xs ${statusTone}`}>
            {stalled
              ? <AlertCircleIcon className="h-3.5 w-3.5" />
              : telemetry.syncing
                ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                : telemetry.phase === "complete"
                  ? <CheckCircle2Icon className="h-3.5 w-3.5" />
                  : <Clock3Icon className="h-3.5 w-3.5" />}
            {phaseText}
          </p>
        </div>
        <button
          type="button"
          onClick={onSyncNow}
          disabled={busy || telemetry.syncing}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-burgundy-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-burgundy-700 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="button-sync-now"
        >
          <RefreshCwIcon className={`h-3.5 w-3.5 ${busy || telemetry.syncing ? "animate-spin" : ""}`} />
          {telemetry.error ? "Retry sync" : "Sync now"}
        </button>
      </div>

      <div className={`mt-3 grid grid-cols-2 gap-2 border-y py-3 ${rule}`}>
        <div className="flex items-center gap-2 text-xs">
          <OnlineIcon className={`h-3.5 w-3.5 ${telemetry.online ? "text-emerald-500" : "text-red-500"}`} />
          <span className={muted}>Network</span>
          <strong className="ml-auto">{telemetry.online ? "Online" : "Offline"}</strong>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${telemetry.serverReachable === true ? "bg-emerald-500" : telemetry.serverReachable === false ? "bg-red-500" : "bg-slate-400"}`} />
          <span className={muted}>Application server</span>
          <strong className="ml-auto">{serverLabel}</strong>
        </div>
      </div>

      <div className="mt-3 space-y-2 text-xs">
        <div className="flex justify-between gap-3">
          <span className={muted}>Catalog received / committed</span>
          <strong>{telemetry.catalogReceived} / {telemetry.catalogCommitted}</strong>
        </div>
        <div className="flex justify-between gap-3">
          <span className={muted}>Catalog pages committed</span>
          <strong>{telemetry.catalogPages}</strong>
        </div>
        <div className="flex justify-between gap-3">
          <span className={muted}>Transactions / audits confirmed this run</span>
          <strong>{telemetry.transactionsConfirmed} / {telemetry.auditsConfirmed}</strong>
        </div>
        <div className="flex justify-between gap-3">
          <span className={muted}>Outbox pending / failed</span>
          <strong>{telemetry.outboxPending} / {telemetry.outboxFailed}</strong>
        </div>
        <div className="flex justify-between gap-3">
          <span className={muted}>Audits pending / failed</span>
          <strong>{telemetry.auditPending} / {telemetry.auditFailed}</strong>
        </div>
        <div className="flex justify-between gap-3">
          <span className={muted}>Inbox pending / received this run</span>
          <strong>{telemetry.inboxPending} / {telemetry.inboxReceived}</strong>
        </div>
      </div>

      <div className={`mt-3 space-y-1.5 border-t pt-3 text-[11px] ${rule} ${muted}`}>
        <Timestamp label="Last attempt" value={telemetry.lastAttemptAt} />
        <Timestamp label="Run started" value={telemetry.startedAt} />
        <Timestamp label="Last catalog sync" value={telemetry.lastCatalogSyncAt} />
        <Timestamp label="Last transaction sync" value={telemetry.lastTransactionSyncAt} />
        <Timestamp label="Last full success" value={telemetry.lastSuccessAt} />
        <Timestamp label="Last server contact" value={telemetry.lastServerContactAt} />
        {telemetry.retryAt && <Timestamp label="Next retry" value={telemetry.retryAt} />}
        {telemetry.progressAt && (
          <p className="flex justify-between gap-3">
            <span>Last progress</span>
            <span className="text-right">{cyprusTime(telemetry.progressAt)} · {progressAge.label} ago</span>
          </p>
        )}
      </div>

      {(telemetry.runId || telemetry.error) && (
        <div className={`mt-3 border-t pt-3 text-[11px] ${rule}`}>
          {telemetry.runId && (
            <p className={`truncate ${muted}`} title={telemetry.runId}>Run ID: {telemetry.runId}</p>
          )}
          <p className={muted}>
            Build {telemetry.buildVersion || "loading"} · install {telemetry.deviceId.slice(0, 8)}… · report #{telemetry.sequence}
          </p>
          {telemetry.error && (
            <p className="mt-1 flex items-center gap-1.5 font-mono text-red-500">
              <AlertCircleIcon className="h-3 w-3 shrink-0" />
              Diagnostic: {telemetry.error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Timestamp({ label, value }: { label: string; value: string | null }) {
  return (
    <p className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="text-right">{value ? cyprusTime(value) : "—"}</span>
    </p>
  );
}

function cyprusTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Nicosia",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function ageOf(value: string | null): { seconds: number | null; label: string } {
  if (!value) return { seconds: null, label: "not yet" };
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return { seconds: null, label: "unknown" };
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return { seconds, label: `${seconds}s` };
  if (seconds < 3600) return { seconds, label: `${Math.floor(seconds / 60)}m` };
  return { seconds, label: `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m` };
}