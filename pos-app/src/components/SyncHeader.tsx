import { useState, useEffect, useRef } from "react";
import { WifiIcon, WifiOffIcon, Loader2Icon, ClockIcon, RefreshCwIcon, PackageIcon, SunIcon, MoonIcon, PrinterIcon, ActivityIcon } from "lucide-react";
import type { SyncStatus, SyncTelemetry, TerminalConfig, CashierSession, PeripheralHealth } from "../types";
import type { PosUiTheme } from "../hooks/usePosTheme";
import { HeartbeatIndicator } from "./HeartbeatIndicator";
import { SyncObservabilityPanel } from "./SyncObservabilityPanel";
import { DeviceKeyDialog } from "./DeviceKeyDialog";
import type { DeviceStatus } from "../hooks/useHardware";

interface SyncHeaderProps {
  config: TerminalConfig;
  session: CashierSession;
  syncStatus: SyncStatus;
  syncTelemetry: SyncTelemetry;
  syncNowBusy: boolean;
  peripheralHealth: PeripheralHealth | null;
  notifications: Array<{ id: string; message_type: string; payload: string }>;
  theme: PosUiTheme;
  onToggleTheme: () => void;
  onSyncCatalog: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onLogout: () => void;
  printerStatus?: DeviceStatus;
  printerEnabled?: boolean;
}

export function SyncHeader({
  config,
  session,
  syncStatus,
  syncTelemetry,
  syncNowBusy,
  peripheralHealth,
  notifications,
  theme,
  onToggleTheme,
  onSyncCatalog,
  onSyncNow,
  onLogout,
  printerStatus = "unknown",
  printerEnabled = false,
}: SyncHeaderProps) {
  const [clock, setClock] = useState<string>(formatTime());
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const syncPanelRef = useRef<HTMLDivElement>(null);
  const syncButtonRef = useRef<HTMLButtonElement>(null);
  const [deviceKeyOpen, setDeviceKeyOpen] = useState(false);
  const isLight = theme === "light";

  useEffect(() => {
    if (!syncPanelOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !syncPanelRef.current?.contains(event.target)) {
        setSyncPanelOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSyncPanelOpen(false);
        syncButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [syncPanelOpen]);

  useEffect(() => {
    const t = setInterval(() => setClock(formatTime()), 1000);
    return () => clearInterval(t);
  }, []);

  const { online: serverOnline, outbox_pending, outbox_failed } = syncStatus;
  const networkOnline = syncTelemetry.online;
  const syncing = syncTelemetry.syncing;

  const statusColor = !networkOnline
    ? "text-red-500"
    : syncing
    ? "text-amber-500"
    : isLight ? "text-emerald-600" : "text-green-400";

  const StatusIcon = !networkOnline ? WifiOffIcon : syncing ? Loader2Icon : WifiIcon;

  const headerClass = isLight
    ? "h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-4 select-none shadow-sm"
    : "h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-4 select-none";
  const dividerClass = isLight ? "border-slate-200" : "border-gray-800";
  const mutedText = isLight ? "text-slate-500" : "text-gray-500";
  const mutedTextHover = isLight ? "text-slate-500 hover:text-slate-800" : "text-gray-500 hover:text-gray-300";
  const primaryText = isLight ? "text-slate-700" : "text-gray-300";

  return (
    <header className={headerClass}>
      {/* Brand */}
      <span className="text-burgundy-500 font-bold text-base tracking-tight">GlobiPOS</span>

      {/* Terminal + location */}
      <div className={`flex items-center gap-1.5 ${primaryText} text-sm`}>
        <span className="font-medium">{config.terminal_name}</span>
        <span className={mutedText}>·</span>
        <span className={mutedText}>{config.location_name}</span>
      </div>

      <div className="flex-1" />

      {/* Outbox queue */}
      {(outbox_pending > 0 || outbox_failed > 0) && (
        <div className="flex items-center gap-1.5" title={`${outbox_pending} pending, ${outbox_failed} failed`}>
          <PackageIcon className={`w-3.5 h-3.5 ${outbox_failed > 0 ? "text-red-500" : "text-amber-500"}`} />
          <span className={`text-xs font-medium ${outbox_failed > 0 ? "text-red-500" : "text-amber-500"}`}>
            {outbox_pending + outbox_failed}
          </span>
        </div>
      )}

      {/* Inbox notifications badge */}
      {notifications.length > 0 && (
        <div className="bg-burgundy-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
          {notifications.length}
        </div>
      )}

      <button
        onClick={() => setDeviceKeyOpen(true)}
        title={config.voucher_device_key ? "Device key saved - edit" : "Device key missing - set"}
        className={`px-2 py-1 rounded-lg text-xs transition-colors ${config.voucher_device_key ? "text-gray-500 hover:bg-gray-800 hover:text-gray-200" : "text-amber-400 hover:bg-gray-800"}`}
        data-testid="button-device-key"
      >
        Device key
      </button>
      {deviceKeyOpen && <DeviceKeyDialog config={config} hasKey={!!config.voucher_device_key} onClose={() => setDeviceKeyOpen(false)} />}

      {/* Theme toggle */}
      <button
        onClick={onToggleTheme}
        title={isLight ? "Switch to dark theme" : "Switch to light theme"}
        className={`p-1.5 rounded-lg transition-colors ${isLight ? "text-slate-500 hover:bg-slate-100 hover:text-slate-800" : "text-gray-500 hover:bg-gray-800 hover:text-gray-200"}`}
        data-testid="button-toggle-theme"
      >
        {isLight ? <MoonIcon className="w-3.5 h-3.5" /> : <SunIcon className="w-3.5 h-3.5" />}
      </button>

      {/* Sync button */}
      <div className="relative" ref={syncPanelRef}>
        <button
          ref={syncButtonRef}
          type="button"
          onClick={() => setSyncPanelOpen((open) => !open)}
          aria-expanded={syncPanelOpen}
          aria-label="Open live sync details"
          title="Live sync details"
          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${mutedTextHover}`}
          data-testid="button-sync-details"
        >
          <ActivityIcon className={`w-3.5 h-3.5 ${syncTelemetry.syncing ? "text-amber-500" : ""}`} />
          <span>Sync</span>
          {(syncTelemetry.outboxPending + syncTelemetry.outboxFailed) > 0 && (
            <span className={`min-w-4 rounded-full px-1 text-center text-[10px] ${syncTelemetry.outboxFailed > 0 ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-500"}`}>
              {syncTelemetry.outboxPending + syncTelemetry.outboxFailed}
            </span>
          )}
        </button>
        {syncPanelOpen && (
          <SyncObservabilityPanel
            telemetry={syncTelemetry}
            isLight={isLight}
            busy={syncNowBusy}
            onSyncNow={onSyncNow}
            onClose={() => {
              setSyncPanelOpen(false);
              syncButtonRef.current?.focus();
            }}
          />
        )}
      </div>

      {/* Sync catalog shortcut */}
      <button
        onClick={onSyncCatalog}
        disabled={syncing}
        title="Sync catalog now"
        className={`p-1.5 transition-colors disabled:opacity-40 ${mutedTextHover}`}
      >
        <RefreshCwIcon className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
      </button>

      {/* Sync status dot */}
      <div className={`flex items-center gap-1.5 ${statusColor}`} title={`Network ${networkOnline ? "online" : "offline"}${syncing ? " · sync running" : ""}`}>
        <StatusIcon className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
        <span className="text-xs font-medium">Network {networkOnline ? "online" : "offline"}</span>
      </div>

      {/* Heartbeat / peripheral health indicator */}
      <HeartbeatIndicator
        online={syncTelemetry.serverReachable ?? serverOnline}
        peripheralHealth={peripheralHealth}
        isLight={isLight}
      />

      {/* Receipt readiness is deliberately separate from network status. */}
      <div
        className={`flex items-center gap-1.5 text-xs font-medium ${
          !printerEnabled ? mutedText : printerStatus === "online" ? (isLight ? "text-emerald-600" : "text-green-400") : printerStatus === "busy" ? "text-amber-500" : "text-red-500"
        }`}
        title={!printerEnabled ? "Receipt printer not enabled" : `Receipt printer ${printerStatus}`}
        data-testid="status-receipt-printer"
      >
        <PrinterIcon className="w-3.5 h-3.5" />
        <span>{!printerEnabled ? "Receipt off" : printerStatus === "online" ? "Receipt ready" : printerStatus === "busy" ? "Printing" : "Receipt offline"}</span>
      </div>

      {/* Cashier */}
      <div className={`flex items-center gap-2 border-l pl-4 ${dividerClass}`}>
        <div className="w-6 h-6 bg-burgundy-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
          {session.cashier_name.charAt(0).toUpperCase()}
        </div>
        <span className={`${primaryText} text-sm`}>{session.cashier_name}</span>
        <button
          onClick={onLogout}
          className={`text-xs transition-colors ml-1 ${mutedTextHover}`}
          title="Switch cashier"
        >
          ×
        </button>
      </div>

      {/* Clock */}
      <div className={`flex items-center gap-1.5 text-sm font-mono border-l pl-4 ${dividerClass} ${mutedText}`}>
        <ClockIcon className="w-3.5 h-3.5" />
        {clock}
      </div>
    </header>
  );
}

function formatTime(): string {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
