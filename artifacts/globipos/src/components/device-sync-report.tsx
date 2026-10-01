import type { DeviceSyncReport } from "@workspace/api-client-react";
import { Badge } from "./ui/badge";

const cyprus = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Nicosia", dateStyle: "short", timeStyle: "medium",
});

export function DeviceSyncReportView({ report, asOf }: { report: DeviceSyncReport; asOf?: string }) {
  const s = report.sync;
  const now = asOf ? Date.parse(asOf) : Date.now();
  const age = now - Date.parse(report.receivedAt);
  const inactive = !Number.isFinite(age) || age > 45_000 || age < -60_000;
  const stalled = s.syncing && s.progressAt && now - Date.parse(s.progressAt) > 60_000;
  const problem = !inactive && (s.phase === "failed" || s.phase === "partial" || s.phase === "interrupted" ||
    s.outboxFailed + s.auditFailed > 0 || s.serverReachable === false || !!stalled);
  const status = inactive ? "Inactive / stale" : stalled ? "Stalled" : problem ? "Needs attention" :
    s.syncing ? "Syncing" : s.phase === "complete" ? "Last run complete" : "No completed sync";

  function time(value: string | null | undefined) {
    return value && Number.isFinite(Date.parse(value)) ? cyprus.format(new Date(value)) : "Not yet";
  }

  return <div className="space-y-2 rounded-lg border border-border bg-background p-3 text-xs" data-testid="device-sync-report">
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={inactive ? "secondary" : problem ? "destructive" : "outline"}>{status}</Badge>
      <span className="capitalize text-muted-foreground">{s.platform} · {s.phase.replaceAll("-", " ")}</span>
      {s.buildVersion && <span className="text-muted-foreground">Build {s.buildVersion}</span>}
    </div>
    <p>Catalog: <strong>{s.catalogCommitted.toLocaleString()}</strong> records saved in {s.catalogPages.toLocaleString()} pages
      {" "}({s.catalogReceived.toLocaleString()} received)</p>
    <p>Queued bills: <strong>{s.transactionsConfirmed}</strong> server-acknowledged · {s.outboxPending} pending · {s.outboxFailed} failed</p>
    <p>Audit records: {s.auditsConfirmed} confirmed · {s.auditPending} pending · {s.auditFailed} failed</p>
    <p className="text-muted-foreground">Last device report {time(report.receivedAt)} · Latest progress {time(s.progressAt)}</p>
    <p className="text-muted-foreground">Last catalog {time(s.lastCatalogSyncAt)} · Last bill upload {time(s.lastTransactionSyncAt)}</p>
    <p className="text-muted-foreground">Last fully successful cycle {time(s.lastSuccessAt)} · Last verified server contact {time(s.lastServerContactAt)}</p>
    {s.error && <p className="text-destructive">A sync issue was reported. Check the terminal for details.</p>}
    {inactive && <p className="text-amber-700">Counts are from the last report, not verified live values. The installation itself may still be online.</p>}
    <p className="text-muted-foreground">Times: Cyprus. Catalog records are not physical stock transfers.</p>
  </div>;
}