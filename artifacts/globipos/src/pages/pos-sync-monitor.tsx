import { useQuery } from "@tanstack/react-query";
import type { PosLocation } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Loader2, Wifi, WifiOff, Monitor, Clock, Package } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PosHeartbeatIndicator, type PeripheralStatusLike } from "@/components/pos-heartbeat-indicator";
import { DeviceSyncReportView } from "@/components/device-sync-report";
import type { DeviceSyncReport, PosSyncSnapshot } from "@workspace/api-client-react";

type Terminal = {
  id: string; name: string; code: string; locationId: string; locationName?: string;
  hardwareType: string; active: boolean; lastSeenAt?: string | null; lastSyncAt?: string | null;
  outboxQueueSize: number; peripheralStatus?: (PeripheralStatusLike & {
    sync?: PosSyncSnapshot & { receivedAt: string };
    syncDevices?: Record<string, PosSyncSnapshot & { receivedAt: string }>;
  }) | null;
};

function isOnline(lastSeenAt?: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 45_000;
}

function OnlineChip({ lastSeenAt }: { lastSeenAt?: string | null }) {
  if (!lastSeenAt) return <Badge variant="secondary" className="gap-1"><WifiOff className="w-3 h-3" />Never seen</Badge>;
  const diff = Date.now() - new Date(lastSeenAt).getTime();
  const online = diff < 45_000;
  return (
    <Badge variant={online ? "default" : "secondary"} className={`gap-1 ${online ? "bg-green-600" : ""}`}>
      {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
      {online ? "Online" : "Offline"}
    </Badge>
  );
}

export default function PosSyncMonitor() {
  const { data: terminals = [], isLoading, isError, fetchStatus } = useQuery<Terminal[]>({
    queryKey: ["/api/pos/terminals"], refetchInterval: 10_000,
  });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });

  const onlineCount = terminals.filter(t => isOnline(t.lastSeenAt)).length;
  const pendingTotal = terminals.reduce((s, t) => s + (t.outboxQueueSize || 0), 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="w-6 h-6" />Sync Monitor</h1>
        <p className="text-sm text-muted-foreground mt-1">Device-reported progress, last sync and pending work. Inactive devices show their last known values.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                <Wifi className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{onlineCount}</p>
                <p className="text-xs text-muted-foreground">Online terminals</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Monitor className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{terminals.length}</p>
                <p className="text-xs text-muted-foreground">Total terminals</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${pendingTotal > 0 ? "bg-amber-100 dark:bg-amber-900/40" : "bg-muted"}`}>
                <Package className={`w-5 h-5 ${pendingTotal > 0 ? "text-amber-600" : "text-muted-foreground"}`} />
              </div>
              <div>
                <p className="text-2xl font-bold">{pendingTotal}</p>
                <p className="text-xs text-muted-foreground">Bills pending sync</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {(isError || fetchStatus === "paused") && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Monitoring is unavailable. Any displayed counts are last-known observations, not verified live values.</p>}
      {isError && terminals.length === 0 ? null : isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : terminals.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Monitor className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No terminals configured</p>
            <p className="text-sm mt-1">Add terminals in the Terminals page first.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Terminal Status</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Terminal</th>
                  <th className="px-4 py-3 text-left">Location</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Heartbeat</th>
                  <th className="px-4 py-3 text-left">Last Seen</th>
                  <th className="px-4 py-3 text-left">Completed Cycle</th>
                  <th className="px-4 py-3 text-center">Outbox</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {terminals.map(t => (
                  <tr key={t.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-terminal-${t.id}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{t.code}</div>
                      {(() => {
                        const devices = t.peripheralStatus?.syncDevices
                          ? Object.values(t.peripheralStatus.syncDevices)
                          : t.peripheralStatus?.sync ? [t.peripheralStatus.sync] : [];
                        return devices.length ? <details className="mt-2 min-w-60">
                          <summary className="cursor-pointer text-xs font-medium text-primary">Live sync details · {devices.length} device{devices.length === 1 ? "" : "s"}</summary>
                          <div className="mt-2 space-y-2">
                            {devices.map(device => <DeviceSyncReportView key={device.deviceId} report={{
                              terminalId: t.id, terminalName: t.name, receivedAt: device.receivedAt, sync: device,
                            } satisfies DeviceSyncReport} />)}
                          </div>
                        </details> : <p className="mt-1 text-xs text-muted-foreground">No device sync report yet</p>;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t.locationName || t.locationId}</td>
                    <td className="px-4 py-3 text-center"><OnlineChip lastSeenAt={t.lastSeenAt} /></td>
                    <td className="px-4 py-3 text-center">
                      <PosHeartbeatIndicator online={isOnline(t.lastSeenAt)} peripheralStatus={t.peripheralStatus ?? null} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {t.lastSeenAt ? (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(t.lastSeenAt), { addSuffix: true })}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {t.peripheralStatus?.sync?.lastSuccessAt
                        ? formatDistanceToNow(new Date(t.peripheralStatus.sync.lastSuccessAt), { addSuffix: true })
                        : "Not reported"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {t.outboxQueueSize > 0 ? (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">{t.outboxQueueSize}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
