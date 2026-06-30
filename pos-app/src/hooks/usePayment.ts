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

import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TenderMethod =
  | "cash"
  | "card_jcc"
  | "card_viva"
  | "card_worldpay"
  | "loyalty"
  | "voucher"
  | "account_credit";

export interface Tender {
  id: string;
  method: TenderMethod;
  amount: number;
  reference?: string;   // card auth code, voucher barcode, etc.
  approved?: boolean;
  label: string;
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

  addCashTender: (amount: number) => void;
  addExactCash: () => void;              // tender exact order total in cash
  requestCardPayment: (amount: number) => Promise<boolean>;
  addVoucherTender: (barcode: string, amount: number) => void;
  addLoyaltyTender: (points: number, valuePerPoint: number) => void;
  addAccountCreditTender: (amount: number) => void;
  removeTender: (id: string) => void;
  clearTenders: () => void;

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

  const totalTendered = useMemo(
    () => tenders.reduce((s, t) => s + t.amount, 0),
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
    () => totalTendered >= orderTotal - 0.001,
    [totalTendered, orderTotal]
  );

  // ── Cash ────────────────────────────────────────────────────────────────────

  const addCashTender = useCallback((amount: number) => {
    if (amount <= 0) return;
    setTenders((prev) => [
      ...prev,
      { id: uuidv4(), method: "cash", amount, label: tenderLabel("cash") },
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
    if (amount <= 0) return false;
    setPendingCard(true);
    setCardError(null);

    try {
      // Rust command calls the configured gateway via HTTP
      const result = await invoke<{ approved: boolean; reference: string; provider: string; error?: string }>(
        "process_card_payment",
        { amount, currency: "EUR" }
      );

      if (result.approved) {
        // Map provider string returned by Rust to the correct TenderMethod
        const providerToMethod: Record<string, TenderMethod> = {
          jcc:       "card_jcc",
          viva:      "card_viva",
          worldpay:  "card_worldpay",
          mock:      "card_jcc",
        };
        const method: TenderMethod = providerToMethod[result.provider] ?? "card_jcc";
        setTenders((prev) => [
          ...prev,
          {
            id: uuidv4(),
            method,
            amount,
            reference: result.reference,
            approved: true,
            label: tenderLabel(method),
          },
        ]);
        return true;
      } else {
        setCardError(result.error ?? "Card declined");
        return false;
      }
    } catch (err: any) {
      setCardError(err?.message ?? "Card terminal error");
      return false;
    } finally {
      setPendingCard(false);
    }
  }, []);

  // ── Voucher ─────────────────────────────────────────────────────────────────

  const addVoucherTender = useCallback((barcode: string, amount: number) => {
    if (amount <= 0) return;
    setTenders((prev) => [
      ...prev,
      {
        id: uuidv4(),
        method: "voucher",
        amount,
        reference: barcode,
        label: `Voucher (${barcode})`,
      },
    ]);
  }, []);

  // ── Loyalty ─────────────────────────────────────────────────────────────────

  const addLoyaltyTender = useCallback((points: number, valuePerPoint: number) => {
    const amount = Math.round(points * valuePerPoint * 100) / 100;
    if (amount <= 0) return;
    setTenders((prev) => [
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
    if (amount <= 0) return;
    setTenders((prev) => [
      ...prev,
      { id: uuidv4(), method: "account_credit", amount, label: tenderLabel("account_credit") },
    ]);
  }, []);

  // ── Remove / clear ──────────────────────────────────────────────────────────

  const removeTender = useCallback((id: string) => {
    setTenders((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearTenders = useCallback(() => {
    setTenders([]);
    setCardError(null);
  }, []);

  // ── Finalise ────────────────────────────────────────────────────────────────

  const finalise = useCallback((): PaymentResult => {
    return {
      tenders,
      totalTendered,
      changeDue,
      primaryMethod: primaryMethod(tenders),
    };
  }, [tenders, totalTendered, changeDue]);

  return {
    tenders,
    totalTendered,
    balance,
    changeDue,
    isComplete,
    pendingCard,
    cardError,
    addCashTender,
    addExactCash,
    requestCardPayment,
    addVoucherTender,
    addLoyaltyTender,
    addAccountCreditTender,
    removeTender,
    clearTenders,
    finalise,
  };
}
