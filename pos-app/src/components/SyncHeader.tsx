import { useState, useEffect } from "react";
import { WifiIcon, WifiOffIcon, Loader2Icon, ClockIcon, RefreshCwIcon, PackageIcon } from "lucide-react";
import type { SyncStatus, TerminalConfig, CashierSession } from "../types";

interface SyncHeaderProps {
  config: TerminalConfig;
  session: CashierSession;
  syncStatus: SyncStatus;
  notifications: Array<{ id: string; message_type: string; payload: string }>;
  onSyncCatalog: () => Promise<void>;
  onLogout: () => void;
}

export function SyncHeader({
  config,
  session,
  syncStatus,
  notifications,
  onSyncCatalog,
  onLogout,
}: SyncHeaderProps) {
  const [clock, setClock] = useState<string>(formatTime());

  useEffect(() => {
    const t = setInterval(() => setClock(formatTime()), 1000);
    return () => clearInterval(t);
  }, []);

  const { online, syncing, outbox_pending, outbox_failed } = syncStatus;

  const statusColor = !online
    ? "text-red-400"
    : syncing
    ? "text-amber-400"
    : "text-green-400";

  const StatusIcon = !online ? WifiOffIcon : syncing ? Loader2Icon : WifiIcon;

  return (
    <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-4 select-none">
      {/* Brand */}
      <span className="text-burgundy-400 font-bold text-base tracking-tight">GlobiPOS</span>

      {/* Terminal + location */}
      <div className="flex items-center gap-1.5 text-gray-300 text-sm">
        <span className="font-medium">{config.terminal_name}</span>
        <span className="text-gray-600">·</span>
        <span className="text-gray-400">{config.location_name}</span>
      </div>

      <div className="flex-1" />

      {/* Outbox queue */}
      {(outbox_pending > 0 || outbox_failed > 0) && (
        <div className="flex items-center gap-1.5" title={`${outbox_pending} pending, ${outbox_failed} failed`}>
          <PackageIcon className={`w-3.5 h-3.5 ${outbox_failed > 0 ? "text-red-400" : "text-amber-400"}`} />
          <span className={`text-xs font-medium ${outbox_failed > 0 ? "text-red-400" : "text-amber-400"}`}>
            {outbox_pending + outbox_failed}
          </span>
        </div>
      )}

      {/* Inbox notifications badge */}
      {notifications.length > 0 && (
        <div className="bg-burgundy-700 text-white text-xs font-bold px-2 py-0.5 rounded-full">
          {notifications.length}
        </div>
      )}

      {/* Sync button */}
      <button
        onClick={onSyncCatalog}
        disabled={syncing}
        title="Sync catalog now"
        className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
      >
        <RefreshCwIcon className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
      </button>

      {/* Sync status dot */}
      <div className={`flex items-center gap-1.5 ${statusColor}`} title={online ? (syncing ? "Syncing…" : "Online") : "Offline"}>
        <StatusIcon className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
        <span className="text-xs font-medium">{online ? (syncing ? "Syncing" : "Online") : "Offline"}</span>
      </div>

      {/* Cashier */}
      <div className="flex items-center gap-2 border-l border-gray-800 pl-4">
        <div className="w-6 h-6 bg-burgundy-800 rounded-full flex items-center justify-center text-white text-xs font-bold">
          {session.cashier_name.charAt(0).toUpperCase()}
        </div>
        <span className="text-gray-300 text-sm">{session.cashier_name}</span>
        <button
          onClick={onLogout}
          className="text-gray-600 hover:text-gray-300 text-xs transition-colors ml-1"
          title="Switch cashier"
        >
          ×
        </button>
      </div>

      {/* Clock */}
      <div className="flex items-center gap-1.5 text-gray-400 text-sm font-mono border-l border-gray-800 pl-4">
        <ClockIcon className="w-3.5 h-3.5" />
        {clock}
      </div>
    </header>
  );
}

function formatTime(): string {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
