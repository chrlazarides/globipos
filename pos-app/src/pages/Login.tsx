import { useState } from "react";
import { UserIcon, DeleteIcon, AlertCircleIcon } from "lucide-react";
import type { CashierSession, TerminalConfig } from "../types";
import { validatePin, writeAudit } from "../lib/db";

interface LoginProps {
  config: TerminalConfig;
  onLogin: (session: CashierSession) => void;
}

const PIN_DOTS = 6;

export function Login({ config, onLogin }: LoginProps) {
  const [pin, setPin]       = useState("");
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleDigit(d: string) {
    if (pin.length >= PIN_DOTS) return;
    const newPin = pin + d;
    setPin(newPin);
    setError(null);
    if (newPin.length >= 4) {
      submitPin(newPin);
    }
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
        onLogin(session as CashierSession);
      } else {
        setError("Invalid PIN. Please try again.");
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
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      {/* Terminal info */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-burgundy-800 rounded-xl mb-3">
          <UserIcon className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-white">{config.terminal_name}</h1>
        <p className="text-gray-400 text-sm mt-0.5">{config.location_name}</p>
      </div>

      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 w-full max-w-xs shadow-xl">
        <p className="text-center text-gray-300 text-sm font-medium mb-6">Enter your PIN</p>

        {/* PIN dots */}
        <div className="flex justify-center gap-3 mb-6">
          {Array.from({ length: PIN_DOTS }).map((_, i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full transition-colors ${
                i < pin.length ? "bg-burgundy-500" : "bg-gray-700"
              }`}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 bg-red-950 border border-red-800 rounded-lg px-3 py-2 mb-4">
            <AlertCircleIcon className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-xs">{error}</p>
          </div>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3">
          {keys.map((k, i) => {
            if (k === "") return <div key={i} />;
            if (k === "⌫") {
              return (
                <button
                  key={i}
                  onClick={handleDelete}
                  disabled={loading || pin.length === 0}
                  className="h-14 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold text-xl transition-colors disabled:opacity-30"
                  data-testid="button-pin-delete"
                >
                  <DeleteIcon className="w-5 h-5" />
                </button>
              );
            }
            return (
              <button
                key={i}
                onClick={() => handleDigit(k)}
                disabled={loading || pin.length >= PIN_DOTS}
                className="h-14 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-burgundy-800 text-white font-semibold text-xl transition-colors active:scale-95 disabled:opacity-40"
                data-testid={`button-pin-${k}`}
              >
                {loading && pin.length >= 4 ? (
                  <span className="text-sm animate-pulse">…</span>
                ) : (
                  k
                )}
              </button>
            );
          })}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          Ask your manager to set up cashier PINs in Settings
        </p>
      </div>
    </div>
  );
}
