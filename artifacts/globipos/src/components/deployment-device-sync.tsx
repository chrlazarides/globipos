import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DeploymentDeviceSyncResponse } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { DeviceSyncReportView } from "./device-sync-report";

export function DeploymentDeviceSync({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const { data, isPending, isError, fetchStatus } = useQuery<DeploymentDeviceSyncResponse>({
    queryKey: [`/api/control/deployments/${id}/device-sync`], enabled: open,
    refetchInterval: open ? 10_000 : false,
  });
  const heartbeatAge = data?.lastInstallationHeartbeatAt
    ? Date.parse(data.asOf) - Date.parse(data.lastInstallationHeartbeatAt) : Infinity;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="ghost" size="sm">POS sync</Button></DialogTrigger>
    <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{name} · device sync</DialogTitle>
        <DialogDescription>Last reported device observations. No POS device needs a connection to this master to keep trading.</DialogDescription>
      </DialogHeader>
      {isPending && <p className="text-sm text-muted-foreground">Loading device reports…</p>}
      {(isError || fetchStatus === "paused") && <p className="text-sm text-destructive">Monitoring unavailable. Cached observations are not verified live data.</p>}
      {data && <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Installation contact: {heartbeatAge < 90_000 && heartbeatAge >= -60_000 ? "recent" : "stale or not connected"}.
          {" "}Device freshness is separate from installation health.
        </p>
        {data.devices.length === 0
          ? <p className="text-sm text-muted-foreground">No device sync reports received for this deployment.</p>
          : data.devices.map(report => <div key={`${report.terminalId}:${report.sync.deviceId}`}>
            <p className="mb-1 text-sm font-medium">{report.terminalName || report.terminalId}</p>
            <DeviceSyncReportView report={report} asOf={data.asOf} />
          </div>)}
      </div>}
    </DialogContent>
  </Dialog>;
}