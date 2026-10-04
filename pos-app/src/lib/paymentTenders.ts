export type TenderMethod =
  | "cash" | "card_jcc" | "card_viva" | "card_worldpay"
  | "voucher" | "loyalty" | "account_credit" | "cheque" | "credit_note";

export interface Tender {
  id: string;
  method: TenderMethod;
  amount: number;
  reference?: string;
  approved?: boolean;
  label: string;
  settleId?: string;
}

export function cents(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error("Payment amount must be finite.");
  return Math.round((amount + Number.EPSILON) * 100);
}

export function tenderTotals(tenders: Tender[], total: number) {
  const paid = tenders.reduce((sum, t) => sum + cents(t.amount), 0);
  const cash = tenders.filter(t => t.method === "cash").reduce((sum, t) => sum + cents(t.amount), 0);
  const due = cents(total) - paid;
  const change = Math.max(0, -due);
  return {
    totalTendered: paid / 100,
    balance: due / 100,
    changeDue: change / 100,
    isComplete: cents(total) > 0 && due <= 0 && change <= cash,
  };
}

export function validateTenders(tenders: Tender[], total: number) {
  if (!tenders.length) throw new Error("No payments have been claimed.");
  const ids = new Set<string>();
  for (const tender of tenders) {
    if (!tender.id || ids.has(tender.id) || cents(tender.amount) <= 0) throw new Error("Invalid payment breakdown.");
    ids.add(tender.id);
    if (tender.method.startsWith("card_") && (tender.approved !== true || !tender.reference?.trim())) {
      throw new Error("Card approval and a terminal reference are required.");
    }
  }
  const totals = tenderTotals(tenders, total);
  if (!totals.isComplete) throw new Error("Payments do not cover the sale, or change exceeds the cash received.");
  return totals;
}

export function tenderLabel(method: TenderMethod): string {
  const labels: Record<TenderMethod, string> = {
    cash: "Cash", card_jcc: "Card (JCC)", card_viva: "Card (Viva)",
    card_worldpay: "Card (Worldpay)", voucher: "Voucher", loyalty: "Loyalty Points",
    account_credit: "Account Credit", cheque: "Cheque", credit_note: "Credit Note",
  };
  return labels[method];
}