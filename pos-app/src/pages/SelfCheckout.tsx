/**
 * SelfCheckout — self-service checkout mode.
 *
 * Features:
 *  - Simplified large-button layout for customers
 *  - Barcode scanning prompt (camera or hardware scanner)
 *  - Bagging area weight check (confirms item added)
 *  - "Need help?" attendant call button
 *  - Attendant can override and unlock the terminal
 *  - Monitoring panel (shown on attendant screen) listing all self-checkout lanes
 *  - Age verification auto-triggered on restricted items
 *  - No cash payment in self-checkout (card only by default)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ShoppingCart, Scan, CreditCard, UserCheck, AlertTriangle, Check, X, Bell, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { v4 as uuidv4 } from "uuid";
import AgeVerificationDialog from "../components/AgeVerificationDialog";
import type { Order, OrderLine, Product } from "../types";
import { createLine, setLinePriceOverride, computeOrderTotals } from "../lib/pricing";
import { parseScaleBarcode, DEFAULT_BARCODE_CONFIG } from "../lib/scaleBarcode";
import type { BarcodeConfig as BarcodeConfigType } from "../types";
import { nextOrderNumber, saveOrder, getBarcodeConfig } from "../lib/db";
import { canGenericAttendantRelease, canStartSelfCheckoutPayment, resolveApprovedCardReference, resolveCardPaymentOutcome } from "../lib/cardPayment";

// ── Types ──────────────────────────────────────────────────────────────────────

type SCOMode = "idle" | "scanning" | "payment" | "payment_verification" | "attendant_needed" | "age_check" | "done";
type AttendantReason = "age_check" | "weight_mismatch" | "help_requested" | "no_bag" | "item_not_found";

interface SelfCheckoutProps {
  cashierId: string;       // attendant ID (for audit)
  cashierName: string;
  terminalPrefix?: string;
  onExit?: () => void;     // exit self-checkout mode → return to standard POS
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) { return `€${n.toFixed(2)}`; }

const SCO_PAYMENT_LOCK_KEY = "sco_unresolved_card_payment";

interface UnresolvedCardPayment {
  lines: OrderLine[];
  message: string;
}

function loadUnresolvedCardPayment(): UnresolvedCardPayment | null {
  try {
    const raw = localStorage.getItem(SCO_PAYMENT_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UnresolvedCardPayment;
    return Array.isArray(parsed.lines) && parsed.lines.length > 0 && typeof parsed.message === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function SelfCheckout({ cashierId, cashierName, terminalPrefix = "SCO", onExit }: SelfCheckoutProps) {
  const [recoveredPaymentLock] = useState(loadUnresolvedCardPayment);
  const [mode, setMode] = useState<SCOMode>(recoveredPaymentLock ? "payment_verification" : "idle");
  const [lines, setLines] = useState<OrderLine[]>(recoveredPaymentLock?.lines ?? []);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [attendantReason, setAttendantReason] = useState<AttendantReason | null>(null);
  const [ageCheckProduct, setAgeCheckProduct] = useState<Product | null>(null);
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [attendantPIN, setAttendantPIN] = useState("");
  const [pinError, setPinError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [cardRef, setCardRef] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState(recoveredPaymentLock?.message ?? "");
  const [verificationRef, setVerificationRef] = useState("");
  const barcodeRef = useRef<HTMLInputElement>(null);
  const barcodeConfigRef = useRef<BarcodeConfigType | null>(null);

  // Load admin-configured barcode rules (falls back to defaults if unavailable)
  useEffect(() => {
    getBarcodeConfig().then((cfg) => { barcodeConfigRef.current = cfg; }).catch(() => {});
  }, []);

  useEffect(() => {
    if (mode === "payment_verification") {
      localStorage.setItem(SCO_PAYMENT_LOCK_KEY, JSON.stringify({ lines, message: paymentError }));
    } else if (mode === "done") {
      localStorage.removeItem(SCO_PAYMENT_LOCK_KEY);
    }
  }, [mode, lines, paymentError]);

  const activeLines = lines.filter((l) => !l.voided);
  const totals = computeOrderTotals(activeLines, 0, 0);

  // Keep the heartbeat snapshot in sync with the lane after every basket or
  // mode change. useSync sends this Tauri-managed snapshot to the server.
  useEffect(() => {
    invoke("set_sco_heartbeat_state", {
      scoMode: mode,
      scoItems: activeLines.length,
      scoTotal: totals.total,
      scoAttendantReason: attendantReason,
    }).catch(() => {});
  }, [mode, activeLines.length, totals.total, attendantReason]);

  useEffect(() => () => {
    invoke("set_sco_heartbeat_state", {
      scoMode: "idle",
      scoItems: 0,
      scoTotal: 0,
      scoAttendantReason: null,
    }).catch(() => {});
  }, []);

  // Focus barcode input in scanning mode
  useEffect(() => {
    if (mode === "scanning" || mode === "idle") {
      barcodeRef.current?.focus();
    }
  }, [mode]);

  const startSession = () => {
    localStorage.removeItem(SCO_PAYMENT_LOCK_KEY);
    setLines([]);
    setOrderNumber(null);
    setCardRef(null);
    setPaymentError("");
    setVerificationRef("");
    setMode("scanning");
    invoke("write_audit", {
      cashierId,
      cashierName,
      action: "self_checkout_start",
      entity: "terminal",
    }).catch(() => {});
  };

  // ── Barcode scan ────────────────────────────────────────────────────────────

  const handleBarcode = useCallback(async (barcode: string) => {
    if (!barcode.trim()) return;
    setBarcodeInput("");
    setProcessing(true);

    try {
      const code = barcode.trim();

      // ── Scale barcode detection ───────────────────────────────────────────
      const scale = parseScaleBarcode(code, barcodeConfigRef.current ?? DEFAULT_BARCODE_CONFIG);
      let resolvedBarcode = code;
      let scaleQty: number | undefined;
      let scalePrice: number | undefined;

      if (scale) {
        // Try PLU first; fall back to the full scale EAN
        const pluProduct = await invoke<Product | null>("get_product_by_barcode", { barcode: scale.plu });
        if (pluProduct) {
          resolvedBarcode = scale.plu;
        }
        if (scale.type === "weight" && scale.value > 0) {
          scaleQty = parseFloat(scale.value.toFixed(3));
        } else if (scale.type === "price" && scale.value > 0) {
          scalePrice = parseFloat(scale.value.toFixed(2));
        }
      }

      const product = await invoke<Product | null>("get_product_by_barcode", { barcode: resolvedBarcode });

      if (!product) {
        callAttendant("item_not_found");
        return;
      }

      // Age check
      if ((product as any).age_restricted) {
        setPendingProduct(product);
        setAgeCheckProduct(product);
        setMode("age_check");
        return;
      }

      // Container deposit
      const deposit = (product as any).deposit_amount;
      addProductToOrder(product, scaleQty ?? 1, scalePrice);
      if (deposit > 0) {
        // Auto-add deposit line
        const depositProduct: Product = {
          ...product,
          id: `deposit-${product.id}`,
          server_id: `deposit-${product.server_id ?? product.id}`,
          name: `Deposit - ${product.name}`,
          sku: `DEP-${product.sku}`,
          price1: deposit,
        };
        addProductToOrder(depositProduct);
      }
    } catch {
      callAttendant("item_not_found");
    } finally {
      setProcessing(false);
    }
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps

  function addProductToOrder(product: Product, qty = 1, overridePrice?: number) {
    let line = createLine(product, 1, qty, new Map());
    if (overridePrice != null && overridePrice > 0) {
      line = setLinePriceOverride(line, overridePrice);
    }
    const newLine: OrderLine = { ...line, id: uuidv4(), order_id: "sco" };
    setLines((prev) => [...prev, newLine]);
  }

  function removeLastLine() {
    setLines((prev) => {
      const active = prev.filter((l) => !l.voided);
      if (active.length === 0) return prev;
      const last = active[active.length - 1];
      return prev.map((l) => l.id === last.id ? { ...l, voided: true } : l);
    });
  }

  // ── Age check ───────────────────────────────────────────────────────────────

  function handleAgeApproved() {
    if (pendingProduct) {
      addProductToOrder(pendingProduct);
      setPendingProduct(null);
      setAgeCheckProduct(null);
    }
    setMode("scanning");
  }

  function handleAgeRejected() {
    setPendingProduct(null);
    setAgeCheckProduct(null);
    callAttendant("age_check");
  }

  // ── Attendant call ──────────────────────────────────────────────────────────

  function callAttendant(reason: AttendantReason = "help_requested") {
    setAttendantReason(reason);
    setMode("attendant_needed");
    invoke("write_audit", {
      cashierId, cashierName,
      action: "attendant_called",
      detail: reason,
    }).catch(() => {});
  }

  async function attendantOverride() {
    if (!canGenericAttendantRelease(mode)) return;
    setPinError("");
    try {
      const session = await invoke<{ cashier_id: string; role: string } | null>("validate_pin", { pin: attendantPIN });
      if (session) {
        setAttendantPIN("");
        setAttendantReason(null);
        setMode("scanning");
        invoke("write_audit", {
          cashierId: session.cashier_id,
          action: "attendant_override",
          detail: attendantReason ?? "override",
        }).catch(() => {});
      } else {
        setPinError("Invalid PIN");
      }
    } catch {
      setPinError("PIN error");
    }
  }

  // ── Payment ─────────────────────────────────────────────────────────────────

  async function persistCompletedCardOrder(paymentRef: string, reconciliationPin?: string) {
    const orderNum = await nextOrderNumber(terminalPrefix);
    const order: Order = {
        id: uuidv4(),
        order_number: orderNum,
        status: "completed",
        cashier_id: cashierId,
        cashier_name: "Self-Checkout",
        price_level: 1,
        order_discount_pct: 0,
        order_discount_fixed: 0,
        surcharge_pct: 0,
        surcharge_amount: 0,
        subtotal: totals.subtotal,
        discount_amount: totals.discountAmount,
        vat_amount: totals.vatAmount,
        total: totals.total,
        payment_method: "card",
        payment_ref: paymentRef,
        amount_tendered: totals.total,
        change_due: 0,
        created_at: new Date().toISOString(),
      };
    if (reconciliationPin) {
      await invoke("reconcile_card_payment", {
        pin: reconciliationPin,
        order,
        lines: activeLines,
      });
    } else {
      await saveOrder(order, activeLines);
    }
    setOrderNumber(orderNum);
    setCardRef(paymentRef);
    setMode("done");
  }

  async function startPayment() {
    if (activeLines.length === 0 || !canStartSelfCheckoutPayment(mode)) return;
    setPaymentError("");
    setMode("payment");
    // In SCO mode, payment is handled by card terminal directly
    // Simulate card tap → complete
    try {
      const result = await invoke<{ approved: boolean; reference?: string; error?: string }>(
        "process_card_payment",
        { amount: totals.total, currency: "EUR" }
      );

      const outcome = resolveCardPaymentOutcome(result);
      if (outcome.kind === "complete") {
        await persistCompletedCardOrder(outcome.reference);
      } else if (outcome.kind === "declined") {
        setPaymentError(outcome.message);
        setMode("scanning");
      } else {
        setPaymentError(outcome.message);
        setMode("payment_verification");
      }
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Card payment could not be verified. Please ask an attendant.");
      setMode("payment_verification");
    }
  }

  async function resolvePaymentVerification() {
    setPinError("");
    const referenceResolution = resolveApprovedCardReference(verificationRef);
    if (referenceResolution.kind === "verification_required") {
      setPinError("Enter the verified terminal reference");
      return;
    }
    try {
      await persistCompletedCardOrder(referenceResolution.reference, attendantPIN);
      setAttendantPIN("");
      setVerificationRef("");
    } catch {
      setPinError("Could not save the verified payment. The lane remains locked.");
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col" data-testid="self-checkout">
      {/* Top bar */}
      <div className="bg-[#7c1d3f] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          <span className="font-semibold">Self Checkout</span>
          {mode !== "idle" && (
            <Badge variant="outline" className="border-white/30 text-white/70 text-xs">
              {activeLines.length} items
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-white/30 text-white hover:bg-white/10"
            onClick={() => callAttendant("help_requested")}
            disabled={mode === "payment_verification"}
            data-testid="btn-call-attendant"
          >
            <Bell className="h-4 w-4 mr-1" /> Attendant
          </Button>
          {onExit && (
            <Button size="sm" variant="ghost" className="text-white/60 hover:text-white" onClick={onExit} disabled={mode === "payment_verification"}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex">
        {/* Left: interaction */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">

          {mode === "idle" && (
            <div className="text-center space-y-6">
              <div className="text-7xl">🛒</div>
              <h2 className="text-3xl font-light">Welcome to Self Checkout</h2>
              <p className="text-gray-400">Scan your first item to begin</p>
              <Button
                size="lg"
                className="bg-[#7c1d3f] hover:bg-[#6b1836] text-white text-lg px-8 py-6"
                onClick={startSession}
                data-testid="btn-start-sco"
              >
                <Scan className="h-5 w-5 mr-2" /> Start Scanning
              </Button>
            </div>
          )}

          {(mode === "scanning") && (
            <div className="w-full max-w-sm space-y-6">
              {paymentError && (
                <div role="alert" className="rounded-lg border border-red-700 bg-red-950/60 px-4 py-3 text-sm text-red-100">
                  {paymentError}
                </div>
              )}
              <div className="text-center">
                <Scan className="h-12 w-12 mx-auto mb-3 text-[#c07090]" />
                <p className="text-xl font-light">Scan item barcode</p>
                <p className="text-gray-400 text-sm mt-1">or type barcode and press Enter</p>
              </div>
              <input
                ref={barcodeRef}
                data-testid="input-sco-barcode"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-center text-lg focus:outline-none focus:border-[#7c1d3f]"
                placeholder=""
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleBarcode(barcodeInput);
                }}
              />
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 border-gray-700 text-white hover:bg-gray-800"
                  onClick={removeLastLine}
                  disabled={activeLines.length === 0}
                  data-testid="btn-sco-remove-last"
                >
                  Remove Last
                </Button>
                {activeLines.length > 0 && (
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    onClick={startPayment}
                    data-testid="btn-sco-pay"
                  >
                    <CreditCard className="h-4 w-4 mr-1.5" /> Pay {fmt(totals.total)}
                  </Button>
                )}
              </div>
              {processing && (
                <p className="text-center text-gray-400 animate-pulse text-sm">Looking up item…</p>
              )}
            </div>
          )}

          {mode === "payment" && (
            <div className="text-center space-y-4">
              <CreditCard className="h-16 w-16 mx-auto text-green-400 animate-pulse" />
              <p className="text-2xl font-light">Please tap or insert your card</p>
              <p className="text-3xl font-bold">{fmt(totals.total)}</p>
            </div>
          )}

          {mode === "payment_verification" && (
            <div className="w-full max-w-md text-center space-y-5" data-testid="sco-payment-verification">
              <div className="rounded-full bg-red-700 w-20 h-20 flex items-center justify-center mx-auto">
                <AlertTriangle className="h-10 w-10 text-white" />
              </div>
              <p className="text-2xl font-light">Payment needs verification</p>
              <p className="text-red-100" role="alert">{paymentError}</p>
              <p className="font-semibold text-amber-300">
                Do not tap or insert the card again. Please ask an attendant to verify the payment.
              </p>
              <div className="bg-gray-900 rounded-xl p-4 mx-auto space-y-3 text-left">
                <label className="block text-sm text-gray-300">
                  Verified terminal reference
                  <input
                    value={verificationRef}
                    onChange={(event) => setVerificationRef(event.target.value)}
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
                    data-testid="input-sco-verification-ref"
                  />
                </label>
                <label className="block text-sm text-gray-300">
                  Attendant PIN
                  <input
                    type="password"
                    inputMode="numeric"
                    value={attendantPIN}
                    onChange={(event) => setAttendantPIN(event.target.value)}
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
                    data-testid="input-sco-verification-pin"
                  />
                </label>
                {pinError && <p className="text-xs text-red-400">{pinError}</p>}
                <Button
                  className="w-full bg-[#7c1d3f] hover:bg-[#6b1836]"
                  onClick={resolvePaymentVerification}
                  disabled={!attendantPIN || !verificationRef.trim()}
                  data-testid="btn-sco-resolve-payment"
                >
                  Record Verified Payment
                </Button>
              </div>
            </div>
          )}

          {mode === "done" && (
            <div className="text-center space-y-4">
              <div className="rounded-full bg-green-600 w-20 h-20 flex items-center justify-center mx-auto">
                <Check className="h-10 w-10" />
              </div>
              <p className="text-2xl font-light">Thank You!</p>
              <p className="text-gray-400">Please take your receipt</p>
              <p className="text-sm text-gray-500">Order #{orderNumber}</p>
              {cardRef && (
                <p className="text-sm text-gray-500" data-testid="text-sco-card-ref">
                  Card Ref: <span className="font-mono text-gray-300">{cardRef}</span>
                </p>
              )}
              <Button
                className="mt-4 bg-[#7c1d3f] hover:bg-[#6b1836]"
                onClick={startSession}
                data-testid="btn-sco-new-transaction"
              >
                New Transaction
              </Button>
            </div>
          )}

          {mode === "attendant_needed" && (
            <div className="text-center space-y-4">
              <div className="rounded-full bg-amber-500 w-20 h-20 flex items-center justify-center mx-auto animate-pulse">
                <AlertTriangle className="h-10 w-10 text-white" />
              </div>
              <p className="text-2xl font-light">Attendant Required</p>
              <p className="text-gray-400">
                {attendantReason === "age_check" && "Age verification required"}
                {attendantReason === "weight_mismatch" && "Bagging area weight mismatch"}
                {attendantReason === "help_requested" && "Customer has requested assistance"}
                {attendantReason === "item_not_found" && "Item not found — please check"}
                {attendantReason === "no_bag" && "Please place item in bagging area"}
              </p>

              {/* Attendant PIN override */}
              <div className="bg-gray-900 rounded-xl p-4 w-64 mx-auto space-y-2">
                <p className="text-sm text-gray-400">Attendant PIN to continue</p>
                <input
                  data-testid="input-attendant-pin"
                  type="password"
                  inputMode="numeric"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-center text-white focus:outline-none focus:border-[#7c1d3f]"
                  placeholder="••••"
                  value={attendantPIN}
                  onChange={(e) => setAttendantPIN(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && attendantOverride()}
                  autoFocus
                />
                {pinError && <p className="text-xs text-red-400">{pinError}</p>}
                <Button
                  className="w-full bg-[#7c1d3f] hover:bg-[#6b1836]"
                  onClick={attendantOverride}
                  disabled={!attendantPIN}
                  data-testid="btn-attendant-override"
                >
                  <UserCheck className="h-4 w-4 mr-1.5" /> Override
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right: basket summary */}
        {mode !== "idle" && mode !== "done" && (
          <div className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-800 text-sm font-medium text-gray-400 uppercase tracking-wide">
              Basket ({activeLines.length})
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {activeLines.map((line) => (
                <div key={line.id} className="flex justify-between text-sm py-1 border-b border-gray-800/60">
                  <span className="text-gray-300 truncate mr-2 flex-1">{line.description}</span>
                  <span className="text-white font-mono shrink-0">
                    {fmt(line.line_total)}
                  </span>
                </div>
              ))}
              {activeLines.length === 0 && (
                <p className="text-gray-600 text-xs text-center py-8">No items yet</p>
              )}
            </div>
            <div className="border-t border-gray-800 p-4 space-y-1">
              <div className="flex justify-between text-sm text-gray-400">
                <span>Subtotal</span>
                <span className="tabular-nums">{fmt(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-400">
                <span>VAT</span>
                <span className="tabular-nums">{fmt(totals.vatAmount)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-white pt-1">
                <span>Total</span>
                <span className="tabular-nums" data-testid="sco-total">{fmt(totals.total)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Age check overlay */}
      {ageCheckProduct && (
        <AgeVerificationDialog
          open={mode === "age_check"}
          productName={ageCheckProduct.name}
          minAge={(ageCheckProduct as any).min_age ?? 18}
          onApprove={handleAgeApproved}
          onReject={handleAgeRejected}
        />
      )}
    </div>
  );
}
