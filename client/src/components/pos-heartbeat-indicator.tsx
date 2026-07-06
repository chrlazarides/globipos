import { HeartPulse, Printer, Package, Scale, CreditCard, MonitorSmartphone } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Mirrors the pos-app HeartbeatIndicator's aggregation so the back office
// shows the same icon language for terminal + peripheral health.
export interface PeripheralStatusLike {
  printer?: "online" | "offline" | "error" | "unknown";
  drawer?: "ok" | "error" | "unknown";
  scale?: "connected" | "disconnected" | "error" | "unknown";
  card_terminal?: "connected" | "disconnected" | "error" | "unknown";
  customer_display?: "ok" | "error" | "unknown";
  reported_at?: string;
}

type HealthLevel = "ok" | "warn" | "error";

function buildRows(status: PeripheralStatusLike | null) {
  const s = status ?? {};
  const rows: { key: string; label: string; icon: React.ComponentType<{ className?: string }>; level: HealthLevel; detail: string }[] = [];

  if (s.printer && s.printer !== "unknown") rows.push({ key: "printer", label: "Printer", icon: Printer, level: s.printer === "online" ? "ok" : s.printer === "error" ? "error" : "warn", detail: s.printer });
  if (s.drawer && s.drawer !== "unknown") rows.push({ key: "drawer", label: "Cash drawer", icon: Package, level: s.drawer === "ok" ? "ok" : "error", detail: s.drawer });
  if (s.scale && s.scale !== "unknown") rows.push({ key: "scale", label: "Scale", icon: Scale, level: s.scale === "connected" ? "ok" : s.scale === "error" ? "error" : "warn", detail: s.scale });
  if (s.card_terminal && s.card_terminal !== "unknown") rows.push({ key: "card_terminal", label: "Card terminal", icon: CreditCard, level: s.card_terminal === "connected" ? "ok" : s.card_terminal === "error" ? "error" : "warn", detail: s.card_terminal });
  if (s.customer_display && s.customer_display !== "unknown") rows.push({ key: "customer_display", label: "Customer display", icon: MonitorSmartphone, level: s.customer_display === "ok" ? "ok" : "error", detail: s.customer_display });

  return rows;
}

function aggregateLevel(online: boolean, rows: ReturnType<typeof buildRows>): HealthLevel {
  if (!online) return "error";
  if (rows.some(r => r.level === "error")) return "error";
  if (rows.some(r => r.level === "warn")) return "warn";
  return "ok";
}

const levelTextClass = (l: HealthLevel) =>
  l === "ok" ? "text-green-500" : l === "warn" ? "text-amber-500" : "text-red-500";

/**
 * Compact icon-based heartbeat indicator for the back-office dashboards
 * (Terminal Hub, Sync Monitor). Same aggregation logic and color language
 * as the pos-app's SyncHeader heartbeat icon, driven by the peripheralStatus
 * JSON now reported on every Tauri heartbeat.
 */
export function PosHeartbeatIndicator({
  online,
  peripheralStatus,
  size = "sm",
}: {
  online: boolean;
  peripheralStatus: PeripheralStatusLike | null;
  size?: "sm" | "md";
}) {
  const rows = buildRows(peripheralStatus);
  const level = aggregateLevel(online, rows);
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center ${levelTextClass(level)}`} data-testid="indicator-heartbeat">
          <HeartPulse className={`${iconSize} ${online ? "animate-pulse" : ""}`} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="p-2">
        <div className="space-y-1 min-w-[160px]">
          <p className={`text-xs font-semibold ${online ? "text-green-500" : "text-red-500"}`}>
            {online ? "Online" : "Offline"}
          </p>
          {rows.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No peripherals configured</p>
          ) : (
            rows.map(r => (
              <div key={r.key} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="flex items-center gap-1">
                  <r.icon className={`w-2.5 h-2.5 ${levelTextClass(r.level)}`} />
                  {r.label}
                </span>
                <span className={`font-medium ${levelTextClass(r.level)}`}>{r.detail}</span>
              </div>
            ))
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
