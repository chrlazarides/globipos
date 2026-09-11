import assert from "node:assert/strict";
import test from "node:test";
import { isPublicPath } from "./auth";

test("terminal-code sync routes can reach their own authentication middleware", () => {
  assert.equal(isPublicPath("/api/sync/catalog"), true);
  assert.equal(isPublicPath("/api/sync/inbox"), true);
  assert.equal(isPublicPath("/api/pos/sync/catalog-v2"), true);
  assert.equal(isPublicPath("/api/pos/sync/customer-search"), true);
});

test("admin sync configuration routes still require a user session", () => {
  assert.equal(isPublicPath("/api/pos/sync-config"), false);
  assert.equal(isPublicPath("/api/pos/sync-config/catalog"), false);
});