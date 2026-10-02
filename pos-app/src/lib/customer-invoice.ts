export type InvoiceMode = "wholesale" | "retail";
export type PayMethod = "cash" | "card" | "account_credit";
export type InvoiceConn = { server_url: string; terminal_code: string; voucher_device_key?: string };
export type InvoiceCustomer = { id: string; name: string; code: string; priceLevel?: number };
export type CreditSummary = {
  approvalStatus: "pending" | "approved" | "suspended";
  limitCents: number; balanceCents: number; availableCents: number;
  paymentTerms: string; overdueCents: number; hasOverdue: boolean;
};
export type QuoteLine = {
  itemId: string; variantId: string | null; description: string; quantity: number; saleUnit: string;
  unitPrice: number; discountPercent: number; totalCents: number; vatCents: number; vatRate: number;
};
export type Quote = {
  customer: { id: string; name: string; code: string }; credit: CreditSummary; lines: QuoteLine[];
  subtotalCents: number; vatCents: number; totalCents: number; quoteHash: string;
};
export type CheckoutResult = {
  orderId: string; orderNumber: string; invoiceId: string; invoiceNumber: string; totalCents: number;
  changeDueCents: number; paymentMethod: PayMethod; deduplicated: boolean;
};
export type InvoiceLineInput = { itemId: string; variantId?: string | null; quantity: number; saleUnit?: "pc" | "pack" };

export class InvoiceApiError extends Error {
  code: string | null; status: number | null; ambiguous: boolean;
  constructor(message: string, code: string | null, status: number | null, ambiguous: boolean) {
    super(message); this.code = code; this.status = status; this.ambiguous = ambiguous;
  }
}

export const euro = (cents: number) => new Intl.NumberFormat("en-CY", { style: "currency", currency: "EUR" }).format(cents / 100);

export function parseCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export const validPin = (pin: string) => /^\d{4,8}$/.test(pin);

export function termsLabel(terms: string): string {
  if (terms === "cash") return "Cash";
  const match = /^credit_(\d+)$/.exec(terms);
  return match ? `${match[1]} days` : terms;
}

export function accountBlockReason(credit: CreditSummary, totalCents: number): string | null {
  if (credit.approvalStatus === "pending") return "Credit is not approved for this customer.";
  if (credit.approvalStatus === "suspended") return "Credit is suspended for this customer.";
  if (totalCents > credit.availableCents) return `Total exceeds available credit (${euro(credit.availableCents)}).`;
  return null;
}

export type PayInputs = { method: PayMethod; tender: string; cardReference: string; cardConfirmed: boolean };

/** Returns an error string when the chosen payment cannot be submitted, otherwise null. */
export function paymentBlockReason(quote: Quote, p: PayInputs, mode: InvoiceMode): string | null {
  if (quote.totalCents <= 0) return "Nothing to charge.";
  if (p.method === "cash") {
    const t = parseCents(p.tender);
    return t === null || t < quote.totalCents ? "Cash tendered must cover the total." : null;
  }
  if (p.method === "card") {
    if (!p.cardReference.trim()) return "Enter the approved terminal reference.";
    return p.cardConfirmed ? null : "Confirm the card payment was already approved on the external terminal.";
  }
  if (mode === "retail" && quote.credit.approvalStatus !== "approved") return "Credit is not approved for this customer.";
  return accountBlockReason(quote.credit, quote.totalCents);
}

export function amountTenderedCents(quote: Quote, p: PayInputs): number {
  if (p.method === "cash") return parseCents(p.tender) ?? 0;
  return 0;
}

/** Network failures, 5xx and malformed bodies leave the outcome unknown; the same key must be reused. */
export function isAmbiguousFailure(status: number | null, malformed = false): boolean {
  return malformed || status === null || status === 408 || status >= 500;
}

type CartLike = { product_id?: string; qty: number; variant_id?: string | null; sale_unit?: string; voided?: boolean };

/** Maps cart rows to API lines. Rows that differ by variant or sale unit stay separate; quantities are never merged across them. */
export function mapCartLines(cart: CartLike[]): InvoiceLineInput[] {
  const out = new Map<string, InvoiceLineInput>();
  for (const row of cart) {
    if (row.voided || !row.product_id || !(row.qty > 0)) continue;
    const variantId = row.variant_id ?? null;
    const saleUnit: "pc" | "pack" = row.sale_unit === "pack" ? "pack" : "pc";
    const key = `${row.product_id}|${variantId ?? ""}|${saleUnit}`;
    const existing = out.get(key);
    if (existing) existing.quantity += row.qty;
    else out.set(key, { itemId: row.product_id, variantId, quantity: row.qty, saleUnit });
  }
  return [...out.values()];
}

/** Stable fingerprint of a basket, order independent. */
export function basketFingerprint(lines: InvoiceLineInput[]): string {
  return lines.map(l => `${l.itemId}|${l.variantId ?? ""}|${l.saleUnit ?? "pc"}|${l.quantity}`).sort().join(";");
}

export type PendingInvoice = {
  localShiftId?: string;
  request: {
    customerId: string; mode: InvoiceMode; lines: InvoiceLineInput[];
    orderId: string; expectedTotalCents: number; quoteHash: string;
    paymentMethod: PayMethod; amountTenderedCents: number; cardReference?: string;
  };
  quote: Quote;
};

function pendingKey(conn: InvoiceConn, cashierId: string): string {
  return `globipos:pending-invoice:v1:${JSON.stringify([conn.server_url.replace(/\/$/, ""), conn.terminal_code, cashierId])}`;
}

/** Persist only the immutable purchase, never the PIN or paired-device key. */
export function readPendingInvoice(conn: InvoiceConn, cashierId: string): PendingInvoice | null {
  const value = localStorage.getItem(pendingKey(conn, cashierId));
  if (!value) return null;
  try {
    const pending = JSON.parse(value) as PendingInvoice;
    validateQuote(pending.quote);
    const r = pending.request;
    if (!r || !["retail", "wholesale"].includes(r.mode) ||
        !["cash", "card", "account_credit"].includes(r.paymentMethod) ||
        typeof r.orderId !== "string" || !r.orderId ||
        !Array.isArray(r.lines) || r.customerId !== pending.quote.customer.id ||
        r.expectedTotalCents !== pending.quote.totalCents ||
        r.quoteHash !== pending.quote.quoteHash ||
        !Number.isSafeInteger(r.amountTenderedCents) || r.amountTenderedCents < 0 ||
        "pin" in r || "voucher_device_key" in r) throw new Error("Invalid recovery data");
    return pending;
  } catch {
    throw new InvoiceApiError("Saved invoice recovery data is unreadable. Check issued invoices in the back office before making another invoice.", "RECOVERY_INVALID", null, true);
  }
}

export function savePendingInvoice(conn: InvoiceConn, cashierId: string, pending: PendingInvoice): void {
  const existing = readPendingInvoice(conn, cashierId);
  if (existing && existing.request.orderId !== pending.request.orderId) {
    throw new InvoiceApiError("An unfinished invoice must be recovered first.", "RECOVERY_REQUIRED", null, true);
  }
  localStorage.setItem(pendingKey(conn, cashierId), JSON.stringify(pending));
}

export function clearPendingInvoice(conn: InvoiceConn, cashierId: string): void {
  localStorage.removeItem(pendingKey(conn, cashierId));
}

export function validateQuote(data: any): Quote {
  const ok = data && typeof data.quoteHash === "string" && data.quoteHash && Array.isArray(data.lines) &&
    Number.isSafeInteger(data.totalCents) && Number.isSafeInteger(data.subtotalCents) && Number.isSafeInteger(data.vatCents) &&
    data.customer && typeof data.customer.id === "string" && data.credit &&
    ["pending", "approved", "suspended"].includes(data.credit.approvalStatus) &&
    ["limitCents", "balanceCents", "availableCents", "overdueCents"].every(k => Number.isSafeInteger(data.credit[k])) &&
    data.lines.every((l: any) => l && typeof l.itemId === "string" && Number.isSafeInteger(l.totalCents) && typeof l.unitPrice === "number");
  if (!ok) throw new InvoiceApiError("The quote reply was incomplete. Request a new quote.", null, null, false);
  return data as Quote;
}

export function validateCheckout(data: any, orderId: string, expectedTotalCents: number, method: PayMethod): CheckoutResult {
  const ok = data && typeof data.invoiceNumber === "string" && data.invoiceNumber && typeof data.invoiceId === "string" && data.invoiceId &&
    typeof data.orderNumber === "string" && data.orderId === orderId && data.totalCents === expectedTotalCents &&
    data.paymentMethod === method && Number.isSafeInteger(data.changeDueCents);
  if (!ok) throw new InvoiceApiError("The invoice reply did not match this sale.", null, null, true);
  return data as CheckoutResult;
}

const STATUS_TEXT: Record<number, string> = {
  400: "The request was rejected as invalid.", 401: "Cashier PIN or device key was not accepted.",
  403: "This device or cashier is not allowed to do that.", 404: "Not found on the server.",
  409: "The sale changed on the server.", 422: "The request could not be processed.", 429: "Too many attempts. Wait and try again.",
  408: "The server timed out.",
};
export const failureText = (status: number, message?: string | null) =>
  message || STATUS_TEXT[status] || (status >= 500 ? `Server error (${status}).` : `Request failed (${status}).`);

export async function invoiceRequest<T>(conn: InvoiceConn, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new InvoiceApiError("Customer invoices need a live connection to the store server.", null, null, false);
  if (!conn.voucher_device_key) throw new InvoiceApiError("Pair this device in Terminal Settings first.", "DEVICE_NOT_PAIRED", null, false);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${conn.server_url.replace(/\/$/, "")}/api/pos/customer-invoices/${path}`, {
      method, cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-Terminal-Code": conn.terminal_code, "X-Voucher-Device-Key": conn.voucher_device_key },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new InvoiceApiError(failureText(response.status, data?.message), data?.code ?? null, response.status, isAmbiguousFailure(response.status));
    }
    const data = await response.json().catch(() => null);
    if (data === null) throw new InvoiceApiError("The server reply was unreadable.", null, response.status, true);
    return data as T;
  } catch (error) {
    if (error instanceof InvoiceApiError) throw error;
    throw new InvoiceApiError("Connection to the store server failed.", null, null, true);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchInvoiceHtml(conn: InvoiceConn, invoiceId: string): Promise<string> {
  if (!conn.voucher_device_key) throw new InvoiceApiError("Pair this device in Terminal Settings first.", "DEVICE_NOT_PAIRED", null, false);
  const response = await fetch(`${conn.server_url.replace(/\/$/, "")}/api/pos/customer-invoices/${encodeURIComponent(invoiceId)}/document`, {
    cache: "no-store",
    headers: { "X-Terminal-Code": conn.terminal_code, "X-Voucher-Device-Key": conn.voucher_device_key },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new InvoiceApiError(failureText(response.status, data?.message), data?.code ?? null, response.status, false);
  }
  return response.text();
}
