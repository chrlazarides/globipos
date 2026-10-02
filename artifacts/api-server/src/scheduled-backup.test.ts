import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { handleDatabasePoolErrors } from "./lib/database-pool-errors";
import {
  createScheduledBackupRunner,
  isTransientBackupDatabaseError,
  retryBackupDatabaseOperation,
} from "./scheduled-backup";

const disconnected = () => new Error("Failed query", {
  cause: Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" }),
});

test("idle pool errors are handled without crashing or logging the client and its credentials", () => {
  const pool = new EventEmitter();
  const reports: object[] = [];
  handleDatabasePoolErrors(pool, (fields) => { reports.push(fields); });
  const error = Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });
  assert.doesNotThrow(() => pool.emit("error", error, { password: "must-not-be-logged" }));
  assert.deepEqual(reports, [{ code: "57P01", message: error.message }]);
  assert.equal(pool.listenerCount("error"), 1);
});

function fixture(settings: Record<string, string> = {}) {
  const values: Record<string, string> = {
    backup_auto: "true", backup_email: "backup@example.invalid", company_name: "Test Company",
    ...settings,
  };
  const calls = { generated: [] as (string | undefined)[], sent: [] as unknown[][], saved: [] as string[], errors: [] as string[], warnings: 0 };
  const deps = {
    getSetting: async (key: string) => values[key] === undefined ? undefined : { value: values[key] },
    generateBackupJson: async (since?: string) => { calls.generated.push(since); return '{"data":{"invoices":[]}}'; },
    sendBackupEmail: async (...args: unknown[]) => { calls.sent.push(args); return { success: true }; },
    setLastBackupDate: async (date: string) => { calls.saved.push(date); values.backup_last_date = date; },
    now: () => new Date("2026-10-02T10:00:00Z"),
    retryOptions: { wait: async () => {} },
    logger: {
      warn: () => { calls.warnings++; },
      error: (_fields: object, message: string) => { calls.errors.push(message); },
      info: () => {},
    },
  };
  return { deps, calls };
}

test("recognizes wrapped PostgreSQL interruptions, network errors and cyclic causes", () => {
  assert.equal(isTransientBackupDatabaseError(disconnected()), true);
  assert.equal(isTransientBackupDatabaseError({ cause: { code: "ECONNRESET" } }), true);
  assert.equal(isTransientBackupDatabaseError(new Error("Connection terminated unexpectedly")), true);
  assert.equal(isTransientBackupDatabaseError({ cause: { code: "08006" } }), true);
  for (const code of ["42P01", "42703", "28P01", "42501"]) {
    assert.equal(isTransientBackupDatabaseError({ code, message: "Permanent database error" }), false);
  }
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  assert.equal(isTransientBackupDatabaseError(cycle), false);
});

test("retries transient failures with bounded backoff and returns recovered result", async () => {
  let attempts = 0;
  const waits: number[] = [];
  assert.equal(await retryBackupDatabaseOperation(async () => {
    if (++attempts < 3) throw disconnected();
    return "complete";
  }, { wait: async (ms) => { waits.push(ms); } }), "complete");
  assert.deepEqual(waits, [2_000, 10_000]);
});

test("exhausted and permanent failures are not retried indefinitely", async () => {
  for (const [error, expected] of [[disconnected(), 3], [new Error("Invalid backup"), 1]] as const) {
    let attempts = 0;
    await assert.rejects(() => retryBackupDatabaseOperation(async () => {
      attempts++;
      throw error;
    }, { wait: async () => {} }), (actual) => actual === error);
    assert.equal(attempts, expected);
  }
});

test("an interrupted export is regenerated before one email and one timestamp update", async () => {
  const { deps, calls } = fixture();
  let attempts = 0;
  const generate = deps.generateBackupJson;
  deps.generateBackupJson = async (since) => {
    if (++attempts === 1) throw disconnected();
    return generate(since);
  };
  await createScheduledBackupRunner(deps)();
  assert.equal(attempts, 2);
  assert.equal(calls.warnings, 1);
  assert.equal(calls.sent.length, 1);
  assert.deepEqual(calls.saved, ["2026-10-02T10:00:00.000Z"]);
  assert.deepEqual(calls.errors, []);
});

test("settings reads recover and unrecoverable export failures never send or advance the date", async () => {
  const { deps, calls } = fixture();
  let reads = 0;
  const getSetting = deps.getSetting;
  deps.getSetting = async (key) => {
    if (++reads === 1) throw disconnected();
    return getSetting(key);
  };
  deps.generateBackupJson = async () => { throw disconnected(); };
  await createScheduledBackupRunner(deps)();
  assert.equal(calls.warnings, 2);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.saved.length, 0);
  assert.deepEqual(calls.errors, ["Scheduled backup error"]);
});

test("timestamp recovery after email delivery does not resend the email", async () => {
  const { deps, calls } = fixture();
  let writes = 0;
  const save = deps.setLastBackupDate;
  deps.setLastBackupDate = async (date) => {
    if (++writes < 3) throw disconnected();
    return save(date);
  };
  const run = createScheduledBackupRunner(deps);
  await run();
  await run();
  assert.equal(writes, 3);
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.saved.length, 1);
});

test("failed email or exhausted timestamp writes do not record a false successful backup", async () => {
  const failedEmail = fixture();
  failedEmail.deps.sendBackupEmail = async (...args) => {
    failedEmail.calls.sent.push(args);
    return { success: false };
  };
  await createScheduledBackupRunner(failedEmail.deps)();
  assert.equal(failedEmail.calls.sent.length, 1);
  assert.equal(failedEmail.calls.saved.length, 0);
  const failedSave = fixture();
  failedSave.deps.setLastBackupDate = async () => { throw disconnected(); };
  await createScheduledBackupRunner(failedSave.deps)();
  assert.equal(failedSave.calls.sent.length, 1);
  assert.equal(failedSave.calls.saved.length, 0);
  assert.match(failedSave.calls.errors[0], /email sent but last backup date could not be saved/);
});

test("honours disabled, recent and unconfigured backups and labels differential emails correctly", async () => {
  for (const settings of [
    { backup_auto: "false" }, { backup_email: "" }, { backup_last_date: "2026-10-02T09:00:00Z" },
  ]) {
    const { deps, calls } = fixture(settings);
    await createScheduledBackupRunner(deps)();
    assert.equal(calls.sent.length, 0);
    assert.equal(calls.generated.length, 0);
  }
  for (const [lastDate, since] of [
    ["2026-09-30T10:00:00Z", "2026-09-30T10:00:00.000Z"],
    ["2026-09-01T10:00:00Z", undefined],
    ["invalid", undefined],
  ] as const) {
    const { deps, calls } = fixture({ backup_last_date: lastDate });
    await createScheduledBackupRunner(deps)();
    assert.deepEqual(calls.generated, [since]);
    assert.equal(calls.sent[0][4], since ? "differential" : "full");
    assert.equal(calls.sent[0][5], since ?? null);
  }
});

test("overlapping scheduler ticks are skipped and a failed run releases the guard", async () => {
  const { deps, calls } = fixture();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const generate = deps.generateBackupJson;
  deps.generateBackupJson = async (since) => {
    await blocked;
    return generate(since);
  };
  const run = createScheduledBackupRunner(deps);
  const first = run();
  await run();
  release();
  await first;
  assert.equal(calls.sent.length, 1);

  const recovering = fixture();
  const prepare = recovering.deps.generateBackupJson;
  recovering.deps.generateBackupJson = async () => { throw new Error("Invalid backup"); };
  const recover = createScheduledBackupRunner(recovering.deps);
  await recover();
  recovering.deps.generateBackupJson = prepare;
  await recover();
  assert.equal(recovering.calls.sent.length, 1);
});