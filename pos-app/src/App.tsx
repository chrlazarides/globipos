/**
 * Root app router — manages the three-screen lifecycle:
 * 1. Setup (first launch — no config stored)
 * 2. Login (PIN entry)
 * 3. POS (main selling screen)
 */
import { useState, useEffect } from "react";
import type { TerminalConfig, CashierSession } from "./types";
import { getConfig } from "./lib/db";
import { Setup } from "./pages/Setup";
import { Login } from "./pages/Login";
import { POS } from "./pages/POS";
import { useSync } from "./hooks/useSync";
import { useUpdater } from "./hooks/useUpdater";
import { UpdateBanner } from "./components/UpdateBanner";

type Screen = "loading" | "setup" | "login" | "pos";

export function App() {
  const [screen, setScreen]   = useState<Screen>("loading");
  const [config, setConfig]   = useState<TerminalConfig | null>(null);
  const [session, setSession] = useState<CashierSession | null>(null);

  const sync        = useSync(config !== null, config);
  const updateState = useUpdater();

  // On mount: init SQLite and check if we have a stored config
  useEffect(() => {
    async function init() {
      try {
        const cfg = await getConfig();
        if (cfg) {
          setConfig(cfg);
          setScreen("login");
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

  function handleSetupComplete(cfg: TerminalConfig) {
    setConfig(cfg);
    setScreen("login");
  }

  function handleLogin(s: CashierSession) {
    setSession(s);
    setScreen("pos");
  }

  function handleLogout() {
    setSession(null);
    setScreen("login");
  }

  if (screen === "loading") {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-burgundy-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Starting GlobiPOS…</p>
        </div>
      </div>
    );
  }

  if (screen === "setup") {
    return (
      <>
        <Setup onComplete={handleSetupComplete} />
        <UpdateBanner state={updateState} />
      </>
    );
  }

  if (screen === "login" && config) {
    return (
      <>
        <Login config={config} onLogin={handleLogin} />
        <UpdateBanner state={updateState} />
      </>
    );
  }

  if (screen === "pos" && config && session) {
    return (
      <>
        <POS config={config} session={session} sync={sync} onLogout={handleLogout} />
        <UpdateBanner state={updateState} />
      </>
    );
  }

  // Fallback — shouldn't reach here
  return <Setup onComplete={handleSetupComplete} />;
}
