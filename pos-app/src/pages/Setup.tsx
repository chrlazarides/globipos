import { useState } from "react";
import { WifiIcon, ServerIcon, KeyIcon, CheckCircleIcon, AlertCircleIcon, Loader2Icon } from "lucide-react";
import type { TerminalConfig } from "../types";
import { registerTerminal } from "../lib/db";
import { buildInfo } from "../lib/build-info";
import { invoke } from "@tauri-apps/api/core";
import { writeDeviceKey } from "../lib/deviceKey";

interface SetupProps {
  onComplete: (config: TerminalConfig) => void;
  initialConfig?: TerminalConfig | null;
  onCancel?: () => void;
}

export function Setup({ onComplete, initialConfig, onCancel }: SetupProps) {
  const [serverUrl, setServerUrl]   = useState(initialConfig?.server_url ?? "http://");
  const [termCode, setTermCode]     = useState(initialConfig?.terminal_code ?? "");
  const [deviceKey, setDeviceKey]   = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [step, setStep]             = useState<"form" | "testing" | "done" | "restart">("form");
  const [registeredConfig, setRegisteredConfig] = useState<TerminalConfig | null>(null);

  async function handleRegister() {
    let validUrl = false;
    try {
      const url = new URL(serverUrl.trim());
      validUrl = ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { /* show validation below */ }
    if (!validUrl || !termCode.trim()) {
      setError("Please enter a valid server URL and terminal code.");
      return;
    }
    setError(null);
    setLoading(true);
    setStep("testing");
    try {
      const cfg = await registerTerminal(serverUrl.trim(), termCode.trim().toUpperCase());
      if (cfg.restart_required) {
        setRegisteredConfig(cfg);
        setStep("restart");
        return;
      }
      if (deviceKey.trim()) await writeDeviceKey(deviceKey.trim(), cfg);
      setStep("done");
      setTimeout(() => onComplete(deviceKey.trim() ? { ...cfg, voucher_device_key: deviceKey.trim() } : cfg), 800);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStep("form");
    } finally {
      setLoading(false);
    }
  }

  async function restart() {
    if (!registeredConfig || loading) return;
    setLoading(true);
    setError(null);
    try {
      if (deviceKey.trim()) await writeDeviceKey(deviceKey.trim(), registeredConfig);
      await invoke("restart_pos");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-burgundy-700 rounded-2xl mb-4 shadow-lg">
            <WifiIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">GlobiPOS</h1>
          <p className="text-gray-400 mt-1">{initialConfig ? "Configure / Switch Terminal" : "Terminal Setup"}</p>
        </div>

        <div className="bg-gray-900 rounded-2xl border border-gray-800 shadow-xl p-8 space-y-6">
          {step === "restart" ? (
            <div className="space-y-4 text-center">
              <CheckCircleIcon className="mx-auto h-12 w-12 text-green-400" />
              <p className="font-semibold text-white">Terminal setup saved</p>
              <p className="text-sm text-gray-400">{registeredConfig?.terminal_name} · {registeredConfig?.location_name}</p>
              <p className="text-xs text-gray-400">Restart POS to activate this terminal's separate local data. Previous terminal data is kept.</p>
              {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
              <button type="button" onClick={() => void restart()} disabled={loading}
                className="w-full rounded-lg bg-burgundy-700 py-3 font-semibold text-white disabled:opacity-40"
                data-testid="button-restart-pos">{loading ? "Restarting…" : "Restart POS"}</button>
            </div>
          ) : step === "done" ? (
            <div className="text-center py-4">
              <CheckCircleIcon className="w-16 h-16 text-green-400 mx-auto mb-3" />
              <p className="text-white font-semibold text-lg">Terminal registered!</p>
               <p className="text-gray-400 text-sm mt-1">Catalog ready — loading POS…</p>
            </div>
          ) : step === "testing" ? (
            <div className="text-center py-4">
              <Loader2Icon className="w-12 h-12 text-burgundy-400 mx-auto mb-3 animate-spin" />
              <p className="text-white font-medium">Connecting to server…</p>
               <p className="text-gray-400 text-sm mt-1">Registering terminal and downloading catalog in safe pages…</p>
            </div>
          ) : (
            <>
              {initialConfig && <p className="text-xs text-gray-400">
                Current terminal: {initialConfig.terminal_name} ({initialConfig.terminal_code}).
                Finish held orders and sync pending sales before switching. Each terminal keeps separate local data.
              </p>}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Server URL
                </label>
                <div className="relative">
                  <ServerIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="url"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="https://your-globipos-server.com"
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-burgundy-500 placeholder:text-gray-600"
                    data-testid="input-server-url"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Terminal Code
                </label>
                <div className="relative">
                  <KeyIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={termCode}
                    onChange={(e) => setTermCode(e.target.value.toUpperCase())}
                    placeholder="e.g. T001"
                    maxLength={20}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-10 pr-4 py-3 text-sm font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-burgundy-500 placeholder:text-gray-600"
                    data-testid="input-terminal-code"
                    onKeyDown={(e) => e.key === "Enter" && handleRegister()}
                  />
                </div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5 mt-4">Device Key (optional)</label>
                <input
                  type="password"
                  value={deviceKey}
                  onChange={(e) => setDeviceKey(e.target.value)}
                  placeholder="Needed for customer invoices"
                  autoComplete="off"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-burgundy-500 placeholder:text-gray-600"
                  data-testid="input-device-key"
                />
                <p className="text-xs text-gray-500 mt-1.5">
                  Find this code in GlobiPOS Admin → POS → Terminals
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-red-950 border border-red-800 rounded-lg p-3">
                  <AlertCircleIcon className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}

              <button
                onClick={handleRegister}
                disabled={loading}
                className="w-full bg-burgundy-700 hover:bg-burgundy-600 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="button-register"
              >
                {initialConfig ? "Save Terminal Setup" : "Register Terminal"}
              </button>
              {onCancel && <button type="button" onClick={onCancel} disabled={loading}
                className="w-full rounded-lg border border-gray-700 py-3 text-sm text-gray-300"
                data-testid="button-cancel-setup">Cancel — keep current terminal</button>}
            </>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          GlobiPOS Terminal v{buildInfo.version} — Offline-first POS
        </p>
      </div>
    </div>
  );
}
