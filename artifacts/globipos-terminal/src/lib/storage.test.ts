import assert from "node:assert/strict";
import test from "node:test";
import { isQuotaError, isStorageLow, storageWriteError } from "./storage.ts";

test("identifies quota failures even when nested in a transaction or wrapped error", () => {
  const quota = new DOMException("Storage full", "QuotaExceededError");
  assert.equal(isQuotaError(quota), true);
  assert.equal(isQuotaError(new Error("aborted", { cause: quota })), true);
  assert.equal(isQuotaError({ name: "NS_ERROR_DOM_QUOTA_REACHED" }), true);
  assert.equal(isQuotaError(new Error("Network error")), false);
});

test("catalog and order errors explain recovery without clearing queued orders", () => {
  const quota = new DOMException("Storage full", "QuotaExceededError");
  const catalog = storageWriteError(quota, "catalog") as Error;
  const order = storageWriteError(quota, "order") as Error;
  assert.match(catalog.message, /sync stopped.*send pending orders/i);
  assert.match(catalog.message, /Do not clear site data/i);
  assert.match(order.message, /order was not saved/i);
  assert.equal(isQuotaError(order), true);
  const other = new Error("Network error");
  assert.equal(storageWriteError(other, "catalog"), other);
});

test("only warns on known, low remaining browser quota", () => {
  assert.equal(isStorageLow({}), false);
  assert.equal(isStorageLow({ usage: 0, quota: 0 }), false);
  assert.equal(isStorageLow({ usage: 950, quota: 1000 }), true);
  assert.equal(isStorageLow({ usage: 500, quota: 1000 }), false);
  assert.equal(isStorageLow({ usage: 950 * 1024 * 1024, quota: 1024 * 1024 * 1024 }), true);
});