import { useState, useEffect } from "react";
import { WifiIcon, WifiOffIcon, Loader2Icon, ClockIcon, RefreshCwIcon, PackageIcon, SunIcon, MoonIcon } from "lucide-react";
import type { SyncStatus, TerminalConfig, CashierSession } from "../types";
import type { PosUiTheme } from "../hooks/usePosTheme";

interface SyncHeaderProps {
  config: TerminalConfig;
  session: CashierSession;
  syncStatus: SyncStatus;
  notifications: Array<{ id: string; message_type: string; payload: string }>;
  theme: PosUiTheme;
  onToggleTheme: () => void;
  onSyncCatalog: () => Promise<void>;
  onLogout: () => void;
}

export function SyncHeader({
  config,
  session,
  syncStatus,
  notifications,
  theme,
  onToggleTheme,
  onSyncCatalog,
  onLogout,
}: SyncHeaderProps) {
  const [clock, setClock] = useState<string>(formatTime());
  const isLight = theme === "light";

  useEffect(() => {
    const t = setInterval(() => setClock(formatTime()), 1000);
    return () => clearInterval(t);
  }, []);

  const { online, syncing, outbox_pending, outbox_failed } = syncStatus;

  const statusColor = !online
    ? "text-red-500"
    : syncing
    ? "text-amber-500"
    : isLight ? "text-emerald-600" : "text-green-400";

  const StatusIcon = !online ? WifiOffIcon : syncing ? Loader2Icon : WifiIcon;

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
      <button
        onClick={onSyncCatalog}
        disabled={syncing}
        title="Sync catalog now"
        className={`p-1.5 transition-colors disabled:opacity-40 ${mutedTextHover}`}
      >
        <RefreshCwIcon className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
      </button>

      {/* Sync status dot */}
      <div className={`flex items-center gap-1.5 ${statusColor}`} title={online ? (syncing ? "Syncing…" : "Online") : "Offline"}>
        <StatusIcon className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
        <span className="text-xs font-medium">{online ? (syncing ? "Syncing" : "Online") : "Offline"}</span>
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
