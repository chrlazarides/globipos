/**
 * ScoMonitor — attendant monitoring panel for all self-checkout lanes.
 *
 * Polls GET /api/pos/sco/lanes every 10 seconds and shows each lane's
 * current mode, basket total and item count.  An "Assist" button per
 * lane opens the override-PIN flow, identical to the in-lane attendant
 * override, and an "Dismiss alert" button clears a flagged lane.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  MonitorSmartphone, ShoppingCart, AlertTriangle,
  Check, RefreshCw, X, UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { invoke } from "@tauri-apps/api/core";
import type { TerminalConfig } from "../types";

interface ScoLane {
  id: string;
  terminal_code: string;
  terminal_name: string;
  mode: string;          // "idle" | "scanning" | "payment" | "attendant_needed" | "age_check" | "done"
  items: number;
  total: number;
  attendant_reason?: string;
  last_seen_at: string;
}

interface ScoMonitorProps {
  config: TerminalConfig;
  onClose: () => void;
}

function fmt(n: number) { return `€${n.toFixed(2)}`; }

function modeBadge(mode: string) {
  switch (mode) {
    case "idle":             return <Badge variant="secondary">Idle</Badge>;
    case "scanning":         return <Badge className="bg-green-700 text-white">Scanning</Badge>;
    case "payment":          return <Badge className="bg-blue-600 text-white">Payment</Badge>;
    case "attendant_needed": return <Badge className="bg-red-600 text-white animate-pulse">Help!</Badge>;
    case "age_check":        return <Badge className="bg-amber-500 text-white animate-pulse">Age Check</Badge>;
    case "done":             return <Badge className="bg-emerald-600 text-white">Done</Badge>;
    default:                 return <Badge variant="outline">{mode}</Badge>;
  }
}

export default function ScoMonitor({ config, onClose }: ScoMonitorProps) {
  const [lanes, setLanes] = useState<ScoLane[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overrideLane, setOverrideLane] = useState<ScoLane | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLanes = useCallback(async () => {
    try {
      const base = config.server_url.replace(/\/$/, "");
      const resp = await fetch(`${base}/api/pos/sco/lanes`, {
        headers: { "X-Terminal-Code": config.terminal_code },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setLanes(data.lanes ?? []);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load SCO lanes");
    } finally {
      setLoading(false);
    }
  }, [config.server_url, config.terminal_code]);

  useEffect(() => {
    fetchLanes();
    timerRef.current = setInterval(fetchLanes, 10_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchLanes]);

  async function handleOverride() {
    if (!overrideLane || !pin) return;
    setPinError("");
    try {
      const session = await invoke<{ id: string; role: string } | null>("validate_pin", { pin });
      if (session) {
        // Notify server that this lane's alert has been acknowledged
        const base = config.server_url.replace(/\/$/, "");
        await fetch(`${base}/api/pos/sco/lanes/${overrideLane.terminal_code}/override`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Terminal-Code": config.terminal_code },
          body: JSON.stringify({ attendant_id: session.id, action: "override" }),
        }).catch(() => {});
        await invoke("write_audit", {
          cashierId: session.id,
          action: "sco_monitor_override",
          entity: overrideLane.terminal_code,
          detail: overrideLane.attendant_reason ?? "override",
        }).catch(() => {});
        setOverrideLane(null);
        setPin("");
        fetchLanes();
      } else {
        setPinError("Invalid PIN");
      }
    } catch {
      setPinError("PIN error");
    }
  }

  const alertLanes = lanes.filter((l) => l.mode === "attendant_needed" || l.mode === "age_check");

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <div className="bg-[#7c1d3f] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MonitorSmartphone className="h-5 w-5" />
          <span className="font-semibold text-lg">Self-Checkout Monitor</span>
          {alertLanes.length > 0 && (
            <Badge className="bg-red-600 text-white animate-pulse">{alertLanes.length} alert{alertLanes.length > 1 ? "s" : ""}</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" className="text-white/70 hover:text-white" onClick={fetchLanes}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" className="text-white/70 hover:text-white" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 p-6">
        {loading ? (
          <div className="text-center text-gray-400 py-16">Loading lanes…</div>
        ) : error ? (
          <div className="text-center text-red-400 py-16">{error}</div>
        ) : lanes.length === 0 ? (
          <div className="text-center text-gray-500 py-16">
            <MonitorSmartphone className="h-12 w-12 mx-auto mb-3 text-gray-700" />
            <p>No SCO terminals registered.</p>
            <p className="text-sm mt-1">Set terminal type to "sco" in Admin → POS Terminals.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {lanes.map((lane) => {
              const needsHelp = lane.mode === "attendant_needed" || lane.mode === "age_check";
              return (
                <div
                  key={lane.id}
                  className={`rounded-2xl border p-5 space-y-3 transition-shadow ${
                    needsHelp
                      ? "border-red-500 bg-red-950/50 shadow-lg shadow-red-900/40"
                      : "border-gray-800 bg-gray-900"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{lane.terminal_name}</p>
                      <p className="text-xs text-gray-500 font-mono">{lane.terminal_code}</p>
                    </div>
                    {modeBadge(lane.mode)}
                  </div>

                  {needsHelp && lane.attendant_reason && (
                    <div className="flex items-center gap-2 text-amber-400 text-sm bg-amber-950/40 rounded-lg px-3 py-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>{lane.attendant_reason.replace(/_/g, " ")}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-800/60 rounded-lg p-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5 text-gray-400 mb-0.5">
                        <ShoppingCart className="h-3.5 w-3.5" />
                        <span className="text-xs uppercase tracking-wide">Items</span>
                      </div>
                      <p className="text-white font-bold text-lg">{lane.items}</p>
                    </div>
                    <div className="bg-gray-800/60 rounded-lg p-2.5 text-center">
                      <div className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Total</div>
                      <p className="text-white font-bold text-lg">{fmt(lane.total)}</p>
                    </div>
                  </div>

                  <div className="text-xs text-gray-600 text-right">
                    Last seen {new Date(lane.last_seen_at).toLocaleTimeString()}
                  </div>

                  {needsHelp ? (
                    <Button
                      className="w-full bg-red-700 hover:bg-red-600"
                      onClick={() => { setOverrideLane(lane); setPin(""); setPinError(""); }}
                    >
                      <UserCheck className="h-4 w-4 mr-1.5" /> Assist Lane
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1.5 text-green-600 text-xs">
                      <Check className="h-3.5 w-3.5" /> No issues
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Override PIN modal */}
      {overrideLane && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-xs p-6 shadow-2xl space-y-4">
            <h2 className="text-white font-semibold">Assist: {overrideLane.terminal_name}</h2>
            <p className="text-gray-400 text-sm">
              {overrideLane.attendant_reason?.replace(/_/g, " ") ?? "Override required"}
            </p>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Attendant PIN</label>
              <input
                type="password"
                inputMode="numeric"
                data-testid="input-sco-override-pin"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-burgundy-500"
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleOverride()}
                autoFocus
              />
              {pinError && <p className="text-xs text-red-400">{pinError}</p>}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setOverrideLane(null)}>
                Cancel
              </Button>
              <Button className="flex-1 bg-[#7c1d3f] hover:bg-[#6b1836]" onClick={handleOverride} disabled={!pin}>
                <UserCheck className="h-4 w-4 mr-1.5" /> Override
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
