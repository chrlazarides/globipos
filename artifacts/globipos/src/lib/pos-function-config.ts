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
export type MacroCondition = Pick<ConditionRule, "transactionType" | "receiptSign">;
export type FunctionDefinition = {
  behavior: string;
  mode: "single" | "macro" | "conditional";
  steps: string[];
  stepConditions?: (MacroCondition | null)[];
  rules: ConditionRule[];
  label?: string;
  approved?: boolean;
  launch?: ExternalLaunch;
  launchApproval?: ExternalLaunch;
};
export type ExternalLaunch = { type: "web" | "app" | "server"; target: string };

export function isExternalTargetApproved(definition: FunctionDefinition): boolean {
  return !!definition.launch && validExternalLaunch(definition.launch) &&
    definition.launchApproval?.type === definition.launch.type &&
    definition.launchApproval.target === definition.launch.target;
}

export function validExternalLaunch(launch: ExternalLaunch): boolean {
  if (launch.target.length > 2048 || !launch.target.trim()) return false;
  try {
    const url = new URL(launch.target);
    if (url.username || url.password) return false;
    if (launch.type === "web" || launch.type === "server") {
      return url.protocol === "https:" || url.protocol === "http:";
    }
    return launch.type === "app" &&
      /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) &&
      !["http:", "https:", "file:", "javascript:", "data:", "blob:", "ftp:", "shell:", "cmd:", "powershell:"].includes(url.protocol);
  } catch {
    return false;
  }
}
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
    stepConditions: source.stepConditions?.map(condition => condition ? { ...condition } : null),
    rules: source.rules.map(rule => ({ ...rule })),
    launch: source.launch ? { ...source.launch } : undefined,
    // A clone needs its own explicit target approval even when it copies a URL.
    launchApproval: undefined,
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
        stepConditions: Array.isArray(data.stepConditions)
          ? data.steps.map((_: string, index: number) => {
              const condition = data.stepConditions[index];
              return condition && ["any", "sale", "return"].includes(condition.transactionType) &&
                ["any", "positive", "negative", "zero"].includes(condition.receiptSign)
                ? { transactionType: condition.transactionType, receiptSign: condition.receiptSign } : null;
            }) : undefined,
        label: typeof data.label === "string" && data.label.trim() && data.label.length <= 80
          ? data.label.trim() : undefined,
        approved: data.approved === true,
        launch: data.launch && ["web", "app", "server"].includes(data.launch.type) &&
          typeof data.launch.target === "string" && validExternalLaunch(data.launch)
          ? { type: data.launch.type, target: data.launch.target } : undefined,
        launchApproval: data.launchApproval && ["web", "app", "server"].includes(data.launchApproval.type) &&
          typeof data.launchApproval.target === "string" && validExternalLaunch(data.launchApproval)
          ? { type: data.launchApproval.type, target: data.launchApproval.target } : undefined,
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