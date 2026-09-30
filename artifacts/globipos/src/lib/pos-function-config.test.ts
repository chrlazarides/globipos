import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionDef, ActionGroup } from "@/pages/pos-layout-editor";
import {
  cloneFunctionDefinition, configuredGroups, customFunctionKey, definitionKey,
  readCustomFunctions, readDefinition, voucherExampleRules, type FunctionDefinition,
} from "./pos-function-config";

const base: ActionDef = { code: "PAY_VOUCHER", label: "Redeem Voucher", description: "Accept a voucher", icon: null };
const group: ActionGroup = { group: "Payments", icon: null, color: "", actions: [base] };
const definition: FunctionDefinition = {
  behavior: "Test a return and a sale", mode: "conditional", steps: [],
  rules: voucherExampleRules(), label: "Voucher & Credit Note", approved: true,
};

test("built-in rename and approval survive saving without changing its code", () => {
  const settings = [{ key: definitionKey(base.code), value: JSON.stringify(definition) }];
  const loaded = readDefinition(settings, base.code, base.description!);
  assert.equal(loaded.label, "Voucher & Credit Note");
  assert.equal(loaded.approved, true);
  assert.equal(configuredGroups([group], [], settings)[0].actions[0].label, "Voucher & Credit Note");
  assert.equal(configuredGroups([group], [], settings)[0].actions[0].code, base.code);
});

test("unsaved, legacy, and malformed definitions cannot acquire approval accidentally", () => {
  assert.equal(readDefinition([], base.code, base.description!).approved, undefined);
  assert.equal(readDefinition([{ key: definitionKey(base.code), value: "Old behavior" }], base.code, "").approved, undefined);
  const malformed = { ...definition, label: "x".repeat(81), approved: "true" };
  const loaded = readDefinition([{ key: definitionKey(base.code), value: JSON.stringify(malformed) }], base.code, "");
  assert.equal(loaded.approved, false);
  assert.equal(configuredGroups([group], [], [{ key: definitionKey(base.code), value: JSON.stringify(malformed) }])[0].actions[0].label, base.label);
});

test("clones keep their own behavior and rules, but never inherit approval or the source label", () => {
  const clone = cloneFunctionDefinition(definition, "New specific behavior");
  assert.equal(clone.mode, "conditional");
  assert.equal(clone.behavior, "New specific behavior");
  assert.equal(clone.approved, false);
  assert.equal(clone.label, undefined);
  clone.rules[0].note = "Independent copy";
  assert.notEqual(definition.rules[0].note, clone.rules[0].note);
  assert.equal(definition.approved, true);
});

test("a newly saved custom function appears under its own name", () => {
  const settings = [{
    key: customFunctionKey("CUSTOM_VOUCHER_COPY"),
    value: JSON.stringify({ code: "CUSTOM_VOUCHER_COPY", label: "Voucher Copy", description: "For testing" }),
  }];
  const custom = readCustomFunctions(settings, [base]);
  assert.equal(configuredGroups([group], custom, settings)[1].actions[0].label, "Voucher Copy");
});