import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import type { TerminalConfig, CashierSession } from "./types";
import { getConfig } from "./lib/db";
import { flushOutbox } from "./lib/sync";
import { requestPersistentStorage } from "./lib/storage";
import { Setup } from "./pages/Setup";
import { Login } from "./pages/Login";
import { POS } from "./pages/POS";
import { Settings } from "./pages/Settings";

const queryClient = new QueryClient();

function MainRouter() {
  const [screen, setScreen] = useState<"loading" | "setup" | "login" | "pos">("loading");
  const [config, setConfig] = useState<TerminalConfig | null>(null);
  const [session, setSession] = useState<CashierSession | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    void requestPersistentStorage();
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
        setScreen("setup");
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!config) return;
    const flushWhenOnline = () => {
      if (navigator.onLine) void flushOutbox();
    };
    flushWhenOnline();
    window.addEventListener("online", flushWhenOnline);
    const interval = window.setInterval(flushWhenOnline, 5 * 60 * 1000);
    return () => {
      window.removeEventListener("online", flushWhenOnline);
      window.clearInterval(interval);
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
          <Settings config={config} onBack={() => setLocation(session ? "/register" : "/")} />
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
