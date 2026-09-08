import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IncidentHistory, incidentDuration } from "./deployment-control";

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
    },
    {
      id: "ongoing",
      startedAt: "2026-09-08T11:00:00.000Z",
      recoveredAt: null,
      reason: "HTTPS certificate expired",
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
