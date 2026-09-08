import assert from "node:assert/strict";
import test from "node:test";
import { isActiveDomainCheckDue, withDeadline } from "./deployment-control";

const now = Date.parse("2026-09-08T12:00:00.000Z");

test("active connected domains are checked every six hours", () => {
  assert.equal(isActiveDomainCheckDue({
    status: "active",
    customerDomain: "shop.example.com",
    domainStatus: "connected",
    domainCheckedAt: new Date(now - 6 * 60 * 60 * 1000),
  }, now), true);
  assert.equal(isActiveDomainCheckDue({
    status: "active",
    customerDomain: "shop.example.com",
    domainStatus: "connected",
    domainCheckedAt: new Date(now - 5 * 60 * 60 * 1000),
  }, now), false);
});

test("failed domains are retried no more than hourly", () => {
  assert.equal(isActiveDomainCheckDue({
    status: "active",
    customerDomain: "shop.example.com",
    domainStatus: "failed",
    domainCheckedAt: new Date(now - 60 * 60 * 1000),
  }, now), true);
  assert.equal(isActiveDomainCheckDue({
    status: "active",
    customerDomain: "shop.example.com",
    domainStatus: "failed",
    domainCheckedAt: new Date(now - 59 * 60 * 1000),
  }, now), false);
});

test("draft, suspended, and unconfigured profiles are never scheduled", () => {
  for (const profile of [
    { status: "draft", customerDomain: "shop.example.com", domainStatus: "connected", domainCheckedAt: null },
    { status: "suspended", customerDomain: "shop.example.com", domainStatus: "failed", domainCheckedAt: null },
    { status: "active", customerDomain: null, domainStatus: "pending", domainCheckedAt: null },
  ]) {
    assert.equal(isActiveDomainCheckDue(profile, now), false);
  }
});

test("a stalled domain operation returns a useful timeout result", async () => {
  const result = await withDeadline(
    new Promise<string>(() => {}),
    5,
    "domain probe timed out",
  );
  assert.equal(result, "domain probe timed out");
});