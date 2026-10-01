import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import type { CashierSession, TerminalConfig } from "../types";
import { transferDestinations, type TransferLocation } from "./stock-transfer-options";

type StockRow = {
  locationId: string;
  locationName: string;
  onHand: number;
  reserved: number;
  available: number;
  variantId?: string | null;
};
type StockItem = {
  id: string;
  name: string;
  sku?: string;
  variants?: { id: string; label: string; sku?: string }[];
  locations: StockRow[];
  variantLocations?: StockRow[];
};
type Reservation = {
  id: string;
  itemId: string;
  itemName?: string;
  sourceLocationId: string;
  sourceLocationName?: string;
  destinationLocationId: string;
  quantity: number;
  customerName: string;
  status: string;
  transferId?: string | null;
};

type Props = {
  config: TerminalConfig;
  session: CashierSession;
  onClose: () => void;
  initialMode?: "lookup" | "stockIn" | "transfer";
};

export function MultiLocationSearch({ config, session, onClose, initialMode = "lookup" }: Props) {
  const [mode, setMode] = useState<"lookup" | "stockIn" | "transfer">(initialMode);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<StockItem[]>([]);
  const [selected, setSelected] = useState<StockItem | null>(null);
  const [variantId, setVariantId] = useState("");
  const [source, setSource] = useState<StockRow | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [customerName, setCustomerName] = useState("");
  const [pin, setPin] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [reservationKey, setReservationKey] = useState(() => crypto.randomUUID());
  const [stockInKey, setStockInKey] = useState(() => crypto.randomUUID());
  const [stockInQuantity, setStockInQuantity] = useState("1");
  const [multiStoreEnabled, setMultiStoreEnabled] = useState(false);
  const [transferDestination, setTransferDestination] = useState("");
  const [transferQuantity, setTransferQuantity] = useState("1");
  const [transferKey, setTransferKey] = useState(() => crypto.randomUUID());
  const [transferLocations, setTransferLocations] = useState<TransferLocation[]>([]);

  const headers = {
    "X-Terminal-Code": config.terminal_code,
    ...(config.voucher_device_key ? { "X-Voucher-Device-Key": config.voucher_device_key } : {}),
  };

  async function request(path: string, options?: RequestInit) {
    if (!navigator.onLine) throw new Error("Stock lookup and reservations require a live connection.");
    const response = await fetch(`${config.server_url}${path}`, {
      ...options, cache: "no-store",
      headers: { ...headers, ...(options?.headers ?? {}) },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || `Stock service returned ${response.status}`);
    return data;
  }
  useEffect(() => {
    request("/api/pos/sync/locations").then(setTransferLocations).catch(e => setError(e.message));
  }, []);

  async function transferStock() {
    if (!selected || !transferDestination || pending) return;
    if (!config.voucher_device_key) { setError("Pair this Terminal with its device key before transferring stock."); return; }
    const units = Number(transferQuantity);
    if (!Number.isSafeInteger(units) || units <= 0 || units > 10000) { setError("Enter 1–10,000 whole units."); return; }
    if (selected.variants?.length && !variantId) { setError("Select a size or colour variant."); return; }
    if (!/^\d{4,8}$/.test(pin)) { setError("Enter your cashier PIN to authorize the transfer."); return; }
    setPending(true); setError(""); setNotice("");
    try {
      const result = await request("/api/pos/sync/transfers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toLocationId: transferDestination, cashierId: session.cashier_id, pin,
          idempotencyKey: transferKey,
          items: [{ itemId: selected.id, variantId: variantId || null, quantity: units }],
        }),
      });
      if (result.status !== "completed" || !result.id) throw new Error("Transfer confirmation was incomplete. Retry with the same details.");
      setTransferKey(crypto.randomUUID()); setPin("");
      setNotice(`Transfer ${result.transferNumber} completed: ${units} units moved.`);
      setQuery(current => current + " ");
    } catch (e: any) { setError(e.message); }
    finally { setPending(false); }
  }

  async function refreshReservations() {
    try {
      const data = await request("/api/pos/stock/reservations?scope=destination");
      setReservations(Array.isArray(data?.reservations) ? data.reservations : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load reservations.");
    }
  }

  useEffect(() => { void refreshReservations(); }, [config.server_url, config.terminal_code]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const data = await request("/api/pos/stock/mode");
        if (active) setMultiStoreEnabled(data.multiStoreEnabled === true);
      } catch {
        if (active) setMultiStoreEnabled(false);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [config.server_url, config.terminal_code]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setItems([]);
      setSelected(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await request(`/api/pos/stock/search?q=${encodeURIComponent(query.trim())}`);
        if (active) {
          if (!Array.isArray(data?.items)) throw new Error("Invalid stock search response.");
          setItems(data.items);
          setMultiStoreEnabled(data.multiStoreEnabled === true);
          setSelected(null);
          setTransferKey(crypto.randomUUID());
          setError("");
        }
      } catch (cause) {
        if (active) { setItems([]); setError(cause instanceof Error ? cause.message : "Could not look up stock."); }
      } finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, config.server_url, config.terminal_code]);

  const stockRows = selected
    ? selected.variants?.length
      ? (selected.variantLocations ?? []).filter(row => row.variantId === variantId)
      : selected.locations ?? []
    : [];

  function chooseItem(item: StockItem) {
    setReservationKey(crypto.randomUUID());
    setStockInKey(crypto.randomUUID());
    setSelected(item);
    setVariantId(item.variants?.[0]?.id ?? "");
    setSource(null);
    setQuantity("1");
    setError("");
    setNotice("");
  }

  async function reserve() {
    if (!selected || !source || pending) return;
    if (!multiStoreEnabled) { setError("Enable multi-store stock control in Back Office before reserving stock."); return; }
    if (!config.voucher_device_key) {
      setError("Pair this Terminal in Settings with its device key before reserving stock.");
      return;
    }
    const units = Number(quantity);
    if (!Number.isInteger(units) || units <= 0 || units > source.available) {
      setError("Choose a whole quantity that is still available at the other shop.");
      return;
    }
    if (!customerName.trim() || pin.length < 4) {
      setError("Enter the customer name and your cashier PIN before reserving.");
      return;
    }
    setPending(true); setError(""); setNotice("");
    try {
      const data = await request("/api/pos/stock/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: selected.id,
          variantId: selected.variants?.length ? variantId : null,
          sourceLocationId: source.locationId,
          quantity: units,
          customerName: customerName.trim(),
          cashierId: session.cashier_id,
          pin,
          idempotencyKey: reservationKey,
        }),
      }) as Reservation;
      if (!data?.id) throw new Error("Reservation response was incomplete; check the reservation list before retrying.");
      setNotice(`Reserved ${units} at ${source.locationName} for transfer here. Reference ${data.id}.`);
      setPin("");
      setSource(null);
      setReservationKey(crypto.randomUUID());
      await refreshReservations();
      setQuery(current => current + " ");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reservation failed.");
    } finally { setPending(false); }
  }

  async function cancelReservation(id: string) {
    if (!pin || pending) { setError("Enter your cashier PIN to release a reservation."); return; }
    setPending(true); setError("");
    try {
      await request(`/api/pos/stock/reservations/${encodeURIComponent(id)}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashierId: session.cashier_id, pin }),
      });
      setNotice("Reservation released. The source shop can sell that stock again.");
      setPin("");
      await refreshReservations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not release the reservation.");
    } finally { setPending(false); }
  }

  async function stockIn() {
    if (!selected || pending) return;
    const units = Number(stockInQuantity);
    if (!Number.isInteger(units) || units <= 0 || units > 10000) {
      setError("Enter a whole quantity from 1 to 10,000.");
      return;
    }
    if (!config.voucher_device_key) {
      setError("Pair this Terminal in Settings with its device key before recording stock.");
      return;
    }
    if (!/^\d{4,8}$/.test(pin)) { setError("Enter your cashier PIN."); return; }
    setPending(true); setError(""); setNotice("");
    try {
      const data = await request("/api/pos/stock/stock-in", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: selected.id,
          variantId: selected.variants?.length ? variantId : null,
          quantity: units,
          cashierId: session.cashier_id,
          pin,
          idempotencyKey: stockInKey,
        }),
      });
      if (!data?.operationId) throw new Error("Stock entry response was incomplete. Retry with the same details.");
      setNotice(`Recorded ${units} received at ${config.location_name}. On hand now: ${data.onHand}.`);
      setStockInKey(crypto.randomUUID());
      setPin("");
      setQuery(current => current + " ");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record stock. Retry with the same details.");
    } finally { setPending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3">
      <section role="dialog" aria-modal="true" aria-label="Search items across shops"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-card text-foreground shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-bold">{mode === "transfer" ? "Transfer stock" : mode === "stockIn" ? "Stock In · quick entry" : "Search items · all shops"}</h2>
            <p className="text-xs text-muted-foreground">{mode === "stockIn"
              ? `Record stock physically received at ${config.location_name}.`
              : mode === "transfer" ? `Move stock from ${config.location_name} to another shop. Global stock stays unchanged.`
              : "Available means stock on hand minus active reservations. Transfers do not move stock until completed."}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close item search" className="rounded p-2 hover:bg-input"><X className="h-5 w-5" /></button>
        </header>
        <div className="overflow-y-auto p-5">
          <div className="mb-3 flex gap-2">
            <button type="button" onClick={() => setMode("lookup")} className="rounded border border-border px-3 py-2 text-sm">Stock lookup</button>
            <button type="button" onClick={() => setMode("transfer")} className="rounded border border-border px-3 py-2 text-sm" data-testid="tab-stock-transfer">Transfer stock</button>
          </div>
          <label className="relative block">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input autoFocus value={query} onChange={event => { setQuery(event.target.value); setSource(null); setReservationKey(crypto.randomUUID()); setStockInKey(crypto.randomUUID()); setTransferKey(crypto.randomUUID()); }}
              placeholder="Search name, SKU or barcode…" className="w-full rounded-lg bg-input py-2 pl-10 pr-3"
              aria-label="Search items in all shops" />
          </label>
          {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{notice}</p>}
          {mode === "lookup" && !multiStoreEnabled && <p role="status" className="mt-3 rounded-lg border border-border p-3 text-sm">
            Multi-store stock control is disabled. Shop counts are setup information only; sales use global stock and reservations are unavailable.
          </p>}
          <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {loading ? <p className="p-3 text-sm">Checking shops…</p> : items.length === 0
                ? <p className="p-3 text-sm text-muted-foreground">{query.trim().length < 2 ? "Enter at least two characters." : "No matching items."}</p>
                : items.map(item => (
                  <button type="button" key={item.id} onClick={() => chooseItem(item)}
                    className={`w-full rounded-lg p-3 text-left text-sm hover:bg-input ${selected?.id === item.id ? "bg-input ring-1 ring-primary" : ""}`}>
                    <span className="font-medium">{item.name}</span>
                    {item.sku && <span className="block text-xs text-muted-foreground">{item.sku}</span>}
                  </button>
                ))}
            </div>
            <div className="rounded-lg border border-border p-3">
              {!selected ? <p className="text-sm text-muted-foreground">Select an item to see stock by shop and reserve it for transfer.</p> : (
                <>
                  <h3 className="font-semibold">{selected.name}</h3>
                  {selected.variants?.length ? (
                    <label className="mt-3 block text-sm">Size / variant
                      <select value={variantId} onChange={event => { setVariantId(event.target.value); setSource(null); setReservationKey(crypto.randomUUID()); setStockInKey(crypto.randomUUID()); setTransferKey(crypto.randomUUID()); }}
                        className="mt-1 w-full rounded-lg bg-input p-2">
                        {selected.variants.map(variant => <option key={variant.id} value={variant.id}>{variant.label} {variant.sku ? `· ${variant.sku}` : ""}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {mode === "lookup" && <div className="mt-3 max-h-48 space-y-1 overflow-y-auto">
                    {stockRows.map(row => {
                      const local = row.locationId === config.location_id;
                      return <button key={`${row.locationId}-${row.variantId ?? ""}`} type="button"
                        disabled={!multiStoreEnabled || local || row.available <= 0} onClick={() => { setSource(row); setReservationKey(crypto.randomUUID()); }}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-60 ${source?.locationId === row.locationId ? "border-primary bg-primary/10" : "border-border hover:bg-input"}`}>
                        <span className="font-medium">{row.locationName}{local ? " · this shop" : ""}</span>
                        <span className="block text-xs">{row.available} available · {row.onHand} on hand · {row.reserved} reserved</span>
                      </button>;
                    })}
                    {!stockRows.length && <p className="text-sm text-muted-foreground">No location stock for this selection.</p>}
                  </div>}
                  {mode === "lookup" && source && <div className="mt-4 space-y-3 border-t border-border pt-4">
                    <p className="text-sm font-semibold">Reserve from {source.locationName} → {config.location_name}</p>
                    <div className="flex gap-2">
                      <label className="min-w-0 flex-1 text-xs">Customer name
                        <input value={customerName} onChange={event => { setCustomerName(event.target.value); setReservationKey(crypto.randomUUID()); }}
                          maxLength={120} className="mt-1 w-full rounded-lg bg-input p-2 text-sm" />
                      </label>
                      <label className="w-24 text-xs">Quantity
                        <input type="number" min="1" max={source.available} step="1" value={quantity}
                          onChange={event => { setQuantity(event.target.value); setReservationKey(crypto.randomUUID()); }}
                          className="mt-1 w-full rounded-lg bg-input p-2 text-sm" />
                      </label>
                    </div>
                    <button type="button" disabled={pending || !multiStoreEnabled} onClick={() => void reserve()}
                      className="w-full rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50">
                      {pending ? "Reserving…" : "Reserve for transfer"}
                    </button>
                  </div>}
                  {mode === "transfer" && <div className="mt-4 space-y-3 border-t border-border pt-4">
                    <p className="text-sm">Source: {config.location_name} · {stockRows.find(row => row.locationId === config.location_id)?.available ?? 0} available</p>
                    <label className="block text-sm">Destination shop
                      <select value={transferDestination} disabled={pending}
                        onChange={event => { setTransferDestination(event.target.value); setTransferKey(crypto.randomUUID()); }}
                        className="mt-1 w-full rounded-lg bg-input p-2" data-testid="select-pos-transfer-destination">
                        <option value="">Choose shop</option>
                        {transferDestinations(transferLocations, config.location_id).map(location =>
                          <option key={location.id} value={location.id}>{location.name}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm">Quantity to transfer
                      <input type="number" min="1" max="10000" step="1" value={transferQuantity} disabled={pending}
                        onChange={event => { setTransferQuantity(event.target.value); setTransferKey(crypto.randomUUID()); }}
                        className="mt-1 w-full rounded-lg bg-input p-2" data-testid="input-pos-transfer-quantity" />
                    </label>
                    <button type="button" disabled={pending || !transferDestination || !!selected.variants?.length && !variantId}
                      onClick={() => void transferStock()} data-testid="submit-pos-stock-transfer"
                      className="w-full rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50">
                      {pending ? "Transferring…" : "Complete stock transfer"}
                    </button>
                  </div>}
                  {mode === "stockIn" && <div className="mt-4 space-y-3 border-t border-border pt-4">
                    <p className="text-sm">Current on hand here: {stockRows.find(row => row.locationId === config.location_id)?.onHand ?? 0}</p>
                    <label className="block text-sm">Quantity physically received
                      <input type="number" min="1" max="10000" step="1" value={stockInQuantity}
                        onChange={event => { setStockInQuantity(event.target.value); setStockInKey(crypto.randomUUID()); }}
                        className="mt-1 w-full rounded-lg bg-input p-2" />
                    </label>
                    <button type="button" disabled={pending || !!selected.variants?.length && !variantId}
                      onClick={() => void stockIn()}
                      className="w-full rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50">
                      {pending ? "Recording…" : `Stock In to ${config.location_name}`}
                    </button>
                  </div>}
                </>
              )}
            </div>
          </div>
          <label className="mt-4 block text-sm">Cashier PIN to authorize stock actions
            <input type="password" inputMode="numeric" autoComplete="off" minLength={4} maxLength={8}
              value={pin} onChange={event => setPin(event.target.value)}
              className="mt-1 w-full max-w-56 rounded-lg bg-input p-2" />
          </label>
          {mode === "lookup" && !!reservations.length && <div className="mt-5 border-t border-border pt-4">
            <h3 className="mb-2 text-sm font-semibold">Incoming reservations for this shop</h3>
            <div className="max-h-36 space-y-2 overflow-y-auto">
              {reservations.filter(reservation => reservation.status === "reserved").map(reservation => (
                <div key={reservation.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2 text-sm">
                  <span className="min-w-0 truncate">{reservation.itemName || reservation.itemId} · {reservation.quantity} from {reservation.sourceLocationName || reservation.sourceLocationId} · {reservation.customerName}</span>
                  <button type="button" disabled={pending} onClick={() => void cancelReservation(reservation.id)}
                    className="shrink-0 rounded border border-border px-2 py-1 text-xs hover:bg-input disabled:opacity-50">Release</button>
                </div>
              ))}
            </div>
          </div>}
        </div>
      </section>
    </div>
  );
}