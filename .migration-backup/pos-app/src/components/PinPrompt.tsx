import { useState } from "react";
import { ShieldIcon, DeleteIcon, XIcon } from "lucide-react";
import type { CashierSession } from "../types";
import { validatePin } from "../lib/db";

interface PinPromptProps {
  action: string;
  requiredRole: "supervisor" | "manager";
  onGranted: (session: CashierSession) => void;
  onDenied: () => void;
}

const ROLE_LABELS = { supervisor: "Supervisor", manager: "Manager" };

export function PinPrompt({ action, requiredRole, onGranted, onDenied }: PinPromptProps) {
  const [pin, setPin]     = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleDigit(d: string) {
    if (pin.length >= 6 || loading) return;
    const newPin = pin + d;
    setPin(newPin);
    setError(null);
    if (newPin.length >= 4) submit(newPin);
  }

  function handleDelete() {
    setPin((p) => p.slice(0, -1));
    setError(null);
  }

  async function submit(p: string) {
    setLoading(true);
    try {
      const session = await validatePin(p);
      if (!session) {
        setError("Invalid PIN.");
        setPin("");
        setLoading(false);
        return;
      }
      const allowed =
        requiredRole === "supervisor"
          ? session.role === "supervisor" || session.role === "manager"
          : session.role === "manager";
      if (!allowed) {
        setError(`${ROLE_LABELS[requiredRole]} PIN required.`);
        setPin("");
        setLoading(false);
        return;
      }
      onGranted(session as CashierSession);
    } catch {
      setError("PIN validation failed.");
      setPin("");
      setLoading(false);
    }
  }

  const keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-xs p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShieldIcon className="w-4 h-4 text-amber-400" />
            <span className="text-white font-semibold text-sm">{ROLE_LABELS[requiredRole]} Required</span>
          </div>
          <button onClick={onDenied} className="text-gray-600 hover:text-gray-300">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <p className="text-gray-400 text-xs mb-5">
          Enter {ROLE_LABELS[requiredRole].toLowerCase()} PIN to: <span className="text-gray-200">{action}</span>
        </p>

        {/* Dots */}
        <div className="flex justify-center gap-2.5 mb-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full transition-colors ${
                i < pin.length ? "bg-amber-400" : "bg-gray-700"
              }`}
            />
          ))}
        </div>

        {error && (
          <div className="bg-red-950 border border-red-800 rounded-lg px-3 py-2 mb-3 text-red-300 text-xs text-center">
            {error}
          </div>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2">
          {keys.map((k, i) => {
            if (k === "") return <div key={i} />;
            if (k === "⌫") {
              return (
                <button key={i} onClick={handleDelete} disabled={loading}
                  className="h-11 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors disabled:opacity-30">
                  <DeleteIcon className="w-4 h-4" />
                </button>
              );
            }
            return (
              <button key={i} onClick={() => handleDigit(k)} disabled={loading}
                className="h-11 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-amber-900/50 text-white font-semibold text-lg transition-colors active:scale-95 disabled:opacity-40">
                {k}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
