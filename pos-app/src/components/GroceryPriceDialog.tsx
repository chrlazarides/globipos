import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readDeviceKey } from "../lib/deviceKey";
import { dailyPriceChanges, dailyPriceReceipt, type GroceryPriceList } from "../lib/groceryPrices";
import type { TerminalConfig, Category } from "../types";
import type { UseHardwareReturn } from "../hooks/useHardware";

export function GroceryPriceDialog({ config, cashierId, cashierName, categories, hw, onRefreshed, onClose }: {
  config: TerminalConfig; cashierId: string; hw: UseHardwareReturn;
  cashierName: string; categories: Category[];
  onRefreshed: () => Promise<void>; onClose: (completed: boolean) => void;
}) {
  const [pin, setPin] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [list, setList] = useState<GroceryPriceList | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [localReady, setLocalReady] = useState(true);
  const [printed, setPrinted] = useState(false);
  const [query, setQuery] = useState("");
  async function request<T>(action: "list" | "save" | "print-status", extra = {}): Promise<T> {
    const key = await readDeviceKey(config);
    if (!key) throw new Error("Pair this terminal with its secure device key first.");
    const response = await fetch(`${config.server_url.replace(/\/$/, "")}/api/pos/grocery-prices/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Terminal-Code": config.terminal_code, "X-Voucher-Device-Key": key },
      body: JSON.stringify({ cashierId, pin, categoryId, ...extra }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Price list request failed.");
    return data;
  }
  async function refreshLocal() {
    await invoke("sync_catalog");
    await onRefreshed();
    setLocalReady(true);
  }
  async function load(selected = categoryId) {
    setBusy(true); setError(""); setMessage("");
    try {
      const current = await request<GroceryPriceList>("list", { categoryId: selected });
      setList(current); setDrafts({}); setSaved(false); setPrinted(false);
      setCategoryId(selected);
      if (!localReady) await refreshLocal();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function saveAndPrint() {
    if (!list) return;
    setBusy(true); setError(""); setMessage("");
    let persisted = false;
    try {
      // An interrupted save may already have committed. Recover from the server,
      // never resubmit the old drafts while the till's catalogue is unresolved.
      const prices = localReady ? dailyPriceChanges(list, drafts) : [];
      if (!localReady) setDrafts({});
      if (prices.length) {
        setLocalReady(false);
        await request("save", { priceLevel: list.priceLevel, locationId: list.locationId, prices });
        persisted = true; setSaved(true); setLocalReady(false);
        // Clear submitted edits immediately so print/sync failures cannot re-submit the mutation.
        setDrafts({});
      }
      const current = await request<GroceryPriceList>("list");
      setList(current);
      await refreshLocal();
      const printOk = !!hw.config?.printer_enabled && await hw.printReceipt(dailyPriceReceipt(current, config.location_name));
      await request("print-status", { status: printOk ? "sent_to_printer" : "failed" });
      if (!printOk) throw new Error("Prices are current, but printing failed or the printer is disabled. Check the printer and retry printing; do not re-enter prices.");
      setPrinted(true);
      setMessage("Price list is saved, refreshed at this till and sent to the printer.");
    } catch (e) {
      setError(`${persisted || saved ? "Prices were saved. " : "If the save response was interrupted, reload to confirm the saved prices before retrying. "}${String(e)}`);
    } finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
    <div role="dialog" aria-modal="true" aria-label="Price Change" className="bg-slate-900 text-white rounded-xl w-full max-w-3xl p-5 max-h-[90vh] overflow-auto">
      <h2 className="text-xl font-bold">Price Change</h2>
      <p className="text-sm text-amber-300 my-2">Select a category, enter only the new prices you need, then save and print. Persistent price-list changes are recorded in your user log. Existing cart lines are not repriced.</p>
      <div className="flex gap-2 my-3">
        <span className="flex-1 self-center">Clerk: {cashierName}</span>
        <input aria-label="Your cashier PIN" type="password" inputMode="numeric" className="bg-slate-800 p-2 rounded w-40" value={pin} disabled={busy || !!list} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="Your PIN" />
        {list && <button className="bg-blue-700 p-2 rounded" disabled={busy} onClick={() => load()}>Reload prices</button>}
      </div>
      {!list && <>
        <p className="text-sm mb-2">Enter your PIN, then choose the POS category. Only clerks granted price-change access can continue.</p>
        <div className="grid grid-cols-3 gap-2">
          {categories.filter(c => c.active).map(c => <button key={c.server_id} disabled={busy || pin.length < 4}
            onClick={() => load(c.server_id)} className="bg-blue-800 hover:bg-blue-700 rounded p-4">{c.name}</button>)}
        </div>
      </>}
      {list && <>
        <div className="flex justify-between items-center my-2"><h3 className="font-bold text-lg">{list.categoryName}</h3>
          <button disabled={busy || !localReady} onClick={() => { if (!Object.values(drafts).some(v => v.trim()) || confirm("Discard unsaved new prices and choose another category?")) { setList(null); setDrafts({}); } }} className="bg-slate-700 rounded p-2">Change category</button>
        </div>
        <p>Location: {config.location_name} — Price level {list.priceLevel}</p>
        <p className="text-amber-300 text-sm">{list.scope}</p>
        <input aria-label="Search grocery items" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name / PLU" className="bg-slate-800 rounded p-2 my-3 w-full" />
        {!list.items.length && <p>No active products in this category.</p>}
        <div className="grid grid-cols-[1fr_7rem_8rem] gap-3 font-bold text-sm p-2"><span>Product</span><span>Existing price</span><span>New price</span></div>
        <div className="max-h-80 overflow-auto">
          {list.items.filter(i => `${i.name} ${i.sku}`.toLowerCase().includes(query.toLowerCase())).map(item =>
            <label key={item.itemId} className="grid grid-cols-[1fr_7rem_8rem] items-center gap-3 border-b border-slate-700 p-2">
              <span>{item.name}<small className="block text-slate-400">{item.sku}</small></span>
              <span>€{item.effectivePrice.toFixed(2)}<small className="block text-slate-400">/ {item.unit}</small></span>
              <span><input aria-label={`${item.name} new price`} inputMode="decimal" disabled={busy || !localReady} value={drafts[item.itemId] ?? ""} placeholder="Unchanged"
                onChange={e => { setDrafts(d => ({ ...d, [item.itemId]: e.target.value })); setPrinted(false); }}
                className="bg-slate-800 p-2 rounded w-full text-right" /></span>
            </label>)}
        </div>
      </>}
      {error && <p role="alert" className="text-red-300 my-3">{error}</p>}
      {hw.printError && <p className="text-red-300">{hw.printError}</p>}
      {message && <p role="status" className="text-green-300 my-3">{message}</p>}
      <div className="flex justify-end gap-3 mt-4">
        <button disabled={busy || !localReady} onClick={() => onClose(printed)} className="bg-slate-700 rounded px-4 py-2">{printed ? "Done" : "Cancel"}</button>
        <button disabled={busy || !list?.items.length} onClick={saveAndPrint} className="bg-green-700 rounded px-4 py-2">
          {busy ? "Working…" : !localReady ? "Confirm saved prices and print" : Object.values(drafts).some(v => v.trim()) ? "Save and print" : "Print current list"}
        </button>
      </div>
      {!localReady && <p className="text-amber-300 text-sm mt-2">Saving succeeded, but this till still needs its catalogue refreshed. Retry before continuing sales.</p>}
    </div>
  </div>;
}