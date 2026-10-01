import assert from "node:assert/strict";
import test from "node:test";
import { transferDestinations } from "./stock-transfer-options";

test("the POS destination picker accepts the live API's id/name-only contract", () => {
  assert.deepEqual(transferDestinations([
    { id: "home", name: "This shop" }, { id: "other", name: "Other shop" },
    { id: "inactive", name: "Closed shop", active: false },
  ], "home"), [{ id: "other", name: "Other shop" }]);
});