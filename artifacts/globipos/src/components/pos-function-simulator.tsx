import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { simulatePosFunction, type SimulationResult } from "@/lib/pos-function-simulator";
import type { FunctionDefinition, PosSetting } from "@/lib/pos-function-config";
import type { ActionDef } from "@/pages/pos-layout-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function parseMoney(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && Math.abs(amount) <= 1_000_000_000 ? amount : null;
}

export function PosFunctionSimulator({
  code, definition, actions, settings, unsaved,
}: {
  code: string;
  definition: FunctionDefinition;
  actions: ActionDef[];
  settings: PosSetting[];
  unsaved: boolean;
}) {
  const [receiptTotal, setReceiptTotal] = useState("-25.00");
  const [transactionType, setTransactionType] = useState<"sale" | "return">("return");
  const [manualAmount, setManualAmount] = useState("");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [inputError, setInputError] = useState("");

  useEffect(() => {
    setResult(null);
    setInputError("");
  }, [code, definition, settings]);

  function run(totalText = receiptTotal, type = transactionType) {
    const total = parseMoney(totalText);
    const manual = manualAmount.trim() ? parseMoney(manualAmount) : undefined;
    if (total === null || manual === null || (manual !== undefined && manual <= 0)) {
      setInputError("Enter a valid receipt total and, if needed, a positive manual amount (up to two decimal places).");
      setResult(null);
      return;
    }
    setInputError("");
    setResult(simulatePosFunction(code, definition, {
      receiptTotal: total, transactionType: type, manualAmount: manual,
    }, actions.map(action => action.code === code
      ? { ...action, label: definition.label?.trim() || action.label } : action), settings));
  }

  return (
    <section className="space-y-4 rounded-lg border border-sky-200 bg-sky-50/40 p-4" aria-label="Function dry-run simulator">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="h-4 w-4" />Simulate button press</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {unsaved ? "Tests the current unsaved edits." : "Tests the current saved setup."} Referenced functions use their saved definitions.
            No sale, voucher or print job is created.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => run()} data-testid="simulate-pos-function">Run simulation</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Receipt total (€)
          <Input inputMode="decimal" className="mt-1 bg-background" value={receiptTotal}
            onChange={event => { setReceiptTotal(event.target.value); setResult(null); }}
            aria-label="Simulation receipt total" placeholder="-25.00" />
        </label>
        <label className="text-sm">Transaction
          <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={transactionType}
            onChange={event => { setTransactionType(event.target.value as "sale" | "return"); setResult(null); }}>
            <option value="return">Return</option><option value="sale">Sale</option>
          </select>
        </label>
        <label className="text-sm">Manual amount (€), if required
          <Input inputMode="decimal" className="mt-1 bg-background" value={manualAmount}
            onChange={event => { setManualAmount(event.target.value); setResult(null); }}
            aria-label="Simulation manual amount" placeholder="Optional" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => {
          setReceiptTotal("-25.00"); setTransactionType("return"); run("-25.00", "return");
        }}>Try negative return</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => {
          setReceiptTotal("25.00"); setTransactionType("sale"); run("25.00", "sale");
        }}>Try positive sale</Button>
      </div>
      {inputError && <p role="alert" className="text-sm text-destructive">{inputError}</p>}
      {result && (
        <div role="status" aria-live="polite" className="space-y-2 rounded-md border bg-background p-3" data-testid="pos-function-simulation-result">
          <strong className="text-sm">
            {result.hasWarning ? result.hasOutcome ? "Preview with warnings" : "No simulated outcome" : result.hasOutcome ? "Proposed outcome" : "No simulated outcome"}
          </strong>
          <ol className="space-y-1.5">
            {result.lines.map((line, index) => (
              <li key={index} className={`text-sm ${line.kind === "outcome" ? "font-semibold text-emerald-700" : line.kind === "warning" ? "text-amber-800" : "text-muted-foreground"}`}
                style={{ paddingLeft: `${Math.min(line.depth, 5) * 12}px` }}>
                {line.text}
              </li>
            ))}
          </ol>
          <p className="border-t pt-2 text-xs text-muted-foreground">Dry run only. This does not validate payment, accounting, voucher codes, printer output or terminal behavior.</p>
        </div>
      )}
    </section>
  );
}