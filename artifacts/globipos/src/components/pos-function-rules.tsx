import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ActionDef } from "@/pages/pos-layout-editor";
import { newConditionRule, type ConditionRule } from "@/lib/pos-function-config";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const selectClass = "mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm";

export function PosFunctionRules({
  code, rules, actions, onChange, onLoadVoucherExample,
}: {
  code: string;
  rules: ConditionRule[];
  actions: ActionDef[];
  onChange: (rules: ConditionRule[]) => void;
  onLoadVoucherExample?: () => void;
}) {
  function edit(index: number, patch: Partial<ConditionRule>) {
    onChange(rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        When this function button is pressed, check the rules from top to bottom. The first matching rule defines the proposed outcome.
        These rules are a saved specification, not live POS logic.
      </p>
      {rules.map((rule, index) => (
        <div key={index} className="space-y-3 rounded-md border bg-background p-3" data-testid={`condition-rule-${index}`}>
          <div className="flex items-center justify-between gap-2">
            <strong className="text-sm">Rule {index + 1}: If… then…</strong>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="icon" aria-label={`Move rule ${index + 1} up`} disabled={index === 0} onClick={() => {
                const next = [...rules]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next);
              }}><ArrowUp className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Move rule ${index + 1} down`} disabled={index === rules.length - 1} onClick={() => {
                const next = [...rules]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; onChange(next);
              }}><ArrowDown className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove rule ${index + 1}`} onClick={() => onChange(rules.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Receipt total is
              <select className={selectClass} value={rule.receiptSign}
                onChange={event => edit(index, { receiptSign: event.target.value as ConditionRule["receiptSign"] })}>
                <option value="any">Any amount</option><option value="negative">Negative (below zero)</option>
                <option value="positive">Positive (above zero)</option><option value="zero">Zero</option>
              </select>
            </label>
            <label className="text-sm">Transaction is
              <select className={selectClass} value={rule.transactionType}
                onChange={event => edit(index, { transactionType: event.target.value as ConditionRule["transactionType"] })}>
                <option value="any">Sale or return</option><option value="return">Return</option><option value="sale">Sale</option>
              </select>
            </label>
          </div>
          <label className="block text-sm">Then
            <select className={selectClass} value={rule.result}
              onChange={event => edit(index, { result: event.target.value as ConditionRule["result"] })}>
              <option value="print_credit_note">Print voucher as credit note</option>
              <option value="propose_gift_voucher">Propose gift voucher amount</option>
              <option value="run_function">Call another function</option>
              <option value="custom">Other outcome (describe below)</option>
            </select>
          </label>
          {(rule.result === "print_credit_note" || rule.result === "propose_gift_voucher") && (
            <label className="block text-sm">Amount to use or propose
              <select className={selectClass} value={rule.amountSource}
                onChange={event => edit(index, { amountSource: event.target.value as ConditionRule["amountSource"] })}>
                <option value="receipt_total">Current receipt total</option>
                <option value="absolute_receipt_total">Absolute receipt total (negative becomes positive)</option>
                <option value="manual">Ask operator for an amount</option>
              </select>
            </label>
          )}
          {rule.result === "run_function" && (
            <label className="block text-sm">Function to call
              <select className={selectClass} value={rule.functionCode}
                onChange={event => edit(index, { functionCode: event.target.value })}>
                <option value="">Choose a function…</option>
                {actions.filter(action => action.code !== code).map(action =>
                  <option key={action.code} value={action.code}>{action.label} ({action.code})</option>)}
              </select>
            </label>
          )}
          <label className="block text-sm">Details / operator message
            <Textarea className="mt-1" value={rule.note} maxLength={500} rows={2}
              onChange={event => edit(index, { note: event.target.value })}
              placeholder="Describe the voucher, confirmation, printing or fallback rules…" />
          </label>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={rules.length >= 20}
          onClick={() => onChange([...rules, newConditionRule()])}><Plus className="mr-1 h-4 w-4" />Add rule</Button>
        {onLoadVoucherExample && <Button type="button" variant="outline" size="sm" onClick={onLoadVoucherExample}>Load voucher example</Button>}
      </div>
      <p className="text-xs text-muted-foreground">{rules.length}/20 rules. If none match, the outcome still needs to be specified in the behavior notes.</p>
    </div>
  );
}