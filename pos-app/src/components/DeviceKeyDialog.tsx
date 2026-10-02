import { useState } from "react";
import { writeDeviceKey } from "../lib/deviceKey";

export function DeviceKeyDialog({ hasKey, onClose }: { hasKey: boolean; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(next: string) {
    setBusy(true); setError("");
    try { await writeDeviceKey(next); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save the device key."); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 p-6 text-white shadow-2xl">
        <h2 className="mb-1 font-semibold">Device Key</h2>
        <p className="mb-4 text-xs text-gray-400">Pairs this terminal for customer invoices and vouchers. {hasKey ? "A key is saved; enter a new one to replace it." : "No key saved."}</p>
        <input type="password" autoComplete="off" autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="Paste device key" className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-burgundy-500"
          data-testid="input-device-key-settings" />
        {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg bg-gray-800 py-2.5 text-sm text-gray-300">Cancel</button>
          {hasKey && <button disabled={busy} onClick={() => void save("")} className="rounded-lg bg-gray-800 px-3 py-2.5 text-sm text-red-300 disabled:opacity-40" data-testid="button-device-key-clear">Remove</button>}
          <button disabled={busy || !value.trim()} onClick={() => void save(value)} className="flex-1 rounded-lg bg-burgundy-700 py-2.5 text-sm font-semibold disabled:opacity-40" data-testid="button-device-key-save">Save</button>
        </div>
      </div>
    </div>
  );
}
