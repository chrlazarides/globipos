import { useState } from "react";
import { Wifi, Server, Key, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import type { TerminalConfig } from "../types";
import { registerTerminal, syncCatalog } from "../lib/sync";
import { setConfig } from "../lib/db";
import { BrandLogo } from "../components/BrandLogo";
import { useLiveSync } from "../hooks/use-live-sync";

interface SetupProps {
  initialConfig?: TerminalConfig | null;
  onComplete: (config: TerminalConfig) => void;
}

export function Setup({ initialConfig, onComplete }: SetupProps) {
  const sameOriginDefault = window.location.protocol === "https:" ? window.location.origin : "";
  const [serverUrl, setServerUrl] = useState(initialConfig?.server_url ?? sameOriginDefault);
  const [termCode, setTermCode] = useState(initialConfig?.terminal_code ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "testing" | "syncing" | "done">("form");
  const [syncProgress, setSyncProgress] = useState(0);
  const sync = useLiveSync();

  async function handleRegister() {
    let url = serverUrl.trim();
    if (!url.startsWith("http")) {
      url = "https://" + url;
    }
    
    if (!url || !termCode.trim()) {
      setError("Please enter a valid server URL and terminal code.");
      return;
    }
    
    setError(null);
    setLoading(true);
    setStep("testing");
    try {
      const cfg = await registerTerminal(url, termCode.trim().toUpperCase());
      setStep("syncing");
      await syncCatalog(setSyncProgress);
      const readyConfig = { ...cfg, initial_sync_complete: true };
      await setConfig(readyConfig);
      setStep("done");
      setTimeout(() => onComplete(readyConfig), 800);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStep("form");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <BrandLogo />
          <p className="text-muted-foreground mt-1">Terminal Setup</p>
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-xl p-8 space-y-6">
          {step === "done" ? (
            <div className="text-center py-4">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-3" />
              <p className="font-semibold text-lg text-foreground">Terminal registered!</p>
              <p className="text-muted-foreground text-sm mt-1">Ready for cashier login...</p>
            </div>
          ) : step === "testing" || step === "syncing" ? (
            <div className="text-center py-4">
              <Loader2 className="w-12 h-12 text-primary mx-auto mb-3 animate-spin" />
              <p className="font-medium text-foreground">
                {step === "syncing" ? "Preparing product catalog..." : "Connecting to server..."}
              </p>
              <p className="text-muted-foreground text-sm mt-1">
                {step === "syncing" ? `${sync.catalogCommitted.toLocaleString()} records saved · ${sync.catalogPages} pages${syncProgress === 100 ? " · Complete" : ""}` : "Verifying terminal code"}
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Server URL
                </label>
                <div className="relative">
                  <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="url"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="store.globipos.com"
                    className="w-full bg-input border border-border text-foreground rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
                    data-testid="input-server-url"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Terminal Code
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={termCode}
                    onChange={(e) => setTermCode(e.target.value.toUpperCase())}
                    placeholder="e.g. T001"
                    maxLength={20}
                    className="w-full bg-input border border-border text-foreground rounded-lg pl-10 pr-4 py-3 text-sm font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
                    data-testid="input-terminal-code"
                    onKeyDown={(e) => e.key === "Enter" && handleRegister()}
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                  <p className="text-destructive text-sm">{error}</p>
                </div>
              )}

              <button
                onClick={handleRegister}
                disabled={loading || !serverUrl || !termCode}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="button-register"
              >
                {initialConfig?.initial_sync_complete === false ? "Resume Terminal Setup" : "Register Terminal"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
