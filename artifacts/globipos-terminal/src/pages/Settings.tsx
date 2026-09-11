import { useState, useEffect } from "react";
import { ArrowLeft, RefreshCw, Terminal, Globe, Info, Download } from "lucide-react";
import type { TerminalConfig } from "../types";
import { syncCatalog, syncCashiers, flushOutbox } from "../lib/sync";
import { getOutbox, getActiveProductsCount, getCashiers } from "../lib/db";
import { useToast } from "@/hooks/use-toast";
import { usePwaInstall } from "@/hooks/use-pwa-install";

interface SettingsProps {
  config: TerminalConfig;
  onBack: () => void;
}

export function Settings({ config, onBack }: SettingsProps) {
  const [syncing, setSyncing] = useState(false);
  const [outboxCount, setOutboxCount] = useState(0);
  const [productCount, setProductCount] = useState(0);
  const [cashierCount, setCashierCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();
  const { canInstall, installed, install } = usePwaInstall();

  useEffect(() => {
    async function load() {
      const outbox = await getOutbox();
      setOutboxCount(outbox.length);
      setProductCount(await getActiveProductsCount());
      const cashiers = await getCashiers();
      setCashierCount(cashiers.length);
    }
    load();
  }, []);

  async function handleForceSync() {
    if (syncing) return;
    setSyncing(true);
    setProgress(0);
    
    try {
      // 1. Sync cashiers
      await syncCashiers();
      
      // 2. Sync catalog
      const pCount = await syncCatalog((p) => setProgress(p));
      setProductCount(pCount);
      
      // 3. Flush outbox
      const flushed = await flushOutbox();
      const newOutbox = await getOutbox();
      setOutboxCount(newOutbox.length);
      
      const c = await getCashiers();
      setCashierCount(c.length);
      
      toast({
        title: "Sync complete",
        description: `Synced catalog (${pCount} items). Sent ${flushed} offline orders.`,
      });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: e.message || "Network error. Try again later.",
      });
    } finally {
      setSyncing(false);
      setProgress(0);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center px-4 h-16 border-b border-border bg-card sticky top-0 z-10">
        <button
          onClick={onBack}
          className="p-2 -ml-2 mr-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-input transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">Terminal Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-3xl mx-auto w-full space-y-6">
        
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Terminal className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Identity</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Terminal</p>
              <p className="text-sm font-medium text-foreground">{config.terminal_name} ({config.terminal_code})</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Location</p>
              <p className="text-sm font-medium text-foreground">{config.location_name}</p>
            </div>
            <div className="space-y-1 md:col-span-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Server URL</p>
              <p className="text-sm font-mono text-foreground break-all">{config.server_url}</p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg text-primary">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Sync & Storage</h2>
            </div>
            <button
              onClick={handleForceSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Force Sync'}
            </button>
          </div>
          
          {syncing && progress > 0 && (
            <div className="mb-4">
              <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                <span>Downloading catalog</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-input rounded-full h-1.5">
                <div className="bg-primary h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
            <div className="bg-background rounded-lg p-3 border border-border">
              <p className="text-xs text-muted-foreground mb-1">Products</p>
              <p className="text-xl font-semibold text-foreground">{productCount}</p>
            </div>
            <div className="bg-background rounded-lg p-3 border border-border">
              <p className="text-xs text-muted-foreground mb-1">Cashiers</p>
              <p className="text-xl font-semibold text-foreground">{cashierCount}</p>
            </div>
            <div className="bg-background rounded-lg p-3 border border-border">
              <p className="text-xs text-muted-foreground mb-1">Outbox (Pending)</p>
              <p className={`text-xl font-semibold ${outboxCount > 0 ? 'text-amber-500' : 'text-foreground'}`}>
                {outboxCount}
              </p>
            </div>
            <div className="bg-background rounded-lg p-3 border border-border">
              <p className="text-xs text-muted-foreground mb-1">Status</p>
              <p className="text-sm font-semibold text-green-500 flex items-center gap-1.5 mt-1">
                <Globe className="w-4 h-4" /> Ready
              </p>
            </div>
          </div>
        </div>

        <div className="bg-accent/30 border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">Web-only Limitations</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Printers, card terminals, cash drawers, physical scales, desktop updates, and shell actions are unavailable in this browser-based version of GlobiPOS Terminal. Offline capabilities are limited by browser storage quotas.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Install GlobiPOS Terminal</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {installed
                  ? "This terminal is running as an installed app."
                  : "Install this POS separately from the GlobiPOS back office. On Safari, use Share, then Add to Home Screen."}
              </p>
            </div>
            {canInstall && !installed && (
              <button
                onClick={() => void install()}
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                <Download className="h-4 w-4" />
                Install Terminal
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
