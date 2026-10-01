import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeSyncHeartbeat, deviceReportsFromTerminals, mergeDeploymentDeviceReports, parseSyncTelemetry,
} from "./sync-telemetry";

const now = "2026-10-01T08:30:00.000Z";
const base = {
  schemaVersion: 1 as const, platform: "pwa" as const, deviceId: "device-a", sequence: 1,
  runId: "run-a", phase: "catalog-save" as const, syncing: true, online: true, serverReachable: true,
  lastAttemptAt: now, startedAt: now, progressAt: now, lastServerContactAt: now,
  lastCatalogSyncAt: null, lastTransactionSyncAt: null, lastSuccessAt: null,
  catalogReceived: 250, catalogCommitted: 250, catalogPages: 1, transactionsConfirmed: 0,
  auditsConfirmed: 0, outboxPending: 1, outboxFailed: 0, auditPending: 0, auditFailed: 0,
  retryAt: null, error: null,
};

test("accepted reports have server-received time and preserve peripheral health", () => {
  const result = mergeSyncHeartbeat({ printer: "online" }, undefined, base, now);
  assert.equal(result.printer, "online");
  assert.equal((result.sync as typeof base & { receivedAt: string }).receivedAt, now);
  assert.equal((result.sync as typeof base).catalogCommitted, 250);
});

test("delayed reports cannot overwrite later phases or queue counts", () => {
  const earlier = mergeSyncHeartbeat({}, undefined, base, now);
  const later = mergeSyncHeartbeat(earlier, undefined, {
    ...base, sequence: 3, phase: "complete", syncing: false, outboxPending: 0,
  }, "2026-10-01T08:31:00.000Z");
  const reordered = mergeSyncHeartbeat(later, { printer: "offline" }, {
    ...base, sequence: 2, phase: "failed", outboxPending: 10,
  }, "2026-10-01T08:32:00.000Z");
  assert.equal((reordered.sync as typeof base).phase, "complete");
  assert.equal((reordered.sync as typeof base).outboxPending, 0);
  assert.equal(reordered.printer, "offline");
});

test("devices are isolated by installation identity, summaries remain stale at their original receipt time", () => {
  const first = mergeSyncHeartbeat({}, undefined, base, now);
  const second = mergeSyncHeartbeat(first, undefined, { ...base, deviceId: "device-b" }, "2026-10-01T08:32:00.000Z");
  const devices = deviceReportsFromTerminals([{ id: "terminal-a", name: "Main", peripheralStatus: second }]);
  assert.equal(devices.length, 2);
  const merged = mergeDeploymentDeviceReports([], devices);
  assert.equal(merged.length, 2);
  const replay = mergeDeploymentDeviceReports(merged, [{
    ...devices[0], receivedAt: "2026-10-01T08:42:00.000Z",
  }]);
  assert.deepEqual(replay, merged);
});

test("untrusted error details are redacted; malformed or inflated acknowledgements fail", () => {
  const value = parseSyncTelemetry({ ...base, error: "Bearer fake-secret; customer John" });
  assert.ok(value.error && !value.error.includes("fake-secret"));
  assert.throws(() => parseSyncTelemetry({ ...base, sequence: 0 }));
  assert.throws(() => parseSyncTelemetry({ ...base, catalogCommitted: 251 }));
  assert.throws(() => parseSyncTelemetry({ ...base, transactionsConfirmed: -1 }));
  assert.throws(() => parseSyncTelemetry({ ...base, lastSuccessAt: "not-a-date" }));
});

test("terminal SCO acknowledgement survives a sync-only heartbeat", () => {
  const next = mergeSyncHeartbeat({ sco_override_acknowledged: true, sco_mode: "scanning" }, undefined, base, now);
  assert.equal(next.sco_override_acknowledged, true);
});