import { useRef, useState } from "react";
import {
  InvoiceApiError, amountTenderedCents, basketFingerprint, validateCheckout, validateQuote, euro, fetchInvoiceHtml, invoiceRequest, paymentBlockReason, termsLabel, validPin,
  type CheckoutResult, type InvoiceConn, type InvoiceCustomer, type InvoiceLineInput, type InvoiceMode, type PayMethod, type Quote,
} from "../lib/customer-invoice";

type Props = {
  mode: InvoiceMode;
  config: InvoiceConn;
  cashierId: string;
  lines: InvoiceLineInput[];
  onClose: () => void;
  /** Called once the server has finalized the invoice; the caller must clear the cart. */
  onCompleted: (result: CheckoutResult) => void;
};

const input = "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-primary disabled:opacity-50";
const btn = "rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${btn} bg-primary text-primary-foreground`;
const ghost = `${btn} bg-gray-800 text-gray-200 hover:bg-gray-700`;

export function CustomerInvoiceDialog({ mode, config, cashierId, lines, onClose, onCompleted }: Props) {
  const [pin, setPin] = useState("");
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<InvoiceCustomer[] | null>(null);
  const [customer, setCustomer] = useState<InvoiceCustomer | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [method, setMethod] = useState<PayMethod>(mode === "retail" ? "account_credit" : "cash");
  const [tender, setTender] = useState("");
  const [cardReference, setCardReference] = useState("");
  const [cardConfirmed, setCardConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [notice, setNotice] = useState("");
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const [quotedLines, setQuotedLines] = useState<InvoiceLineInput[]>([]);
  const keyRef = useRef(crypto.randomUUID());
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const frozen = busy || ambiguous;
  const title = mode === "wholesale" ? "Wholesale Invoice" : "Customer Account Sale";
  const pay = { method, tender, cardReference, cardConfirmed };
  const basketChanged = !!quote && !result && basketFingerprint(lines) !== basketFingerprint(quotedLines);
  const blocked = basketChanged ? "The cart changed after this quote. Reprice before charging." : quote ? paymentBlockReason(quote, pay, mode) : "No quote";

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : "Request failed.");
  }

  async function findCustomers() {
    if (!validPin(pin)) { setError("Enter your cashier PIN (4-8 digits)."); return; }
    setBusy(true); setError("");
    try {
      const data = await invoiceRequest<{ customers: InvoiceCustomer[] }>(config, "POST", "customers", { search: search.trim(), cashierId, pin });
      setCustomers(data.customers);
      if (!data.customers.length) setError("No eligible customers found.");
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function getQuote(selected: InvoiceCustomer) {
    if (frozen) return;
    setBusy(true); setError(""); setConfirmed(false);
    try {
      const snapshot = lines.map(l => ({ ...l }));
      const q = validateQuote(await invoiceRequest<unknown>(config, "POST", "quote", { customerId: selected.id, mode, lines: snapshot, cashierId, pin }));
      setCustomer(selected);
      setQuotedLines(snapshot);
      setQuote(q);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function checkout() {
    if (!quote || !customer || busy || blocked || !confirmed) return;
    // A fresh key for every new attempt, except when the previous outcome is unknown: then reuse it.
    if (!ambiguous) keyRef.current = crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const raw = await invoiceRequest<unknown>(config, "POST", "checkout", {
        customerId: customer.id, mode, lines: quotedLines, cashierId, pin,
        orderId: keyRef.current, expectedTotalCents: quote.totalCents, quoteHash: quote.quoteHash,
        paymentMethod: method, amountTenderedCents: amountTenderedCents(quote, pay),
        ...(method === "card" ? { cardReference: cardReference.trim() } : {}),
      });
      const data = validateCheckout(raw, keyRef.current, quote.totalCents, method);
      setAmbiguous(false);
      setResult(data);
      onCompleted(data);
    } catch (e) {
      const isAmb = e instanceof InvoiceApiError && e.ambiguous;
      setAmbiguous(isAmb);
      if (e instanceof InvoiceApiError && !isAmb && (e.status === 409 || e.code === "QUOTE_CHANGED" || e.code === "PRICE_CHANGED")) {
        setConfirmed(false);
        setError(`${e.message} Reprice before charging.`);
      } else if (isAmb) {
        setError(`${(e as Error).message} The invoice may already exist. Retry the same payment; do not take money twice.`);
      } else fail(e);
    } finally { setBusy(false); }
  }

  async function printInvoice() {
    if (!result) return;
    setNotice(""); setBusy(true);
    try {
      setPrintHtml(await fetchInvoiceHtml(config, result.invoiceId));
    } catch (e) { setNotice(e instanceof Error ? e.message : "Could not load the invoice."); } finally { setBusy(false); }
  }

  async function emailInvoice() {
    if (!result) return;
    setNotice(""); setBusy(true);
    try {
      await invoiceRequest(config, "POST", `${encodeURIComponent(result.invoiceId)}/email`, { cashierId, pin });
      setNotice("Invoice emailed to the customer's saved address.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Email failed."); } finally { setBusy(false); }
  }

  const credit = quote?.credit;
  const lineCount = lines.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" data-testid="customer-invoice-dialog">
      <div className="flex max-h-[94vh] w-full max-w-2xl flex-col rounded-2xl border border-gray-700 bg-gray-900 p-5 text-white shadow-2xl">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-xs text-gray-400">
              {mode === "wholesale" ? "Applies the customer's contract and wholesale prices." : "Retail prices; wholesale discounts do not apply."} Online only.
            </p>
          </div>
          <button onClick={onClose} disabled={frozen} aria-label="Close" className="px-2 text-xl text-gray-400 hover:text-white disabled:opacity-30" data-testid="button-invoice-close">×</button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {result ? (
            <div className="space-y-3 text-center" data-testid="invoice-success">
              <p className="text-sm text-gray-400">Invoice issued{result.deduplicated ? " (existing invoice returned)" : ""}</p>
              <p className="font-mono text-3xl font-bold" data-testid="text-invoice-number">{result.invoiceNumber}</p>
              <p className="text-gray-300">Order {result.orderNumber} - {euro(result.totalCents)} - {result.paymentMethod.replace("_", " ")}</p>
              {result.changeDueCents > 0 && <p className="text-lg font-semibold text-green-400">Change due {euro(result.changeDueCents)}</p>}
              <div className="flex flex-wrap justify-center gap-2">
                <button className={primary} disabled={busy} onClick={() => void printInvoice()} data-testid="button-print-invoice">Print invoice</button>
                <button className={ghost} disabled={busy} onClick={() => void emailInvoice()} data-testid="button-email-invoice">Email to customer</button>
                <button className={ghost} onClick={onClose} data-testid="button-invoice-done">Done</button>
              </div>
              {notice && <p role="status" className="text-sm text-amber-300" data-testid="text-invoice-notice">{notice}</p>}
              {printHtml !== null && (
                <iframe ref={iframeRef} title="Invoice" sandbox="allow-same-origin allow-modals" srcDoc={printHtml}
                  className="pointer-events-none absolute h-0 w-0 border-0"
                  onLoad={() => { try { iframeRef.current?.contentWindow?.print(); } catch { setNotice("Printing was blocked on this device."); } }} />
              )}
            </div>
          ) : !quote ? (
            <>
              <p className="text-sm text-gray-300">{lineCount} cart line{lineCount === 1 ? "" : "s"} will be invoiced.</p>
              <label className="block text-xs text-gray-400">Cashier PIN
                <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={e => setPin(e.target.value)} className={`${input} mt-1`} data-testid="input-invoice-pin" />
              </label>
              <div className="flex gap-2">
                <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && void findCustomers()}
                  placeholder="Customer name or code" className={input} data-testid="input-invoice-customer-search" />
                <button className={primary} disabled={busy || lineCount === 0} onClick={() => void findCustomers()} data-testid="button-invoice-search">{busy ? "..." : "Search"}</button>
              </div>
              {lineCount === 0 && <p className="text-sm text-amber-300">Add items to the cart first.</p>}
              {customers && customers.length > 0 && (
                <div className="space-y-2">
                  {customers.map(c => (
                    <button key={c.id} disabled={busy} onClick={() => void getQuote(c)} data-testid={`button-invoice-customer-${c.id}`}
                      className="w-full rounded-xl border border-gray-700 bg-gray-800 p-3 text-left hover:border-primary disabled:opacity-50">
                      <span className="block font-semibold">{c.name}</span>
                      <span className="text-xs text-gray-400">{c.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="rounded-xl border border-gray-700 bg-gray-800 p-3">
                <div className="flex items-baseline justify-between">
                  <p className="font-semibold" data-testid="text-invoice-customer">{quote.customer.name} <span className="font-mono text-xs text-gray-400">{quote.customer.code}</span></p>
                  <span className={`rounded px-2 py-0.5 text-xs ${credit!.approvalStatus === "approved" ? "bg-green-900 text-green-200" : "bg-red-900 text-red-200"}`} data-testid="status-credit-approval">
                    Credit {credit!.approvalStatus}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4" data-testid="credit-summary">
                  <div><dt className="text-xs text-gray-400">Limit</dt><dd>{euro(credit!.limitCents)}</dd></div>
                  <div><dt className="text-xs text-gray-400">Owed</dt><dd>{euro(credit!.balanceCents)}</dd></div>
                  <div><dt className="text-xs text-gray-400">Available</dt><dd>{euro(credit!.availableCents)}</dd></div>
                  <div><dt className="text-xs text-gray-400">Terms</dt><dd>{termsLabel(credit!.paymentTerms)}</dd></div>
                </dl>
                {credit!.hasOverdue && <p role="alert" className="mt-2 rounded bg-amber-500/15 p-2 text-sm text-amber-300" data-testid="warning-overdue">
                  Overdue balance of {euro(credit!.overdueCents)}. This is a warning and does not block the sale.</p>}
              </div>

              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400"><th>Item</th><th className="text-right">Qty</th><th className="text-right">Net price</th><th className="text-right">Disc</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {quote.lines.map((l, i) => (
                    <tr key={`${l.itemId}-${l.variantId ?? ""}-${i}`} className="border-t border-gray-800">
                      <td className="py-1.5 pr-2">{l.description}</td>
                      <td className="text-right">{l.quantity} {l.saleUnit}</td>
                      <td className="text-right">{l.unitPrice.toFixed(2)}</td>
                      <td className="text-right">{l.discountPercent ? `${l.discountPercent}%` : "-"}</td>
                      <td className="text-right">{euro(l.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="space-y-0.5 text-right text-sm">
                <p className="text-gray-400">Subtotal (net, excl. VAT) {euro(quote.subtotalCents)}</p>
                <p className="text-gray-400">VAT {euro(quote.vatCents)}</p>
                <p className="text-xl font-bold" data-testid="text-invoice-total">Total {euro(quote.totalCents)}</p>
              </div>

              <div className="space-y-3 rounded-xl border border-gray-700 p-3">
                <div className="grid grid-cols-3 gap-2">
                  {(["cash", "card", "account_credit"] as PayMethod[]).map(m => (
                    <button key={m} disabled={frozen} onClick={() => setMethod(m)} data-testid={`button-invoice-method-${m}`}
                      className={`${btn} ${method === m ? "bg-primary text-primary-foreground" : "bg-gray-800 text-gray-200"}`}>
                      {m === "cash" ? "Cash" : m === "card" ? "Card (recorded)" : "On account"}
                    </button>
                  ))}
                </div>
                {method === "cash" && (
                  <label className="block text-xs text-gray-400">Cash tendered
                    <input type="number" min="0" step="0.01" value={tender} readOnly={frozen} onChange={e => setTender(e.target.value)} className={`${input} mt-1`} data-testid="input-invoice-tender" />
                  </label>
                )}
                {method === "card" && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400">This only records a payment already approved on the external card terminal. Nothing is charged here.</p>
                    <input value={cardReference} readOnly={frozen} onChange={e => setCardReference(e.target.value)} placeholder="Terminal approval reference" className={input} data-testid="input-invoice-card-reference" />
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" checked={cardConfirmed} disabled={frozen} onChange={e => setCardConfirmed(e.target.checked)} className="mt-1" data-testid="checkbox-invoice-card-confirmed" />
                      The external terminal approved {euro(quote.totalCents)} for this sale.
                    </label>
                  </div>
                )}
                {method === "account_credit" && (
                  <p className="text-sm text-gray-300">Charged to the customer's account ({euro(credit!.availableCents)} available).</p>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={confirmed} disabled={frozen} onChange={e => setConfirmed(e.target.checked)} className="mt-1" data-testid="checkbox-invoice-confirm-quote" />
                  I confirm these prices and the total of {euro(quote.totalCents)}.
                </label>
                {blocked && <p className="text-sm text-amber-300" data-testid="text-invoice-blocked">{blocked}</p>}
              </div>
            </>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-500/15 p-3 text-sm text-red-300" data-testid="text-invoice-error">{error}</p>}
        </div>

        {quote && !result && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className={ghost} disabled={frozen} onClick={() => { setQuote(null); setConfirmed(false); setError(""); }} data-testid="button-invoice-back">Change customer</button>
            <button className={ghost} disabled={frozen} onClick={() => customer && void getQuote(customer)} data-testid="button-invoice-reprice">Reprice</button>
            <button className={`${primary} ml-auto flex-1`} disabled={busy || !!blocked || !confirmed} onClick={() => void checkout()} data-testid="button-invoice-checkout">
              {busy ? "Submitting..." : ambiguous ? "Retry same invoice" : `Issue invoice ${euro(quote.totalCents)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
