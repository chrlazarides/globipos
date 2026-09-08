import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { loadActiveOperatorAlertFailures } from "./deployment-control";
import {
  databaseAlertClaimer,
  databaseAlertResolver,
  databaseFailureRecorder,
  type CustomerAiPersistenceAlert,
} from "./operator-alerting";
import { operatorAlertFailures } from "@shared/schema";

const testId = crypto.randomUUID();
const alert = {
  event: "customer_ai_health_persistence_failed",
  operation: `database-lease-test-${testId}`,
} as unknown as CustomerAiPersistenceAlert;
const key = `${alert.event}:${alert.operation}`;
const statuses = ["pending", "delivering", "failed", "resolved", "unexpected"] as const;
const statusEvent = `operator_alert_status_test_${testId}`;
const statusKeys = statuses.map((_, index) => `${statusEvent}:${index}`);
const fixtureKeys = [key, ...statusKeys];

test("database alert claims serialize delivery and preserve the durable lifecycle", async t => {
  t.after(async () => {
    try {
      await pool.query(
        "DELETE FROM operator_alert_failures WHERE alert_key = ANY($1::text[])",
        [fixtureKeys],
      );
    } catch (error: any) {
      if (error?.code !== "42P01") throw error;
    } finally {
      await pool.end();
    }
  });

  const migration = readFileSync(
    new URL("../migrations/0014_operator_alert_failures.sql", import.meta.url),
    "utf8",
  );
  await pool.query(migration);

  const claims = await Promise.all([
    databaseAlertClaimer(alert),
    databaseAlertClaimer(alert),
  ]);
  const tokens = claims.filter((token): token is string => token !== null);
  assert.equal(tokens.length, 1, "only one overlapping worker should receive the lease");

  let [record] = await db.select().from(operatorAlertFailures)
    .where(eq(operatorAlertFailures.alertKey, key));
  assert.equal(record.occurrenceCount, 2);
  assert.equal(record.status, "delivering");
  assert.equal(record.claimToken, tokens[0]);

  await databaseFailureRecorder(
    alert,
    { success: false, reason: "email_delivery_failed", error: "provider unavailable" },
    3,
    tokens[0],
  );
  assert.equal(await databaseAlertClaimer(alert), null, "cooldown should suppress an immediate retry");

  const staleClaimedAt = new Date(Date.now() - 3 * 60_000);
  await db.update(operatorAlertFailures).set({
    status: "delivering",
    claimedAt: staleClaimedAt,
    claimToken: "abandoned-worker",
    nextAttemptAt: new Date(Date.now() - 1_000),
  }).where(eq(operatorAlertFailures.alertKey, key));

  const recoveredToken = await databaseAlertClaimer(alert);
  assert.ok(recoveredToken, "a stale lease should be recoverable");
  assert.notEqual(recoveredToken, "abandoned-worker");

  await databaseAlertResolver(alert, recoveredToken);
  [record] = await db.select().from(operatorAlertFailures)
    .where(eq(operatorAlertFailures.alertKey, key));
  assert.equal(record.status, "resolved");
  assert.ok(record.resolvedAt);
  assert.equal(record.claimToken, null);
  assert.equal(record.claimedAt, null);
  assert.equal(record.nextAttemptAt, null);

  await db.insert(operatorAlertFailures).values(statuses.map((status, index) => ({
    alertKey: statusKeys[index],
    event: statusEvent,
    operation: String(index),
    reason: `Status ${status}`,
    deliveryAttempts: 0,
    status,
    resolvedAt: status === "resolved" ? new Date() : null,
  })));

  const active = await loadActiveOperatorAlertFailures();
  const testStatuses = active
    .filter(row => row.event === statusEvent)
    .map(row => row.status)
    .sort();
  assert.deepEqual(testStatuses, ["delivering", "failed", "pending"]);
});