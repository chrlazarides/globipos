import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionDef } from "@/pages/pos-layout-editor";
import { definitionKey, voucherExampleRules, type FunctionDefinition, type PosSetting } from "./pos-function-config";
import { simulateLayoutAction, simulatePosFunction } from "./pos-function-simulator";

const actions: ActionDef[] = [
  { code: "PAY_VOUCHER", label: "Voucher", icon: null },
  { code: "CUSTOM_EXAMPLE", label: "Example macro", icon: null },
];
const voucher: FunctionDefinition = {
  behavior: "Voucher setup", mode: "conditional", steps: [], rules: voucherExampleRules(),
};
const settings: PosSetting[] = [
  { key: definitionKey("PAY_VOUCHER"), value: JSON.stringify(voucher) },
];
const run = (definition: FunctionDefinition, total: number, transactionType: "return" | "sale", manualAmount?: number) =>
  simulatePosFunction("PAY_VOUCHER", definition, { receiptTotal: total, transactionType, manualAmount }, actions, settings);

test("negative return proposes a positive credit-note voucher without printing", () => {
  const result = run(voucher, -25, "return");
  assert.equal(result.hasOutcome, true);
  assert.match(result.lines.find(line => line.kind === "outcome")!.text, /credit-note voucher for €25\.00/);
  assert.match(result.lines.find(line => line.kind === "info" && line.text.includes("Rule"))!.text, /Rule 1 matched/);
});

test("positive receipt proposes a gift voucher amount", () => {
  const result = run(voucher, 17.5, "sale");
  assert.equal(result.hasOutcome, true);
  assert.match(result.lines.find(line => line.kind === "outcome")!.text, /gift voucher amount of €17\.50/);
  assert.match(result.lines.find(line => line.kind === "info" && line.text.includes("Rule"))!.text, /Rule 2 matched/);
});

test("non-matching and zero receipts never propose a voucher", () => {
  for (const [total, type] of [[-25, "sale"], [0, "return"]] as const) {
    const result = run(voucher, total, type);
    assert.equal(result.hasOutcome, false);
    assert.match(result.lines.at(-1)!.text, /No rule matches/);
  }
});

test("manual amount requires input; negative proposed amounts are refused", () => {
  const manual: FunctionDefinition = {
    ...voucher, rules: [{ ...voucher.rules[1], amountSource: "manual" }],
  };
  assert.match(run(manual, 20, "sale").lines.find(line => line.kind === "warning")!.text, /Enter a manual amount/);
  assert.match(run(manual, 20, "sale", 12).lines.find(line => line.kind === "outcome")!.text, /€12\.00/);
  const negative: FunctionDefinition = {
    ...voucher, rules: [{ ...voucher.rules[0], transactionType: "any", amountSource: "receipt_total" }],
  };
  assert.equal(run(negative, -20, "return").hasOutcome, false);
  assert.match(run(negative, -20, "return").lines.find(line => line.kind === "warning")!.text, /must be positive/);
});

test("macro traces a referenced function and detects circular calls", () => {
  const macro: FunctionDefinition = {
    behavior: "Run voucher", mode: "macro", steps: ["PAY_VOUCHER"], rules: [],
  };
  const preview = simulatePosFunction(
    "CUSTOM_EXAMPLE", macro, { receiptTotal: 10, transactionType: "sale" }, actions, settings,
  );
  assert.equal(preview.hasOutcome, true);
  assert.match(preview.lines.find(line => line.kind === "outcome")!.text, /€10\.00/);
  const loop = run({ ...voucher, rules: [{ ...voucher.rules[1], result: "run_function", functionCode: "PAY_VOUCHER" }] }, 10, "sale");
  assert.equal(loop.hasOutcome, false);
  assert.match(loop.lines.at(-1)!.text, /calls itself/);
});

test("full-layout button uses saved conditions while an ordinary built-in keeps its existing handler", () => {
  const sale = simulateLayoutAction("PAY_VOUCHER", { receiptTotal: 25, transactionType: "sale" }, actions, settings);
  const refund = simulateLayoutAction("PAY_VOUCHER", { receiptTotal: -25, transactionType: "return" }, actions, settings);
  assert.match(sale!.lines.find(line => line.kind === "outcome")!.text, /gift voucher amount of €25\.00/);
  assert.match(refund!.lines.find(line => line.kind === "outcome")!.text, /credit-note voucher for €25\.00/);
  const defaultBuiltIn = simulateLayoutAction("PAY_VOUCHER", { receiptTotal: 25, transactionType: "sale" }, actions, []);
  assert.equal(defaultBuiltIn, null);
  assert.equal(simulateLayoutAction("MISSING", { receiptTotal: 25, transactionType: "sale" }, actions, settings)?.hasWarning, true);
});

test("a saved layout macro follows referenced saved rules without changing checkout data", () => {
  const macro: FunctionDefinition = {
    behavior: "Voucher workflow", mode: "macro", steps: ["PAY_VOUCHER"], rules: [],
  };
  const configured = [
    ...settings, { key: definitionKey("CUSTOM_EXAMPLE"), value: JSON.stringify(macro) },
  ];
  const preview = simulateLayoutAction(
    "CUSTOM_EXAMPLE", { receiptTotal: -19, transactionType: "return" }, actions, configured,
  );
  assert.match(preview!.lines.find(line => line.kind === "info" && line.text.includes("Step"))!.text, /Step 1 of 1/);
  assert.match(preview!.lines.find(line => line.kind === "outcome")!.text, /credit-note voucher for €19\.00/);
});

test("macro presses only the buttons whose sale/return and receipt conditions match", () => {
  const macro: FunctionDefinition = {
    behavior: "Conditional voucher keypresses", mode: "macro",
    steps: ["PAY_VOUCHER", "PAY_VOUCHER"], rules: [],
    stepConditions: [
      { transactionType: "sale", receiptSign: "positive" },
      { transactionType: "return", receiptSign: "negative" },
    ],
  };
  const sale = simulatePosFunction("CUSTOM_EXAMPLE", macro, { receiptTotal: 10, transactionType: "sale" }, actions, settings);
  const refund = simulatePosFunction("CUSTOM_EXAMPLE", macro, { receiptTotal: -10, transactionType: "return" }, actions, settings);
  assert.equal(sale.lines.filter(line => line.kind === "outcome").length, 1);
  assert.equal(refund.lines.filter(line => line.kind === "outcome").length, 1);
  assert.match(sale.lines.find(line => line.text.includes("skipped"))!.text, /Step 2/);
  assert.match(refund.lines.find(line => line.text.includes("skipped"))!.text, /Step 1/);
});