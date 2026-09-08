import assert from "node:assert/strict";
import test from "node:test";
import {
  domainNotificationKind,
  isActiveDomainCheckDue,
  nextPendingDomainNotification,
  withDeadline,
} from "./deployment-control";
import { domainIncidentTransition, isActiveDomainCheckDue, withDeadline } from "./deployment-control";

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

test("domain notifications are emitted only on outage and recovery transitions", () => {
  assert.equal(domainNotificationKind("connected", "failed"), "outage");
  assert.equal(domainNotificationKind("failed", "connected"), "recovery");
  assert.equal(domainNotificationKind("failed", "failed"), null);
  assert.equal(domainNotificationKind("connected", "connected"), null);
  assert.equal(domainNotificationKind("pending", "failed"), "outage");
  assert.equal(domainNotificationKind("unknown", "failed"), "outage");
});

test("failed notification delivery remains pending for the next monitor retry", () => {
  const firstFailure = nextPendingDomainNotification("connected", "failed", null);
  assert.equal(firstFailure, "outage");
  assert.equal(nextPendingDomainNotification("failed", "failed", firstFailure), "outage");

  const afterSuccessfulDelivery = null;
  assert.equal(nextPendingDomainNotification("failed", "failed", afterSuccessfulDelivery), null);
  assert.equal(nextPendingDomainNotification("failed", "connected", afterSuccessfulDelivery), "recovery");
});

test("domain incidents are created and recovered only on status transitions", () => {
  assert.equal(domainIncidentTransition("connected", "failed"), "start");
  assert.equal(domainIncidentTransition("pending", "failed"), "start");
  assert.equal(domainIncidentTransition("failed", "failed"), "none");
  assert.equal(domainIncidentTransition("connected", "connected"), "recover");
  assert.equal(domainIncidentTransition("pending", "connected"), "recover");
  assert.equal(domainIncidentTransition("failed", "connected"), "recover");
});
