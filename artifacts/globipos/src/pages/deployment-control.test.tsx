import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IncidentHistory, ResolvedOperatorAlerts, incidentDuration, retryCooldownLabel } from "./deployment-control";

test("incident duration formats minutes, hours, and days", () => {
  assert.equal(incidentDuration("2026-09-08T10:00:00.000Z", "2026-09-08T10:42:00.000Z"), "42m");
  assert.equal(incidentDuration("2026-09-08T10:00:00.000Z", "2026-09-08T12:05:00.000Z"), "2h 5m");
  assert.equal(incidentDuration("2026-09-07T08:00:00.000Z", "2026-09-08T10:00:00.000Z"), "1d 2h");
});

test("incident history renders start, recovery, duration, reason, and ongoing labels", () => {
  const markup = renderToStaticMarkup(<IncidentHistory incidents={[
    {
      id: "recovered",
      startedAt: "2026-09-08T10:00:00.000Z",
      recoveredAt: "2026-09-08T10:42:00.000Z",
      reason: "DNS resolution failed",
      role: "main",
    },
    {
      id: "ongoing",
      startedAt: "2026-09-08T11:00:00.000Z",
      recoveredAt: null,
      reason: "HTTPS certificate expired",
      role: "eshop",
    },
  ]} />);

  assert.match(markup, /9\/8\/2026|08\/09\/2026|2026/);
  assert.match(markup, /Recovered · 42m/);
  assert.match(markup, /Recovered /);
  assert.match(markup, /DNS resolution failed/);
  assert.match(markup, /Ongoing · /);
  assert.match(markup, /HTTPS certificate expired/);
  assert.match(markup, /Recovery not yet recorded/);
});

test("unresolved operator alert warnings offer a retry delivery action", () => {
  const source = readFileSync(new URL("./deployment-control.tsx", import.meta.url), "utf8");
  assert.match(source, /\/api\/control\/operator-alerts\/\$\{operation\}\/retry/);
  assert.match(source, /Retry delivery<\/Button>/);
  assert.match(source, /disabled=\{alertRetryMutation\.isPending \|\| Boolean\(cooldownLabel\)\}/);
});

test("operator alert cooldown labels expire without a page reload", () => {
  const retryAt = "2026-09-08T10:02:05.000Z";
  assert.match(retryCooldownLabel(retryAt, new Date("2026-09-08T10:00:00.000Z").getTime())!, /in 2m 5s/);
  assert.equal(retryCooldownLabel(retryAt, new Date(retryAt).getTime()), null);
});

test("resolved operator alerts render resolution time and sanitized retry outcomes", () => {
  const markup = renderToStaticMarkup(<ResolvedOperatorAlerts alerts={[{
    operation: "save",
    resolvedAt: "2026-09-08T14:05:00.000Z",
    retryHistory: [
      { attemptedAt: "2026-09-08T14:00:00.000Z", outcome: "failed" },
      { attemptedAt: "2026-09-08T14:05:00.000Z", outcome: "delivered" },
    ],
  }]} />);
  assert.match(markup, /Recently resolved operator alerts/);
  assert.match(markup, /Customer AI history save/);
  assert.match(markup, /Resolved /);
  assert.match(markup, /Failed/);
  assert.match(markup, /Delivered/);
  assert.doesNotMatch(markup, /credential|@example\.com|email address/i);
});
