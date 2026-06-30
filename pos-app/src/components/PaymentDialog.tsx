/**
 * PaymentDialog — full payment flow with split payment support.
 *
 * Supports: Cash, Card (JCC/Viva/Worldpay), Voucher, Loyalty Points,
 * Account Credit, and any combination of the above.
 *
 * On completion calls onComplete(paymentResult) which the POS uses
 * to finalise the order, print the receipt, and open the cash drawer.
 */

import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Banknote, CreditCard, Gift, Star, Building2,
  Loader2, Check, X, ChevronRight, Trash2
} from "lucide-react";
import { usePayment, type PaymentResult, type TenderMethod } from "../hooks/usePayment";
import Numpad from "./Numpad";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PaymentDialogProps {
  open: boolean;
  orderTotal: number;
  loyaltyPoints?: number;      // customer's available points
  loyaltyValuePerPoint?: number; // e.g. 0.01 = 1 cent per point
  accountCredit?: number;      // customer's available credit
  onComplete: (result: PaymentResult) => void;
  onCancel: () => void;
}

type PaymentTab = "cash" | "card" | "split";

// Quick-cash buttons: common denominations
const CASH_PRESETS = [5, 10, 20, 50, 100];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `€${Math.abs(n).toFixed(2)}`;
}

function methodIcon(m: TenderMethod) {
  switch (m) {
    case "cash":          return <Banknote className="h-3.5 w-3.5" />;
    case "card_jcc":
    case "card_viva":
    case "card_worldpay": return <CreditCard className="h-3.5 w-3.5" />;
    case "voucher":       return <Gift className="h-3.5 w-3.5" />;
    case "loyalty":       return <Star className="h-3.5 w-3.5" />;
    case "account_credit":return <Building2 className="h-3.5 w-3.5" />;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function PaymentDialog({
  open,
  orderTotal,
  loyaltyPoints = 0,
  loyaltyValuePerPoint = 0.01,
  accountCredit = 0,
  onComplete,
  onCancel,
}: PaymentDialogProps) {
  const payment = usePayment(orderTotal);
  const [tab, setTab] = useState<PaymentTab>("cash");
  const [numpadValue, setNumpadValue] = useState("");
  const [voucherCode, setVoucherCode] = useState("");
  const [loyaltyPointsToRedeem, setLoyaltyPointsToRedeem] = useState(0);

  // Reset on open
  useEffect(() => {
    if (open) {
      payment.clearTenders();
      setTab("cash");
      setNumpadValue("");
      setVoucherCode("");
      setLoyaltyPointsToRedeem(0);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsedAmount = parseFloat(numpadValue) || 0;

  // ── Numpad handler ──────────────────────────────────────────────────────────

  const handleNumpadPress = useCallback((key: string) => {
    if (key === "backspace") {
      setNumpadValue((v) => v.slice(0, -1));
    } else if (key === "clear") {
      setNumpadValue("");
    } else if (key === ".") {
      if (!numpadValue.includes(".")) setNumpadValue((v) => v + ".");
    } else {
      // Max 2 decimal places
      const parts = numpadValue.split(".");
      if (parts[1] !== undefined && parts[1].length >= 2) return;
      setNumpadValue((v) => v + key);
    }
  }, [numpadValue]);

  // ── Cash handlers ───────────────────────────────────────────────────────────

  function addCash(amount: number) {
    payment.addCashTender(amount);
    setNumpadValue("");
  }

  function addExactCash() {
    payment.addExactCash();
    setNumpadValue("");
  }

  // ── Card handler ────────────────────────────────────────────────────────────

  async function processCard() {
    const amount = parsedAmount > 0 ? parsedAmount : payment.balance;
    if (amount <= 0) return;
    await payment.requestCardPayment(amount);
    setNumpadValue("");
  }

  // ── Voucher ─────────────────────────────────────────────────────────────────

  function addVoucher() {
    if (!voucherCode || parsedAmount <= 0) return;
    payment.addVoucherTender(voucherCode, parsedAmount);
    setVoucherCode("");
    setNumpadValue("");
  }

  // ── Loyalty ─────────────────────────────────────────────────────────────────

  function redeemLoyalty() {
    if (loyaltyPointsToRedeem <= 0) return;
    payment.addLoyaltyTender(loyaltyPointsToRedeem, loyaltyValuePerPoint);
    setLoyaltyPointsToRedeem(0);
  }

  // ── Complete ────────────────────────────────────────────────────────────────

  function handleComplete() {
    if (!payment.isComplete) return;
    onComplete(payment.finalise());
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        className="sm:max-w-xl p-0 gap-0"
        data-testid="payment-dialog"
      >
        <DialogHeader className="px-6 pt-5 pb-4 border-b">
          <DialogTitle className="flex items-center justify-between">
            <span>Payment</span>
            <span className="text-2xl font-bold font-mono text-primary" data-testid="payment-total">
              {fmt(orderTotal)}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row">
          {/* Left: tender list + tabs */}
          <div className="flex-1 p-4 space-y-4 border-r">
            {/* Tab bar */}
            <div className="flex gap-1 bg-muted p-1 rounded-lg">
              {(["cash", "card", "split"] as PaymentTab[]).map((t) => (
                <button
                  key={t}
                  data-testid={`tab-payment-${t}`}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-1.5 rounded-md text-sm font-medium capitalize transition-colors
                    ${tab === t ? "bg-white dark:bg-gray-800 shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Cash tab */}
            {tab === "cash" && (
              <div className="space-y-3">
                {/* Quick presets */}
                <div className="flex flex-wrap gap-2">
                  {CASH_PRESETS.map((amt) => (
                    <Button
                      key={amt}
                      size="sm"
                      variant="outline"
                      data-testid={`btn-cash-preset-${amt}`}
                      onClick={() => addCash(amt)}
                    >
                      €{amt}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="btn-cash-exact"
                    onClick={addExactCash}
                    disabled={payment.balance <= 0}
                  >
                    Exact
                  </Button>
                </div>

                {/* Custom amount */}
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                    <Input
                      data-testid="input-cash-amount"
                      className="pl-7 font-mono"
                      placeholder="0.00"
                      value={numpadValue}
                      readOnly
                    />
                  </div>
                  <Button
                    data-testid="btn-add-cash"
                    onClick={() => addCash(parsedAmount)}
                    disabled={parsedAmount <= 0}
                  >
                    Add
                  </Button>
                </div>
              </div>
            )}

            {/* Card tab */}
            {tab === "card" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Amount to charge to card:
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                    <Input
                      data-testid="input-card-amount"
                      className="pl-7 font-mono"
                      placeholder={payment.balance.toFixed(2)}
                      value={numpadValue}
                      readOnly
                    />
                  </div>
                  <Button
                    data-testid="btn-process-card"
                    onClick={processCard}
                    disabled={payment.pendingCard}
                  >
                    {payment.pendingCard
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <><CreditCard className="h-4 w-4 mr-1.5" />Pay</>
                    }
                  </Button>
                </div>
                {payment.cardError && (
                  <p className="text-sm text-red-500" data-testid="card-error">
                    {payment.cardError}
                  </p>
                )}
              </div>
            )}

            {/* Split tab */}
            {tab === "split" && (
              <div className="space-y-3 text-sm">
                {/* Voucher */}
                <div className="space-y-1">
                  <p className="text-muted-foreground font-medium">Voucher / Gift Card</p>
                  <div className="flex gap-2">
                    <Input
                      data-testid="input-voucher-code"
                      placeholder="Barcode or code"
                      value={voucherCode}
                      onChange={(e) => setVoucherCode(e.target.value)}
                    />
                    <Button
                      size="sm"
                      data-testid="btn-add-voucher"
                      variant="outline"
                      onClick={addVoucher}
                      disabled={!voucherCode || parsedAmount <= 0}
                    >
                      Add
                    </Button>
                  </div>
                </div>

                {/* Loyalty */}
                {loyaltyPoints > 0 && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground font-medium">
                      Loyalty Points ({loyaltyPoints.toLocaleString()} available)
                    </p>
                    <div className="flex gap-2 items-center">
                      <Input
                        data-testid="input-loyalty-points"
                        type="number"
                        min={0}
                        max={loyaltyPoints}
                        placeholder="0"
                        value={loyaltyPointsToRedeem || ""}
                        onChange={(e) => setLoyaltyPointsToRedeem(parseInt(e.target.value) || 0)}
                      />
                      <span className="text-muted-foreground shrink-0">
                        = {fmt(loyaltyPointsToRedeem * loyaltyValuePerPoint)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="btn-add-loyalty"
                        onClick={redeemLoyalty}
                        disabled={loyaltyPointsToRedeem <= 0}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                )}

                {/* Account credit */}
                {accountCredit > 0 && (
                  <div className="flex items-center justify-between rounded border p-2">
                    <div>
                      <p className="font-medium">Account Credit</p>
                      <p className="text-muted-foreground text-xs">Available: {fmt(accountCredit)}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="btn-add-account-credit"
                      onClick={() =>
                        payment.addAccountCreditTender(Math.min(accountCredit, payment.balance))
                      }
                      disabled={payment.balance <= 0}
                    >
                      Apply
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Tenders list */}
            {payment.tenders.length > 0 && (
              <div className="space-y-1 border-t pt-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Added payments</p>
                {payment.tenders.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between text-sm py-1 gap-2"
                    data-testid={`tender-row-${t.id}`}
                  >
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      {methodIcon(t.method)} {t.label}
                    </span>
                    <span className="font-mono font-medium">{fmt(t.amount)}</span>
                    <button
                      data-testid={`btn-remove-tender-${t.id}`}
                      onClick={() => payment.removeTender(t.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold pt-1 border-t">
                  <span>Tendered</span>
                  <span className="font-mono" data-testid="payment-tendered">
                    {fmt(payment.totalTendered)}
                  </span>
                </div>
              </div>
            )}

            {/* Balance / change */}
            <div className={`rounded-lg p-3 text-center font-bold text-lg ${
              payment.isComplete
                ? "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300"
                : "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
            }`}>
              {payment.isComplete
                ? payment.changeDue > 0.005
                  ? `Change: ${fmt(payment.changeDue)}`
                  : <span className="flex items-center justify-center gap-2"><Check className="h-5 w-5" /> Payment complete</span>
                : `Remaining: ${fmt(payment.balance)}`
              }
            </div>
          </div>

          {/* Right: numpad */}
          <div className="p-4 space-y-2">
            <Numpad
              value={numpadValue}
              onPress={handleNumpadPress}
              showDecimal
            />

            {/* Action buttons */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                data-testid="btn-payment-cancel"
                onClick={onCancel}
              >
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                data-testid="btn-payment-complete"
                disabled={!payment.isComplete}
                onClick={handleComplete}
              >
                Complete <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
