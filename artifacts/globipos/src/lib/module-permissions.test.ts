import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessModule, moduleKeys, withModules, withCreditApprove, CREDIT_APPROVE_PERMISSION as P } from "./module-permissions";

describe("module permission filtering", () => {
  it("credit grant alone keeps full module access", () => {
    assert.equal(canAccessModule("staff", [P], "items"), true);
    assert.deepEqual(moduleKeys([P]), []);
  });
  it("credit grant does not widen restricted access", () => {
    assert.equal(canAccessModule("staff", ["items", P], "customers"), false);
    assert.equal(canAccessModule("staff", ["items", P], "items"), true);
  });
  it("retains grant when modules change, and toggles it", () => {
    assert.deepEqual(withModules(["items", P], ["customers"]), ["customers", P]);
    assert.deepEqual(withModules(["items"], ["customers"]), ["customers"]);
    assert.deepEqual(withCreditApprove(["items"], true), ["items", P]);
    assert.deepEqual(withCreditApprove(["items", P], false), ["items"]);
  });
});
