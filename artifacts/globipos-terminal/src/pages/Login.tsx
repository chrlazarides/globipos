import { useState, useEffect } from "react";
import { User, Delete, AlertCircle, Settings as SettingsIcon, CloudOff } from "lucide-react";
import { Link } from "wouter";
import type { CashierSession, TerminalConfig } from "../types";
import { BrandLogo } from "../components/BrandLogo";
import { validatePin, getCashiers, writeAudit } from "../lib/db";
import { syncCashiers } from "../lib/sync";

interface LoginProps {
  config: TerminalConfig;
  onLogin: (session: CashierSession) => void;
}

const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 8;

export function Login({ config, onLogin }: LoginProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cashierCount, setCashierCount] = useState(0);
  const [syncError, setSyncError] = useState(false);

  useEffect(() => {
    // Initial fetch of cashiers to local DB
    async function load() {
      try {
        await syncCashiers();
        setSyncError(false);
      } catch (err) {
        console.error("Failed to sync cashiers on login", err);
        setSyncError(true);
      }
      const cashiers = await getCashiers();
      setCashierCount(cashiers.length);
    }
    load();
  }, []);

  function handleDigit(d: string) {
    if (pin.length >= MAX_PIN_LENGTH) return;
    setPin(pin + d);
    setError(null);
  }

  function handleDelete() {
    setPin((p) => p.slice(0, -1));
    setError(null);
  }

  async function submitPin(p: string) {
    setLoading(true);
    try {
      const session = await validatePin(p);
      if (session) {
        await writeAudit("cashier_login", "cashier", session.cashier_id, `PIN login`, session.cashier_id, session.cashier_name);
        onLogin(session);
      } else {
        setError("Invalid PIN.");
        setPin("");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Login failed");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  const keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      
      <div className="absolute top-6 right-6 flex items-center gap-4">
        {syncError && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-card border border-border px-3 py-1.5 rounded-full">
            <CloudOff className="w-3.5 h-3.5" /> Offline
          </div>
        )}
        <Link href="/settings" className="p-2 bg-card border border-border rounded-full text-muted-foreground hover:text-foreground transition-colors">
          <SettingsIcon className="w-5 h-5" />
        </Link>
      </div>

      <div className="text-center mb-8">
        <BrandLogo />
        <h1 className="text-2xl font-bold text-foreground">{config.terminal_name}</h1>
        <p className="text-muted-foreground text-sm mt-0.5">{config.location_name}</p>
      </div>

      <div className="bg-card rounded-2xl border border-border p-8 w-full max-w-xs shadow-xl">
         <p className="text-center text-muted-foreground text-sm font-medium mb-6">Enter 4–8 digit PIN</p>

        <div className="flex justify-center gap-4 mb-6">
          {Array.from({ length: MAX_PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full transition-colors ${
                i < pin.length ? "bg-primary" : "bg-input"
              }`}
            />
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 mb-4">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
            <p className="text-destructive text-xs">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          {keys.map((k, i) => {
            if (k === "") return <div key={i} />;
            if (k === "⌫") {
              return (
                <button
                  key={i}
                  onClick={handleDelete}
                  disabled={loading || pin.length === 0}
                  className="h-16 flex items-center justify-center rounded-xl bg-input hover:bg-input/80 text-muted-foreground font-semibold text-xl transition-colors disabled:opacity-30"
                  data-testid="button-pin-delete"
                >
                  <Delete className="w-6 h-6" />
                </button>
              );
            }
            return (
              <button
                key={i}
                onClick={() => handleDigit(k)}
                disabled={loading || pin.length >= MAX_PIN_LENGTH}
                className="h-16 flex items-center justify-center rounded-xl bg-input hover:bg-primary text-foreground hover:text-primary-foreground font-semibold text-2xl transition-colors active:scale-95 disabled:opacity-40"
                data-testid={`button-pin-${k}`}
              >
                {k}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => void submitPin(pin)}
          disabled={loading || pin.length < MIN_PIN_LENGTH}
          className="mt-4 h-12 w-full rounded-xl bg-primary font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </div>
      
      <p className="text-center text-muted-foreground text-xs mt-6">
        {cashierCount === 0 
          ? "No cashiers synced. Go to settings to force sync." 
          : `${cashierCount} cashier(s) registered locally`}
      </p>
    </div>
  );
}
