import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedExternalTools, validExternalLaunch } from "./pos-external-tools";

const buttons = [
  { buttonType: "action", actionCode: "OPEN_BROWSER" },
  { buttonType: "action", actionCode: "RUN_EXTERNAL_PROGRAM" },
  { buttonType: "item", actionCode: "CUSTOM_NOT_ASSIGNED" },
];

test("terminals receive only approved, assigned and valid external destinations", () => {
  const settings = [
    { key: "pos_function_definition_open_browser", value: JSON.stringify({
      mode: "single", approved: true, launch: { type: "web", target: "https://example.com/tools" },
      launchApproval: { type: "web", target: "https://example.com/tools" },
    }) },
    { key: "pos_function_definition_run_external_program", value: JSON.stringify({
      mode: "single", approved: false, launch: { type: "app", target: "cashdesk://open" },
    }) },
    { key: "pos_function_definition_custom_not_assigned", value: JSON.stringify({
      mode: "single", approved: true, launch: { type: "web", target: "https://example.com/private" },
      launchApproval: { type: "web", target: "https://example.com/private" },
    }) },
  ];
  assert.deepEqual(Object.keys(approvedExternalTools(buttons, settings)), ["OPEN_BROWSER"]);
  assert.equal(approvedExternalTools(buttons, settings).OPEN_BROWSER.target, "https://example.com/tools");
});

test("an approved button cannot launch an unapproved or changed target", () => {
  const definition = {
    mode: "single", approved: true, launch: { type: "web", target: "https://new.example.com" },
    launchApproval: { type: "web", target: "https://old.example.com" },
  };
  const settings = [{ key: "pos_function_definition_open_browser", value: JSON.stringify(definition) }];
  assert.deepEqual(Object.keys(approvedExternalTools(buttons, settings)), []);
  delete (definition as { launchApproval?: unknown }).launchApproval;
  settings[0].value = JSON.stringify(definition);
  assert.deepEqual(Object.keys(approvedExternalTools(buttons, settings)), []);
});

test("app links do not turn into shell, file, or script execution", () => {
  for (const target of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "shell://run"]) {
    assert.equal(validExternalLaunch({ type: "app", target }), false);
  }
  const settings = [{ key: "pos_function_definition_open_browser", value: JSON.stringify({
    mode: "single", approved: true, launch: { type: "app", target: "cashdesk://open" },
  }) }];
  assert.deepEqual(Object.keys(approvedExternalTools(buttons, settings)), []);
});