import type { ActionDef } from "@/pages/pos-layout-editor";
import { readDefinition, type FunctionDefinition, type PosSetting } from "./pos-function-config";

export type SimulationScenario = {
  receiptTotal: number;
  transactionType: "sale" | "return";
  manualAmount?: number;
};
export type SimulationLine = { kind: "info" | "outcome" | "warning"; text: string; depth: number };
export type SimulationResult = { lines: SimulationLine[]; hasOutcome: boolean; hasWarning: boolean };

const euro = (amount: number) => new Intl.NumberFormat("en-CY", { style: "currency", currency: "EUR" }).format(amount);
const MAX_VISITS = 100;

export function simulatePosFunction(
  code: string,
  currentDefinition: FunctionDefinition,
  scenario: SimulationScenario,
  actions: ActionDef[],
  settings: PosSetting[],
): SimulationResult {
  if (!Number.isFinite(scenario.receiptTotal) || Math.abs(scenario.receiptTotal) > 1_000_000_000 ||
      (scenario.manualAmount !== undefined && (!Number.isFinite(scenario.manualAmount) || scenario.manualAmount <= 0))) {
    return { lines: [{ kind: "warning", text: "Enter a valid receipt total and a positive manual amount.", depth: 0 }], hasOutcome: false, hasWarning: true };
  }
  const byCode = new Map(actions.map(action => [action.code, action]));
  const lines: SimulationLine[] = [];
  let visits = 0;
  const add = (kind: SimulationLine["kind"], text: string, depth: number) => lines.push({ kind, text, depth });

  function walk(functionCode: string, depth: number, path: Set<string>) {
    if (++visits > MAX_VISITS || depth > 20) {
      add("warning", "Simulation stopped: too many nested steps.", depth);
      return;
    }
    if (path.has(functionCode)) {
      add("warning", `Simulation stopped: ${functionCode} calls itself through another function.`, depth);
      return;
    }
    const action = byCode.get(functionCode);
    if (!action) {
      add("warning", `Function ${functionCode} is not in the catalog.`, depth);
      return;
    }
    const definition = functionCode === code
      ? currentDefinition
      : readDefinition(settings, functionCode, action.description || "");
    add("info", `Press ${action.label} (${functionCode})`, depth);
    const nextPath = new Set(path);
    nextPath.add(functionCode);
    if (definition.mode === "single") {
      add("warning", `Definition only: ${definition.behavior || "No behavior specified"}. No simulated action is available.`, depth + 1);
      return;
    }
    if (definition.mode === "macro") {
      if (!definition.steps.length) add("warning", "Macro has no steps.", depth + 1);
      definition.steps.forEach((step, index) => {
        add("info", `Step ${index + 1} of ${definition.steps.length}`, depth + 1);
        walk(step, depth + 2, nextPath);
      });
      return;
    }
    const index = definition.rules.findIndex(rule =>
      (rule.transactionType === "any" || rule.transactionType === scenario.transactionType) &&
      (rule.receiptSign === "any" ||
        (rule.receiptSign === "negative" && scenario.receiptTotal < 0) ||
        (rule.receiptSign === "positive" && scenario.receiptTotal > 0) ||
        (rule.receiptSign === "zero" && scenario.receiptTotal === 0)),
    );
    if (index < 0) {
      add("warning", `No rule matches this ${scenario.transactionType} with a ${euro(scenario.receiptTotal)} receipt. No outcome is defined.`, depth + 1);
      return;
    }
    const rule = definition.rules[index];
    add("info", `Rule ${index + 1} matched: ${scenario.transactionType}, ${euro(scenario.receiptTotal)}. Later rules were not checked.`, depth + 1);
    if (rule.result === "run_function") {
      if (!rule.functionCode) add("warning", "Rule has no target function.", depth + 2);
      else walk(rule.functionCode, depth + 2, nextPath);
      return;
    }
    if (rule.result === "custom") {
      add("warning", `Custom outcome is described but not simulated: ${rule.note || "No details supplied"}`, depth + 2);
      return;
    }
    const amount = rule.amountSource === "manual" ? scenario.manualAmount
      : rule.amountSource === "absolute_receipt_total" ? Math.abs(scenario.receiptTotal)
      : scenario.receiptTotal;
    if (amount === undefined) {
      add("warning", "This rule asks the operator for an amount. Enter a manual amount to preview the result.", depth + 2);
    } else if (amount <= 0 || !Number.isFinite(amount)) {
      add("warning", `The configured source yields ${euro(amount)}. A voucher amount must be positive.`, depth + 2);
    } else {
      add("outcome", rule.result === "print_credit_note"
        ? `Would print a credit-note voucher for ${euro(amount)} (no print was sent).`
        : `Would propose a gift voucher amount of ${euro(amount)} for operator confirmation (no voucher was issued).`, depth + 2);
    }
    if (rule.note) add("info", `Operator details: ${rule.note}`, depth + 2);
  }
  walk(code, 0, new Set());
  return {
    lines,
    hasOutcome: lines.some(line => line.kind === "outcome"),
    hasWarning: lines.some(line => line.kind === "warning"),
  };
}