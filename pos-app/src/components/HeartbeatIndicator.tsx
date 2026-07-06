import { useState } from "react";
import { HeartPulseIcon, PrinterIcon, PackageIcon, ScaleIcon, CreditCardIcon, MonitorIcon } from "lucide-react";
import type { PeripheralHealth } from "../types";

interface HeartbeatIndicatorProps {
  online: boolean;
  peripheralHealth: PeripheralHealth | null;
  isLight: boolean;
}

type HealthLevel = "ok" | "warn" | "error";

interface PeripheralRow {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  level: HealthLevel;
  detail: string;
}

function buildRows(health: PeripheralHealth | null): PeripheralRow[] {
  if (!health) return [];
  const rows: PeripheralRow[] = [];

  if (health.printer) {
    rows.push({
      key: "printer",
      label: "Printer",
      icon: PrinterIcon,
      level: health.printer === "online" ? "ok" : health.printer === "error" ? "error" : "warn",
      detail: health.printer,
    });
  }
  if (health.drawer) {
    rows.push({
      key: "drawer",
      label: "Cash drawer",
      icon: PackageIcon,
      level: health.drawer === "ok" ? "ok" : "error",
      detail: health.drawer,
    });
  }
  if (health.scale) {
    rows.push({
      key: "scale",
      label: "Scale",
      icon: ScaleIcon,
      level: health.scale === "connected" ? "ok" : health.scale === "error" ? "error" : "warn",
      detail: health.scale,
    });
  }
  if (health.card_terminal) {
    rows.push({
      key: "card_terminal",
      label: "Card terminal",
      icon: CreditCardIcon,
      level: health.card_terminal === "connected" ? "ok" : health.card_terminal === "error" ? "error" : "warn",
      detail: health.card_terminal,
    });
  }
  if (health.customer_display) {
    rows.push({
      key: "customer_display",
      label: "Customer display",
      icon: MonitorIcon,
      level: health.customer_display === "ok" ? "ok" : "error",
      detail: health.customer_display,
    });
  }

  return rows;
}

function aggregateLevel(online: boolean, rows: PeripheralRow[]): HealthLevel {
  if (!online) return "error";
  if (rows.some((r) => r.level === "error")) return "error";
  if (rows.some((r) => r.level === "warn")) return "warn";
  return "ok";
}

/**
 * Icon-based heartbeat indicator: a single pulsing heart icon whose color
 * aggregates connectivity (sync online/offline) with peripheral health
 * (printer/drawer/scale/card terminal/customer display) reported by the
 * last Tauri heartbeat. Hover reveals the per-peripheral breakdown — the
 * same breakdown shown on the back-office Terminal Hub, so cashiers and
 * managers see one consistent picture of terminal health.
 */
export function HeartbeatIndicator({ online, peripheralHealth, isLight }: HeartbeatIndicatorProps) {
  const [open, setOpen] = useState(false);
  const rows = buildRows(peripheralHealth);
  const level = aggregateLevel(online, rows);

  const colorClass =
    level === "ok" ? (isLight ? "text-emerald-600" : "text-green-400")
    : level === "warn" ? "text-amber-500"
    : "text-red-500";

  const dotColorClass =
    level === "ok" ? "bg-emerald-500"
    : level === "warn" ? "bg-amber-500"
    : "bg-red-500";

  const panelClass = isLight
    ? "bg-white border border-slate-200 text-slate-700 shadow-lg"
    : "bg-gray-900 border border-gray-800 text-gray-200 shadow-lg";
  const panelMuted = isLight ? "text-slate-500" : "text-gray-500";

  const levelColorClass = (l: HealthLevel) =>
    l === "ok" ? "text-emerald-500" : l === "warn" ? "text-amber-500" : "text-red-500";

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={`relative flex items-center justify-center p-1.5 rounded-lg transition-colors ${colorClass}`}
        title={online ? "Terminal & peripheral health" : "Terminal offline"}
        data-testid="button-heartbeat-indicator"
      >
        <HeartPulseIcon className={`w-4 h-4 ${online ? "animate-pulse" : ""}`} />
        <span
          className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ${isLight ? "ring-white" : "ring-gray-900"} ${dotColorClass}`}
          data-testid="status-heartbeat-dot"
        />
      </button>

      {open && (
        <div
          className={`absolute top-full right-0 mt-2 w-64 rounded-lg p-3 z-50 ${panelClass}`}
          data-testid="panel-heartbeat-details"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide">Terminal Health</span>
            <span className={`text-[10px] font-medium ${online ? "text-emerald-500" : "text-red-500"}`}>
              {online ? "Online" : "Offline"}
            </span>
          </div>
          {rows.length === 0 ? (
            <p className={`text-xs ${panelMuted}`}>No peripherals configured</p>
          ) : (
            <div className="space-y-1.5">
              {rows.map((r) => (
                <div key={r.key} className="flex items-center justify-between text-xs" data-testid={`row-peripheral-${r.key}`}>
                  <div className="flex items-center gap-1.5">
                    <r.icon className={`w-3 h-3 ${levelColorClass(r.level)}`} />
                    <span>{r.label}</span>
                  </div>
                  <span className={`font-medium ${levelColorClass(r.level)}`}>{r.detail}</span>
                </div>
              ))}
            </div>
          )}
          {peripheralHealth?.reported_at && (
            <p className={`text-[10px] mt-2 pt-2 border-t ${isLight ? "border-slate-200" : "border-gray-800"} ${panelMuted}`}>
              Last report: {new Date(peripheralHealth.reported_at).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
