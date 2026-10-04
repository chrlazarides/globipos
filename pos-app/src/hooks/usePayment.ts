/**
 * usePayment — multi-tender payment engine for Phase 3.
 *
 * Manages a list of "tenders" (partial payments) of any combination:
 * cash / card (JCC, Viva, Worldpay) / loyalty points / voucher / account credit.
 *
 * When total tenders >= order total the sale is finalisable.
 * Cash payments calculate change due.
 * Card payments call a Rust command that does HTTP to the configured gateway.
 */

import { useState, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";
import { cents, tenderTotals, validateTenders } from "../lib/paymentTenders";
import { resolveCardPaymentOutcome } from "../lib/cardPayment";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TenderMethod =
  | "cash"
  | "card_jcc"
  | "card_viva"
  | "card_worldpay"
  | "loyalty"
  | "voucher"
  | "account_credit"
  | "cheque"
  | "credit_note";

export interface Tender {
  id: string;
  method: TenderMethod;
  amount: number;
  reference?: string;   // card auth code, voucher/credit-note barcode, etc.
  approved?: boolean;
  label: string;
  // For voucher/credit_note tenders: the validated pos_gift_vouchers / pos_credit_notes
  // row id to redeem against on payment completion. Undefined => free-text/legacy tender
  // with nothing to settle server-side.
  settleId?: string;
}

export interface PaymentResult {
  tenders: Tender[];
  totalTendered: number;
  changeDue: number;
  primaryMethod: TenderMethod;
}

export interface CardGatewayConfig {
  provider: "jcc" | "viva" | "worldpay";
  endpoint: string;
  merchant_id: string;
  terminal_id: string;
  api_key: string;
}

export interface UsePaymentReturn {
  tenders: Tender[];
  totalTendered: number;
  balance: number;          // orderTotal - totalTendered (negative = overpaid = change)
  changeDue: number;
  isComplete: boolean;
  pendingCard: boolean;
  cardError: string | null;
  verificationRequired: boolean;
  canCancel: boolean;

  addCashTender: (amount: number) => void;
  addExactCash: () => void;              // tender exact order total in cash
  requestCardPayment: (amount: number) => Promise<boolean>;
  addVoucherTender: (barcode: string, amount: number, voucherId?: string) => void;
  addLoyaltyTender: (points: number, valuePerPoint: number) => void;
  addAccountCreditTender: (amount: number) => void;
  addChequeTender: (amount: number, chequeNumber: string) => void;
  addCreditNoteTender: (amount: number, creditNoteId: string, creditNoteCode?: string) => void;
  removeTender: (id: string) => void;
  clearTenders: () => void;
  resetCompletedPayment: () => void;

  finalise: () => PaymentResult;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function tenderLabel(method: TenderMethod): string {
  switch (method) {
    case "cash":          return "Cash";
    case "card_jcc":      return "Card (JCC)";
    case "card_viva":     return "Card (Viva)";
    case "card_worldpay": return "Card (Worldpay)";
    case "loyalty":       return "Loyalty Points";
    case "voucher":       return "Voucher";
    case "account_credit":return "Account Credit";
    case "cheque":        return "Cheque";
    case "credit_note":   return "Credit Note";
  }
}

function primaryMethod(tenders: Tender[]): TenderMethod {
  if (tenders.length === 0) return "cash";
  const highest = tenders.reduce((a, b) => (b.amount > a.amount ? b : a));
  return highest.method;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function usePayment(orderTotal: number): UsePaymentReturn {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [pendingCard, setPendingCard] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const cardBusy = useRef(false);
  const tendersRef = useRef<Tender[]>([]);
  tendersRef.current = tenders;
  const verificationRef = useRef(false);
  const orderTotalRef = useRef(orderTotal);
  orderTotalRef.current = orderTotal;
  function updateTenders(update: (previous: Tender[]) => Tender[]) {
    const next = update(tendersRef.current);
    tendersRef.current = next;
    setTenders(next);
  }

  const totalTendered = useMemo(
    () => tenderTotals(tenders, orderTotal).totalTendered,
    [tenders]
  );

  const balance = useMemo(
    () => Math.round((orderTotal - totalTendered) * 100) / 100,
    [orderTotal, totalTendered]
  );

  const changeDue = useMemo(
    () => Math.max(0, -balance),
    [balance]
  );

  const isComplete = useMemo(
    () => !pendingCard && !verificationRequired && tenderTotals(tenders, orderTotal).isComplete,
    [tenders, pendingCard, verificationRequired, orderTotal]
  );

  // ── Cash ────────────────────────────────────────────────────────────────────

  const addCashTender = useCallback((amount: number) => {
    if (cardBusy.current || verificationRef.current || !Number.isFinite(amount) || cents(amount) <= 0) return;
    updateTenders((prev) => [
      ...prev,
      { id: uuidv4(), method: "cash", amount: cents(amount) / 100, label: tenderLabel("cash") },
    ]);
  }, []);

  const addExactCash = useCallback(() => {
    const remaining = Math.max(0, balance);
    if (remaining <= 0) return;
    // Round up to nearest cent
    addCashTender(remaining);
  }, [balance, addCashTender]);

  // ── Card ────────────────────────────────────────────────────────────────────

  const requestCardPayment = useCallback(async (amount: number): Promise<boolean> => {
    if (cardBusy.current || verificationRef.current) return false;
    const remaining = cents(orderTotalRef.current) - tendersRef.current.reduce((sum, t) => sum + cents(t.amount), 0);
    if (!Number.isFinite(amount) || cents(amount) <= 0 || cents(amount) > remaining) {
      setCardError("The card amount must be positive and cannot exceed the remaining balance.");
      return false;
    }
    amount = cents(amount) / 100;
    cardBusy.current = true;
    setPendingCard(true);
    setCardError(null);

    try {
      // Rust command calls the configured gateway via HTTP
      const result = await invoke<{ approved: boolean; reference: string; provider: string; error?: string }>(
        "process_card_payment",
        { amount, currency: "EUR" }
      );

      const outcome = resolveCardPaymentOutcome(result);
      if (outcome.kind === "complete") {
        // Map provider string returned by Rust to the correct TenderMethod
        const providerToMethod: Record<string, TenderMethod> = {
          jcc:       "card_jcc",
          viva:      "card_viva",
          worldpay:  "card_worldpay",
          mock:      "card_jcc",
        };
        const method = providerToMethod[result.provider];
        if (!method) throw new Error("Approved payment has an unknown provider. Verify the charge before continuing.");
        updateTenders((prev) => [
          ...prev,
          {
            id: uuidv4(),
            method,
            amount,
            reference: outcome.reference,
            approved: true,
            label: tenderLabel(method),
          },
        ]);
        return true;
      } else {
        setCardError(outcome.message);
        if (outcome.kind === "verification_required") {
          verificationRef.current = true;
          setVerificationRequired(true);
        }
        return false;
      }
    } catch (err: any) {
      verificationRef.current = true;
      setVerificationRequired(true);
      setCardError(`${err?.message ?? "Card terminal error"}. Verify the terminal transaction; do not charge again.`);
      return false;
    } finally {
      setPendingCard(false);
      cardBusy.current = false;
    }
  }, [orderTotal]);

  // ── Voucher ─────────────────────────────────────────────────────────────────

  const addVoucherTender = useCallback((barcode: string, amount: number, voucherId?: string) => {
    if (!canAddNonCash(amount)) return;
    updateTenders((prev) => [
      ...prev,
      {
        id: uuidv4(),
        method: "voucher",
        amount,
        reference: barcode,
        settleId: voucherId,
        label: `Voucher (${barcode})`,
      },
    ]);
  }, []);

  // ── Loyalty ─────────────────────────────────────────────────────────────────

  const addLoyaltyTender = useCallback((points: number, valuePerPoint: number) => {
    const amount = Math.round(points * valuePerPoint * 100) / 100;
    if (!canAddNonCash(amount)) return;
    updateTenders((prev) => [
      ...prev,
      {
        id: uuidv4(),
        method: "loyalty",
        amount,
        reference: `${points} pts`,
        label: `Loyalty (${points} pts = €${amount.toFixed(2)})`,
      },
    ]);
  }, []);

  // ── Account credit ──────────────────────────────────────────────────────────

  const addAccountCreditTender = useCallback((amount: number) => {
    if (!canAddNonCash(amount)) return;
    updateTenders((prev) => [
      ...prev,
      { id: uuidv4(), method: "account_credit", amount, label: tenderLabel("account_credit") },
    ]);
  }, []);

  // ── Cheque ──────────────────────────────────────────────────────────────────

  const addChequeTender = useCallback((amount: number, chequeNumber: string) => {
    if (!canAddNonCash(amount)) return;
    updateTenders((prev) => [
      ...prev,
      {
        id: uuidv4(),
        method: "cheque",
        amount,
        reference: chequeNumber,
        label: `Cheque${chequeNumber ? ` (#${chequeNumber})` : ""}`,
      },
    ]);
  }, []);

  // ── Credit note (store credit issued from a prior return) ────────────────────

  const addCreditNoteTender = useCallback((amount: number, creditNoteId: string, creditNoteCode?: string) => {
    if (!canAddNonCash(amount)) return;
    updateTenders((prev) => [
      ...prev,
      {
        id: uuidv4(),
        method: "credit_note",
        amount,
        reference: creditNoteId,
        settleId: creditNoteId,
        label: `Credit Note${creditNoteCode ? ` (${creditNoteCode})` : ""}`,
      },
    ]);
  }, []);

  // ── Remove / clear ──────────────────────────────────────────────────────────

  const removeTender = useCallback((id: string) => {
    if (cardBusy.current || verificationRef.current) return;
    const tender = tendersRef.current.find(t => t.id === id);
    if (tender?.method.startsWith("card_") && tender.approved) {
      setCardError("An approved card payment cannot be removed here. Complete the sale, then use the authorized refund process.");
      return;
    }
    updateTenders((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearTenders = useCallback(() => {
    if (cardBusy.current || verificationRef.current || tendersRef.current.some(t => t.approved && t.method.startsWith("card_"))) return;
    updateTenders(() => []);
    setCardError(null);
  }, []);
  const resetCompletedPayment = useCallback(() => {
    updateTenders(() => []);
    verificationRef.current = false;
    setVerificationRequired(false);
    setCardError(null);
  }, []);

  function canAddNonCash(amount: number) {
    if (cardBusy.current || verificationRef.current || !Number.isFinite(amount) || cents(amount) <= 0) return false;
    const remaining = cents(orderTotalRef.current) - tendersRef.current.reduce((sum, t) => sum + cents(t.amount), 0);
    if (cents(amount) > remaining) {
      setCardError("This payment cannot exceed the remaining balance.");
      return false;
    }
    return true;
  }

  // ── Finalise ────────────────────────────────────────────────────────────────

  const finalise = useCallback((): PaymentResult => {
    if (cardBusy.current || verificationRef.current) throw new Error("The card transaction must be resolved before completing.");
    const checked = validateTenders(tendersRef.current, orderTotal);
    return {
      tenders: [...tendersRef.current],
      totalTendered: checked.totalTendered,
      changeDue: checked.changeDue,
      primaryMethod: primaryMethod(tendersRef.current),
    };
  }, [tenders, totalTendered, changeDue, orderTotal]);

  return {
    tenders,
    totalTendered,
    balance,
    changeDue,
    isComplete,
    pendingCard,
    cardError,
    verificationRequired,
    canCancel: !pendingCard && !verificationRequired && !tenders.some(t => t.approved && t.method.startsWith("card_")),
    addCashTender,
    addExactCash,
    requestCardPayment,
    addVoucherTender,
    addLoyaltyTender,
    addAccountCreditTender,
    addChequeTender,
    addCreditNoteTender,
    removeTender,
    clearTenders,
    resetCompletedPayment,
    finalise,
  };
}
