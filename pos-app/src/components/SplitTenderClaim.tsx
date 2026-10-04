import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";

interface Props {
  amount: number;
  digits: string;
  balance: number;
  busy: boolean;
  onDigits: (digits: string) => void;
  onCash: () => void;
  onCard: () => void;
}

/** Claim each portion explicitly; the same keypad amount applies to other tenders below. */
export function SplitTenderClaim({ amount, digits, balance, busy, onDigits, onCash, onCard }: Props) {
  const [text, setText] = useState(digits ? amount.toFixed(2) : "");
  const displayed = !digits ? "" :
    Math.round(Number(text.replace(",", ".")) * 100) === Number(digits) ? text : amount.toFixed(2);
  const valid = amount > 0 && amount <= balance && !busy;
  const cashValid = amount > 0 && balance > 0 && !busy;
  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950 space-y-3"
      data-testid="split-tender-window">
      <div>
        <h3 className="font-semibold">Claim split payment</h3>
        <p className="text-xs text-muted-foreground">Enter each portion, then choose its payment method. Remaining: €{Math.max(0, balance).toFixed(2)}</p>
      </div>
      <label className="block text-sm font-medium">
        Amount to claim
        <Input aria-label="Split amount" data-testid="input-split-amount" inputMode="decimal"
          disabled={busy || balance <= 0} placeholder="0.00"
          value={displayed}
          onChange={event => {
            const raw = event.target.value;
            if (/^\d{0,6}(?:[.,]\d{0,2})?$/.test(raw)) {
              setText(raw);
              const value = Number(raw.replace(",", "."));
              onDigits(raw ? String(Math.round(value * 100)) : "");
            }
          }}
          onFocus={event => event.target.select()} />
      </label>
      <div className="flex gap-2">
        <Button variant="outline" disabled={!cashValid} onClick={onCash} data-testid="btn-split-claim-cash">Claim cash</Button>
        <Button disabled={!valid} onClick={onCard} data-testid="btn-split-claim-card">Claim card</Button>
        <Button variant="outline" disabled={busy || balance <= 0}
          onClick={() => onDigits(String(Math.round(Math.max(0, balance) * 100)))}
          data-testid="btn-split-remaining">Remaining</Button>
      </div>
      {amount > balance && <p role="status" className="text-amber-700 text-xs">Cash change: €{(amount - balance).toFixed(2)}. A card portion cannot exceed the remaining balance.</p>}
      <p className="text-xs text-muted-foreground">Use the same amount for a voucher, credit note or cheque below. Card portions are claimed only after approval.</p>
    </section>
  );
}