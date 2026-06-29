import { useQuery } from "@tanstack/react-query";
import type { PosLocation } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Loader2, Wifi, WifiOff, Monitor, Clock, Package } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Terminal = {
  id: string; name: string; code: string; locationId: string; locationName?: string;
  hardwareType: string; active: boolean; lastSeenAt?: string | null; lastSyncAt?: string | null;
  outboxQueueSize: number;
};

function OnlineChip({ lastSeenAt }: { lastSeenAt?: string | null }) {
  if (!lastSeenAt) return <Badge variant="secondary" className="gap-1"><WifiOff className="w-3 h-3" />Never seen</Badge>;
  const diff = Date.now() - new Date(lastSeenAt).getTime();
  const online = diff < 5 * 60 * 1000;
  return (
    <Badge variant={online ? "default" : "secondary"} className={`gap-1 ${online ? "bg-green-600" : ""}`}>
      {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
      {online ? "Online" : "Offline"}
    </Badge>
  );
}

export default function PosSyncMonitor() {
  const { data: terminals = [], isLoading } = useQuery<Terminal[]>({ queryKey: ["/api/pos/terminals"] });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });

  const onlineCount = terminals.filter(t => t.lastSeenAt && Date.now() - new Date(t.lastSeenAt).getTime() < 5 * 60 * 1000).length;
  const pendingTotal = terminals.reduce((s, t) => s + (t.outboxQueueSize || 0), 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="w-6 h-6" />Sync Monitor</h1>
        <p className="text-sm text-muted-foreground mt-1">Real-time status of all GlobiPOS terminals</p>
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

      {isLoading ? (
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
                  <th className="px-4 py-3 text-left">Last Seen</th>
                  <th className="px-4 py-3 text-left">Last Sync</th>
                  <th className="px-4 py-3 text-center">Outbox</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {terminals.map(t => (
                  <tr key={t.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-terminal-${t.id}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{t.code}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t.locationName || t.locationId}</td>
                    <td className="px-4 py-3 text-center"><OnlineChip lastSeenAt={t.lastSeenAt} /></td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {t.lastSeenAt ? (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(t.lastSeenAt), { addSuffix: true })}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {t.lastSyncAt ? formatDistanceToNow(new Date(t.lastSyncAt), { addSuffix: true }) : "—"}
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
