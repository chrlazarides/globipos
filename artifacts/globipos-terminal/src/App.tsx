import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import type { TerminalConfig, CashierSession } from "./types";
import { getConfig } from "./lib/db";
import { flushOutbox, syncAll, reportSyncStatus } from "./lib/sync";
import { refreshSyncSnapshot } from "./lib/sync-state";
import { Setup } from "./pages/Setup";
import { Login } from "./pages/Login";
import { POS } from "./pages/POS";
import { Settings } from "./pages/Settings";

const queryClient = new QueryClient();

function MainRouter() {
  const [screen, setScreen] = useState<"loading" | "failed" | "setup" | "login" | "pos">("loading");
  const [initError, setInitError] = useState("");
  const [config, setConfig] = useState<TerminalConfig | null>(null);
  const [session, setSession] = useState<CashierSession | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    async function init() {
      try {
        const cfg = await getConfig();
        if (cfg) {
          setConfig(cfg);
          setScreen(cfg.initial_sync_complete === false ? "setup" : "login");
        } else {
          setScreen("setup");
        }
      } catch (e) {
        console.error("Init failed:", e);
        setInitError(e instanceof Error ? e.message : "Local terminal storage could not be opened.");
        setScreen("failed");
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!config || config.initial_sync_complete === false) return;
    const flushWhenOnline = () => {
      if (navigator.onLine) void flushOutbox().catch(() => {});
    };
    const fullSyncWhenOnline = () => {
      if (navigator.onLine) void syncAll().catch(() => {});
    };
    const heartbeat = () => { void reportSyncStatus().catch(() => {}); };
    void refreshSyncSnapshot().then(fullSyncWhenOnline).catch(() => {});
    window.addEventListener("online", fullSyncWhenOnline);
    const interval = window.setInterval(flushWhenOnline, 30_000);
    const catalogInterval = window.setInterval(fullSyncWhenOnline, 15 * 60 * 1000);
    const heartbeatInterval = window.setInterval(heartbeat, 10_000);
    return () => {
      window.removeEventListener("online", fullSyncWhenOnline);
      window.clearInterval(interval);
      window.clearInterval(catalogInterval);
      window.clearInterval(heartbeatInterval);
    };
  }, [config]);

  if (screen === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Starting GlobiPOS…</p>
        </div>
      </div>
    );
  }
  if (screen === "failed") return <div className="flex min-h-screen items-center justify-center bg-background p-6">
    <div role="alert" className="max-w-md rounded-xl border border-destructive bg-card p-6">
      <h1 className="text-xl font-semibold">Terminal storage unavailable</h1>
      <p className="mt-3 text-sm">{initError}</p>
      <p className="mt-3 text-xs text-muted-foreground">Close any other terminal tabs and retry. Do not clear browser data: it may contain pending transactions.</p>
      <button className="mt-4 rounded-lg bg-primary px-4 py-2 text-primary-foreground" onClick={() => window.location.reload()}>Retry</button>
    </div>
  </div>;

  return (
    <Switch>
      <Route path="/">
        {screen === "setup" ? (
          <Setup initialConfig={config} onComplete={(cfg) => { setConfig(cfg); setScreen("login"); }} />
        ) : screen === "login" && config ? (
          <Login config={config} onLogin={(s) => { setSession(s); setLocation("/register"); setScreen("pos"); }} />
        ) : null}
      </Route>
      <Route path="/register">
        {config && session ? (
          <POS config={config} session={session} onLogout={() => { setSession(null); setLocation("/"); setScreen("login"); }} />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground">
            <p>Not logged in.</p>
            <button onClick={() => setLocation("/")} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg">Return to Login</button>
          </div>
        )}
      </Route>
      <Route path="/settings">
        {config ? (
          <Settings config={config} onUpdated={setConfig} onBack={() => setLocation(session ? "/register" : "/")} />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground">
            <p>Terminal not configured.</p>
            <button onClick={() => setLocation("/")} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg">Go to Setup</button>
          </div>
        )}
      </Route>
    </Switch>
  );
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <RoutedErrorBoundary>
            <MainRouter />
          </RoutedErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
