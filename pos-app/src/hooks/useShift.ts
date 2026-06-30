/**
 * useShift — shift lifecycle management.
 *
 * Covers: open shift, X-report (mid-shift totals), Z-report + close,
 * cash-in, cash-out, variance calculation, sync-on-close.
 *
 * Shift data lives in SQLite (pos_shifts + shift_events tables).
 * On close the shift is queued in the outbox for server sync.
 */

import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Shift {
  id: string;
  cashier_id: string;
  cashier_name: string;
  opened_at: string;
  closed_at?: string;
  opening_float: number;
  closing_cash?: number;
  total_cash_sales: number;
  total_card_sales: number;
  total_sales: number;
  total_voids: number;
  order_count: number;
  status: "open" | "closed";
}

export interface ShiftEvent {
  id: string;
  shift_id: string;
  event_type: "cash_in" | "cash_out" | "no_sale";
  amount: number;
  note?: string;
  created_at: string;
}

export interface XReport {
  shift: Shift;
  events: ShiftEvent[];
  expected_cash: number;   // float + cash_sales + cash_in - cash_out
  transaction_count: number;
  avg_basket: number;
  top_payment: string;
  generated_at: string;
}

export interface ZReport extends XReport {
  closing_cash: number;
  variance: number;         // closing_cash - expected_cash
  is_balanced: boolean;
}

export interface UseShiftReturn {
  currentShift: Shift | null;
  isShiftOpen: boolean;
  loading: boolean;
  error: string | null;

  openShift: (cashierId: string, cashierName: string, openingFloat: number) => Promise<Shift>;
  closeShift: (closingCash: number, notes: string, blind?: boolean) => Promise<ZReport>;
  addCashIn: (amount: number, note: string) => Promise<void>;
  addCashOut: (amount: number, note: string) => Promise<void>;
  noSale: () => Promise<void>;
  recordSale: (total: number, paymentMethod: string) => Promise<void>;
  getXReport: () => Promise<XReport>;
  refreshShift: () => Promise<void>;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useShift(): UseShiftReturn {
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current open shift on mount
  const refreshShift = useCallback(async () => {
    try {
      const shift = await invoke<Shift | null>("get_current_shift");
      setCurrentShift(shift);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load shift");
    }
  }, []);

  useEffect(() => {
    refreshShift();
  }, [refreshShift]);

  const isShiftOpen = currentShift?.status === "open" ?? false;

  // ── Open shift ──────────────────────────────────────────────────────────────

  const openShift = useCallback(async (
    cashierId: string,
    cashierName: string,
    openingFloat: number
  ): Promise<Shift> => {
    setLoading(true);
    setError(null);
    try {
      const shift = await invoke<Shift>("open_shift", {
        cashierId,
        cashierName,
        openingFloat,
      });
      setCurrentShift(shift);
      return shift;
    } catch (e: any) {
      const msg = e?.message ?? "Failed to open shift";
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Close shift (Z-report) ──────────────────────────────────────────────────

  const closeShift = useCallback(async (
    closingCash: number,
    notes: string,
    blind = false
  ): Promise<ZReport> => {
    if (!currentShift) throw new Error("No open shift");
    setLoading(true);
    setError(null);
    try {
      const report = await invoke<ZReport>("close_shift", {
        shiftId: currentShift.id,
        closingCash: blind ? -1 : closingCash,  // -1 = blind close (don't record counted)
        notes,
      });
      setCurrentShift(null);
      return report;
    } catch (e: any) {
      const msg = e?.message ?? "Failed to close shift";
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [currentShift]);

  // ── Cash in/out ─────────────────────────────────────────────────────────────

  const addCashIn = useCallback(async (amount: number, note: string) => {
    if (!currentShift) throw new Error("No open shift");
    await invoke("record_shift_event", {
      shiftId: currentShift.id,
      eventType: "cash_in",
      amount,
      note,
    });
    await refreshShift();
  }, [currentShift, refreshShift]);

  const addCashOut = useCallback(async (amount: number, note: string) => {
    if (!currentShift) throw new Error("No open shift");
    await invoke("record_shift_event", {
      shiftId: currentShift.id,
      eventType: "cash_out",
      amount,
      note,
    });
    await refreshShift();
  }, [currentShift, refreshShift]);

  const noSale = useCallback(async () => {
    if (!currentShift) return;
    await invoke("record_shift_event", {
      shiftId: currentShift.id,
      eventType: "no_sale",
      amount: 0,
      note: "No-sale drawer open",
    });
  }, [currentShift]);

  // ── Record a completed sale ─────────────────────────────────────────────────

  const recordSale = useCallback(async (total: number, paymentMethod: string) => {
    if (!currentShift) return;
    await invoke("update_shift_totals", {
      shiftId: currentShift.id,
      total,
      paymentMethod,
    });
    await refreshShift();
  }, [currentShift, refreshShift]);

  // ── X-report (mid-shift, no close) ─────────────────────────────────────────

  const getXReport = useCallback(async (): Promise<XReport> => {
    if (!currentShift) throw new Error("No open shift");
    const report = await invoke<XReport>("get_shift_summary", {
      shiftId: currentShift.id,
    });
    return report;
  }, [currentShift]);

  return {
    currentShift,
    isShiftOpen,
    loading,
    error,
    openShift,
    closeShift,
    addCashIn,
    addCashOut,
    noSale,
    recordSale,
    getXReport,
    refreshShift,
  };
}
