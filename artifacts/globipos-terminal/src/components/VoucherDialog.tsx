import { useEffect, useState } from "react";
import { X, Printer } from "lucide-react";
import type { CashierSession, OrderLine, TerminalConfig } from "../types";

type Voucher = { serial: string; amountCents: number; balanceCents: number; currency: "EUR" };
type ReturnLine = {
  lineId: string;
  description: string;
  soldQuantityMilli: number;
  returnedQuantityMilli: number;
  remainingQuantityMilli: number;
  refundableAmountCents: number;
};
type ReturnPreview = { orderNumber: string; totalRefundableCents: number; lines: ReturnLine[] };
type VoucherResult =
  | { operation: "sale"; orderNumber: string; voucher: Voucher }
  | { operation: "return"; orderNumber: string; refundAmountCents: number; voucher: Voucher }
  | { operation: "redeem"; orderNumber: string; totalCents: number; voucherAppliedCents: number; cashPaidCents: number; changeDueCents: number; replacementVoucher: Voucher | null };

type Props = {
  mode: "issue" | "redeem";
  config: TerminalConfig;
  session: CashierSession;
  cart: OrderLine[];
  total: number;
  onClose: () => void;
  onRedeemed: (orderNumber: string) => void;
};

const euro = (cents: number) => new Intl.NumberFormat("en-CY", { style: "currency", currency: "EUR" }).format(cents / 100);

function moneyCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function VoucherDialog({ mode, config, session, cart, total, onClose, onRedeemed }: Props) {
  const [issueType, setIssueType] = useState<"sale" | "return">("sale");
  const [amount, setAmount] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [serial, setSerial] = useState("");
  const [cashPaid, setCashPaid] = useState("0");
  const [pin, setPin] = useState("");
  const [preview, setPreview] = useState<ReturnPreview | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [result, setResult] = useState<VoucherResult | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function changed() {
    setKey(crypto.randomUUID());
    setError("");
  }

  async function request(path: string, body: Record<string, unknown>): Promise<any> {
    if (!navigator.onLine) throw new Error("Vouchers require a live connection to the store server.");
    if (!config.voucher_device_key) throw new Error("Pair this device in Terminal Settings before using vouchers.");
    const response = await fetch(`${config.server_url}/api/pos/vouchers/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Terminal-Code": config.terminal_code,
        "X-Voucher-Device-Key": config.voucher_device_key },
      cache: "no-store",
      body: JSON.stringify({ ...body, cashierId: session.cashier_id, pin }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || `Voucher service returned ${response.status}`);
    return data;
  }

  async function loadReturn() {
    setPending(true); setError(""); setPreview(null);
    try {
      const data = await request("return-preview", { orderNumber: orderNumber.trim() }) as ReturnPreview;
      if (!Array.isArray(data.lines) || !Number.isInteger(data.totalRefundableCents)) throw new Error("Invalid return preview.");
      setPreview(data);
      setQuantities(Object.fromEntries(data.lines.map(line =>
        [line.lineId, line.remainingQuantityMilli > 0 ? String(line.remainingQuantityMilli / 1000) : "0"])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the return.");
    } finally { setPending(false); }
  }

  async function submit() {
    if (pending || result) return;
    setPending(true); setError("");
    try {
      let data: VoucherResult;
      if (mode === "redeem") {
        const extra = moneyCents(cashPaid);
        if (extra === null || extra < 0 || !cart.length) throw new Error("Enter the serial and a valid cash amount for the current sale.");
        const lines = cart.filter(line => !line.voided).map(line => ({
          itemId: line.product_id, quantity: line.qty,
        }));
        if (lines.some(line => !line.itemId)) throw new Error("All sale items must be linked to catalog products.");
        data = await request("redeem", {
          serial: serial.trim().toUpperCase(), lines, expectedTotalCents: Math.round(total * 100),
          cashPaidCents: extra, idempotencyKey: key,
        }) as VoucherResult;
      } else if (issueType === "sale") {
        const cents = moneyCents(amount);
        if (!cents || cents > 100_000) throw new Error("Enter a gift voucher amount from €0.01 to €1,000.00.");
        data = await request("sale", { amountCents: cents, idempotencyKey: key }) as VoucherResult;
      } else {
        if (!preview) throw new Error("Look up a completed return before issuing credit.");
        const lines = preview.lines.flatMap(line => {
          const milli = Math.round(Number(quantities[line.lineId]) * 1000);
          return Number.isInteger(milli) && milli > 0 ? [{ lineId: line.lineId, quantity: milli / 1000 }] : [];
        });
        if (!lines.length || lines.some(line => !Number.isFinite(line.quantity))) throw new Error("Choose a positive return quantity.");
        data = await request("return", { orderNumber: preview.orderNumber, lines, idempotencyKey: key }) as VoucherResult;
      }
      if (data.operation === "redeem") {
        if (typeof data.orderNumber !== "string" || !Number.isInteger(data.voucherAppliedCents)) throw new Error("The server returned an incomplete redemption receipt. Do not retry with another key.");
        onRedeemed(data.orderNumber);
      } else if (!data.voucher?.serial || !Number.isInteger(data.voucher.amountCents)) {
        throw new Error("The server returned an incomplete voucher. Retry with the same request details.");
      }
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Voucher request failed. Retry with the same details.");
    } finally { setPending(false); }
  }

  useEffect(() => {
    if (!result) return;
    // Print is attempted only after a successful server commit; the Print button remains available for retries.
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, [result]);

  const receiptVoucher = result && (result.operation === "redeem" ? result.replacementVoucher : result.voucher);
  const selectedReturnCents = preview?.lines.reduce((sum, line) => {
    const selectedMilli = Math.round(Number(quantities[line.lineId] || 0) * 1000);
    return sum + (Number.isFinite(selectedMilli) && selectedMilli > 0 && line.remainingQuantityMilli > 0
      ? Math.round(line.refundableAmountCents * selectedMilli / line.remainingQuantityMilli) : 0);
  }, 0) ?? 0;
  const canSubmit = pin.length >= 4 && pin.length <= 8 &&
    (mode === "redeem" ? cart.length > 0 && !!serial.trim() : issueType === "sale" ? !!moneyCents(amount) : !!preview);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4">
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #voucher-print, #voucher-print * { visibility: visible !important; }
        #voucher-print { position: absolute !important; left: 0; top: 0; width: 72mm; padding: 4mm; color: black !important; background: white !important; }
      }`}</style>
      <section role="dialog" aria-modal="true" aria-label="Gift voucher" className="my-auto w-full max-w-lg space-y-4 rounded-xl bg-card p-5 text-foreground shadow-2xl">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{result ? "Voucher transaction completed" : mode === "redeem" ? "Redeem gift voucher" : "Gift voucher / return credit"}</h2>
          <button type="button" aria-label="Close voucher" onClick={onClose}><X className="h-5 w-5" /></button>
        </header>
        {result ? (
          <>
            <div id="voucher-print" className="space-y-3 rounded-lg border border-dashed border-border bg-white p-5 text-center text-black">
              <h3 className="text-lg font-bold">{result.operation === "return" ? "RETURN CREDIT NOTE" : result.operation === "sale" ? "GIFT VOUCHER" : "VOUCHER REDEMPTION"}</h3>
              <p className="text-sm">Order {result.orderNumber}</p>
              {result.operation === "redeem" && <p>Used {euro(result.voucherAppliedCents)} · Cash {euro(result.cashPaidCents)}
                {result.changeDueCents > 0 && <> · Change {euro(result.changeDueCents)}</>}</p>}
              {receiptVoucher ? (
                <>
                  {result.operation === "redeem" && <p className="font-semibold">Replacement voucher — remaining balance</p>}
                  <p className="text-3xl font-bold">{euro(receiptVoucher.amountCents)}</p>
                  <p className="font-mono text-lg tracking-wider break-all">{receiptVoucher.serial}</p>
                  <p className="text-xs">Present this serial at the next purchase. A redeemed serial cannot be reused.</p>
                </>
              ) : <p className="text-sm">Voucher fully used. No replacement balance.</p>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => window.print()} className="flex items-center gap-2 rounded-lg border px-4 py-2"><Printer className="h-4 w-4" />Print again</button>
              <button type="button" onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">Done</button>
            </div>
          </>
        ) : (
          <>
            {mode === "issue" && <div className="flex gap-2">
              <button type="button" className={`rounded-lg px-3 py-2 text-sm ${issueType === "sale" ? "bg-primary text-primary-foreground" : "bg-input"}`}
                onClick={() => { setIssueType("sale"); changed(); }}>Sell gift voucher</button>
              <button type="button" className={`rounded-lg px-3 py-2 text-sm ${issueType === "return" ? "bg-primary text-primary-foreground" : "bg-input"}`}
                onClick={() => { setIssueType("return"); changed(); }}>Return → credit note</button>
            </div>}
            {mode === "redeem" ? (
              <>
                <p className="text-sm">Current purchase: {euro(Math.round(total * 100))}. The server checks the serial and completes this sale online. If the voucher exceeds the purchase, its remainder gets a new serial.</p>
                <label className="block text-sm">Voucher serial
                  <input autoFocus value={serial} onChange={event => { setSerial(event.target.value); changed(); }}
                    className="mt-1 w-full rounded-lg bg-input p-3 font-mono uppercase" placeholder="Scan or enter serial" />
                </label>
                <label className="block text-sm">Additional cash collected (€), if needed
                  <input type="number" min="0" step="0.01" value={cashPaid} onChange={event => { setCashPaid(event.target.value); changed(); }}
                    className="mt-1 w-full rounded-lg bg-input p-3" />
                </label>
              </>
            ) : issueType === "sale" ? (
              <>
                <p className="text-sm">Collect cash first. The voucher becomes spendable when the online cash sale is recorded.</p>
                <label className="block text-sm">Gift voucher value (€)
                  <input autoFocus type="number" min="0.01" max="1000" step="0.01" value={amount}
                    onChange={event => { setAmount(event.target.value); changed(); }}
                    className="mt-1 w-full rounded-lg bg-input p-3" />
                </label>
              </>
            ) : (
              <>
                <p className="text-sm">Look up a completed sale. Its selected return lines show the negative POS value; credit is issued only when the server completes the return.</p>
                <div className="flex gap-2">
                  <input value={orderNumber} onChange={event => { setOrderNumber(event.target.value); setPreview(null); changed(); }}
                    className="min-w-0 flex-1 rounded-lg bg-input p-3" placeholder="Original order number" aria-label="Original order number" />
                  <button type="button" disabled={pending || !orderNumber.trim() || pin.length < 4} onClick={() => void loadReturn()}
                    className="rounded-lg border px-3 py-2 disabled:opacity-50">Look up</button>
                </div>
                {preview && <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {preview.lines.filter(line => line.remainingQuantityMilli > 0).map(line => (
                    <label key={line.lineId} className="flex items-center justify-between gap-2 text-sm">
                      <span>{line.description} · up to {line.remainingQuantityMilli / 1000}</span>
                      <input type="number" min="0" max={line.remainingQuantityMilli / 1000} step="0.001"
                        value={quantities[line.lineId] ?? "0"} onChange={event => { setQuantities(old => ({ ...old, [line.lineId]: event.target.value })); changed(); }}
                        className="w-24 rounded bg-input p-2 text-right" aria-label={`Return quantity for ${line.description}`} />
                    </label>
                  ))}
                  <p className="text-sm font-bold">Selected return estimate: -{euro(selectedReturnCents)}</p>
                  <p className="text-xs text-muted-foreground">Maximum available: {euro(preview.totalRefundableCents)}. Final value is verified by the server when the return completes.</p>
                </div>}
              </>
            )}
            <label className="block text-sm">Cashier PIN for online authorization
              <input type="password" inputMode="numeric" autoComplete="off" minLength={4} maxLength={8} value={pin}
                onChange={event => setPin(event.target.value)} className="mt-1 w-full rounded-lg bg-input p-3" />
            </label>
            {error && <p role="alert" className="rounded border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2">Cancel</button>
              <button type="button" disabled={pending || !canSubmit} onClick={() => void submit()}
                className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50">
                {pending ? "Checking…" : mode === "redeem" ? "Check serial & complete sale" : issueType === "return" ? "Complete return & print credit" : "Record cash sale & print voucher"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}