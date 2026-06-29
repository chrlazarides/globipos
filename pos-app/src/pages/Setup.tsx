import { useState } from "react";
import { WifiIcon, ServerIcon, KeyIcon, CheckCircleIcon, AlertCircleIcon, Loader2Icon } from "lucide-react";
import type { TerminalConfig } from "../types";
import { registerTerminal } from "../lib/db";

interface SetupProps {
  onComplete: (config: TerminalConfig) => void;
}

export function Setup({ onComplete }: SetupProps) {
  const [serverUrl, setServerUrl]   = useState("http://");
  const [termCode, setTermCode]     = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [step, setStep]             = useState<"form" | "testing" | "done">("form");

  async function handleRegister() {
    if (!serverUrl.startsWith("http") || !termCode.trim()) {
      setError("Please enter a valid server URL and terminal code.");
      return;
    }
    setError(null);
    setLoading(true);
    setStep("testing");
    try {
      const cfg = await registerTerminal(serverUrl.trim(), termCode.trim().toUpperCase());
      setStep("done");
      setTimeout(() => onComplete(cfg), 800);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStep("form");
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
          <p className="text-gray-400 mt-1">Terminal Setup</p>
        </div>

        <div className="bg-gray-900 rounded-2xl border border-gray-800 shadow-xl p-8 space-y-6">
          {step === "done" ? (
            <div className="text-center py-4">
              <CheckCircleIcon className="w-16 h-16 text-green-400 mx-auto mb-3" />
              <p className="text-white font-semibold text-lg">Terminal registered!</p>
              <p className="text-gray-400 text-sm mt-1">Loading POS…</p>
            </div>
          ) : step === "testing" ? (
            <div className="text-center py-4">
              <Loader2Icon className="w-12 h-12 text-burgundy-400 mx-auto mb-3 animate-spin" />
              <p className="text-white font-medium">Connecting to server…</p>
              <p className="text-gray-400 text-sm mt-1">Downloading catalog and layout</p>
            </div>
          ) : (
            <>
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
                Register Terminal
              </button>
            </>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          GlobiPOS Terminal v1.0 — Offline-first POS
        </p>
      </div>
    </div>
  );
}
