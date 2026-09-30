import { Zap } from "lucide-react";
import type { ActionDef, ActionGroup } from "@/pages/pos-layout-editor";

export type PosSetting = { key: string; value: string };
export type ConditionRule = {
  receiptSign: "any" | "negative" | "positive" | "zero";
  transactionType: "any" | "return" | "sale";
  result: "print_credit_note" | "propose_gift_voucher" | "run_function" | "custom";
  amountSource: "receipt_total" | "absolute_receipt_total" | "manual";
  functionCode: string;
  note: string;
};
export type FunctionDefinition = {
  behavior: string;
  mode: "single" | "macro" | "conditional";
  steps: string[];
  rules: ConditionRule[];
  label?: string;
  approved?: boolean;
};
export type CustomFunction = { code: string; label: string; description: string };

export const definitionKey = (code: string) => `pos_function_definition_${code.toLowerCase()}`;
export const customFunctionKey = (code: string) => `pos_custom_function_${code.toLowerCase()}`;
export const newConditionRule = (): ConditionRule => ({
  receiptSign: "any", transactionType: "any", result: "custom",
  amountSource: "receipt_total", functionCode: "", note: "",
});
export const voucherExampleRules = (): ConditionRule[] => [
  {
    receiptSign: "negative", transactionType: "return", result: "print_credit_note",
    amountSource: "absolute_receipt_total", functionCode: "",
    note: "Print a voucher as a credit note for the return amount.",
  },
  {
    receiptSign: "positive", transactionType: "any", result: "propose_gift_voucher",
    amountSource: "receipt_total", functionCode: "",
    note: "Propose the positive receipt amount; allow the operator to confirm or edit it.",
  },
];
// Reserve a namespace so new codes cannot accidentally invoke a legacy POS handler.
export const validFunctionCode = (code: string) => /^CUSTOM_[A-Z][A-Z0-9_]{0,32}$/.test(code);

export function cloneFunctionDefinition(source: FunctionDefinition, behavior = source.behavior): FunctionDefinition {
  return {
    behavior, mode: source.mode, steps: [...source.steps],
    rules: source.rules.map(rule => ({ ...rule })),
    approved: false,
  };
}

export function readCustomFunctions(settings: PosSetting[], builtIns: ActionDef[]): ActionDef[] {
  const builtInCodes = new Set(builtIns.map(action => action.code));
  const seen = new Set<string>();
  return settings.flatMap(setting => {
    if (!setting.key.startsWith("pos_custom_function_")) return [];
    try {
      const item = JSON.parse(setting.value) as CustomFunction;
      if (typeof item?.code !== "string" || !validFunctionCode(item.code) ||
          setting.key !== customFunctionKey(item.code) || builtInCodes.has(item.code) ||
          seen.has(item.code) || typeof item.label !== "string" || !item.label.trim() ||
          typeof item.description !== "string") return [];
      seen.add(item.code);
      return [{ code: item.code, label: item.label, description: item.description, icon: Zap }];
    } catch {
      return [];
    }
  });
}

export function readDefinition(settings: PosSetting[], code: string, fallback: string): FunctionDefinition {
  const value = settings.find(setting => setting.key === definitionKey(code))?.value;
  if (!value) return { behavior: fallback, mode: "single", steps: [], rules: [] };
  try {
    const data = JSON.parse(value);
    if (typeof data?.behavior === "string" && ["single", "macro", "conditional"].includes(data?.mode) &&
        Array.isArray(data.steps) && data.steps.every((step: unknown) => typeof step === "string")) {
      const rules = Array.isArray(data.rules) && data.rules.every((rule: any) =>
        rule && ["any", "negative", "positive", "zero"].includes(rule.receiptSign) &&
        ["any", "return", "sale"].includes(rule.transactionType) &&
        ["print_credit_note", "propose_gift_voucher", "run_function", "custom"].includes(rule.result) &&
        ["receipt_total", "absolute_receipt_total", "manual"].includes(rule.amountSource) &&
        typeof rule.functionCode === "string" && typeof rule.note === "string"
      ) ? data.rules as ConditionRule[] : [];
      return {
        behavior: data.behavior, mode: data.mode, steps: data.steps, rules,
        label: typeof data.label === "string" && data.label.trim() && data.label.length <= 80
          ? data.label.trim() : undefined,
        approved: data.approved === true,
      };
    }
  } catch {
    // Older definitions were stored as plain text.
  }
  return { behavior: value, mode: "single", steps: [], rules: [] };
}

export function configuredGroups(groups: ActionGroup[], custom: ActionDef[], settings: PosSetting[] = []): ActionGroup[] {
  const renamed = groups.map(group => ({
    ...group,
    actions: group.actions.map(action => ({
      ...action,
      label: readDefinition(settings, action.code, action.description || "").label || action.label,
    })),
  }));
  return custom.length
    ? [...renamed, { group: "Custom Functions", icon: Zap, color: "text-violet-600", actions: custom }]
    : renamed;
}

export function wouldCreateFunctionCycle(
  code: string,
  candidate: FunctionDefinition,
  allActions: ActionDef[],
  settings: PosSetting[],
): boolean {
  const actions = new Map(allActions.map(action => [action.code, action]));
  const visit = (current: string, path: Set<string>): boolean => {
    if (path.has(current)) return true;
    const action = actions.get(current);
    if (!action) return false;
    const definition = current === code
      ? candidate
      : readDefinition(settings, current, action.description || "");
    const references = definition.mode === "macro" ? definition.steps
      : definition.mode === "conditional"
        ? definition.rules.filter(rule => rule.result === "run_function").map(rule => rule.functionCode)
        : [];
    const next = new Set(path);
    next.add(current);
    return references.some(step => visit(step, next));
  };
  return visit(code, new Set());
}