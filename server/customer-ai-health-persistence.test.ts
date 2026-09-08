import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pool } from "./db";
import { createCustomerAiHealthPersistenceForClient } from "./customer-ai-health-persistence";

const customerAiHealthMigration = readFileSync(
  new URL("../migrations/0013_customer_ai_health.sql", import.meta.url),
  "utf8",
);

test("fallback counters saturate without blocking later category and timestamp updates", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE customer_ai_health (
        scope text PRIMARY KEY,
        fallback_count integer NOT NULL,
        recommendation_fallback_count integer NOT NULL,
        feedback_fallback_count integer NOT NULL,
        consecutive_fallback_count integer NOT NULL,
        failure_revision integer NOT NULL DEFAULT 0,
        last_failure_category text,
        last_failure_at timestamp,
        updated_at timestamp NOT NULL DEFAULT now()
      ) ON COMMIT DROP
    `);
    await client.query(`
      INSERT INTO customer_ai_health (
        scope, fallback_count, recommendation_fallback_count,
        feedback_fallback_count, consecutive_fallback_count,
        last_failure_category, last_failure_at
      ) VALUES (
        'global', 2147483647, 2147483647, 2147483647, 2147483647,
        'provider', '2026-09-08T09:00:00Z'
      )
    `);

    const persistence = createCustomerAiHealthPersistenceForClient(client);
    await persistence.recordFallback("recommendation", "authentication", new Date());

    const result = await client.query(`
      SELECT fallback_count, recommendation_fallback_count,
        feedback_fallback_count, consecutive_fallback_count,
        last_failure_category, last_failure_at
      FROM customer_ai_health WHERE scope = 'global'
    `);
    const row = result.rows[0];
    assert.equal(row.fallback_count, 2147483647);
    assert.equal(row.recommendation_fallback_count, 2147483647);
    assert.equal(row.feedback_fallback_count, 2147483647);
    assert.equal(row.consecutive_fallback_count, 2147483647);
    assert.equal(row.last_failure_category, "authentication");
    assert.ok(new Date(row.last_failure_at).getTime() > Date.parse("2026-09-08T09:00:00Z"));
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});

test("concurrent fallback records preserve exact totals and success ordering", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE customer_ai_health (
        scope text PRIMARY KEY,
        fallback_count integer NOT NULL DEFAULT 0,
        recommendation_fallback_count integer NOT NULL DEFAULT 0,
        feedback_fallback_count integer NOT NULL DEFAULT 0,
        consecutive_fallback_count integer NOT NULL DEFAULT 0,
        failure_revision integer NOT NULL DEFAULT 0,
        last_failure_category text,
        last_failure_at timestamp,
        updated_at timestamp NOT NULL DEFAULT now()
      ) ON COMMIT DROP
    `);
    const persistence = createCustomerAiHealthPersistenceForClient(client);
    await Promise.all(Array.from({ length: 24 }, (_, index) => persistence.recordFallback(
      index % 3 === 0 ? "feedback" : "recommendation",
      index % 2 === 0 ? "timeout" : "provider",
      new Date(1_789_000_000_000 + index),
    )));
    const loaded = await persistence.load() as any;
    assert.equal(loaded.fallbackCount, 24);
    assert.equal(loaded.recommendationFallbackCount, 16);
    assert.equal(loaded.feedbackFallbackCount, 8);
    assert.equal(loaded.consecutiveFallbackCount, 24);
    assert.equal(loaded.failureRevision, 24);

    await persistence.recordFallback("feedback", "rate_limit", new Date(1_789_000_000_100));
    await persistence.recordSuccess(loaded.failureRevision);
    const afterStaleSuccess = await persistence.load() as any;
    assert.equal(afterStaleSuccess.fallbackCount, 25);
    assert.equal(afterStaleSuccess.consecutiveFallbackCount, 25);

    await persistence.recordFallback("recommendation", "authentication", new Date(1_789_000_000_050));
    const afterOlderFailure = await persistence.load() as any;
    assert.equal(afterOlderFailure.lastFailureAt, new Date(1_789_000_000_100).toISOString());
    assert.equal(afterOlderFailure.lastFailureCategory, "rate_limit");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});

test("legacy local health is migrated without losing restart history", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE customer_ai_health (
        scope text PRIMARY KEY DEFAULT 'local',
        fallback_count integer NOT NULL DEFAULT 0,
        recommendation_fallback_count integer NOT NULL DEFAULT 0,
        feedback_fallback_count integer NOT NULL DEFAULT 0,
        consecutive_fallback_count integer NOT NULL DEFAULT 0,
        last_failure_category text,
        last_failure_at timestamp,
        updated_at timestamp NOT NULL DEFAULT now()
      ) ON COMMIT DROP
    `);
    await client.query(`
      INSERT INTO customer_ai_health (
        scope, fallback_count, recommendation_fallback_count,
        feedback_fallback_count, consecutive_fallback_count,
        last_failure_category, last_failure_at, updated_at
      ) VALUES (
        'local', 9, 6, 3, 4, 'timeout',
        '2026-09-08T09:00:00Z', '2026-09-08T09:00:01Z'
      )
    `);

    await client.query(customerAiHealthMigration);
    await client.query(customerAiHealthMigration);

    const persistence = createCustomerAiHealthPersistenceForClient(client);
    const migrated = await persistence.load() as any;
    assert.equal(migrated.fallbackCount, 9);
    assert.equal(migrated.recommendationFallbackCount, 6);
    assert.equal(migrated.feedbackFallbackCount, 3);
    assert.equal(migrated.consecutiveFallbackCount, 4);
    assert.equal(migrated.failureRevision, 0);
    assert.equal(migrated.lastFailureCategory, "timeout");
    assert.equal(migrated.lastFailureAt, "2026-09-08T09:00:00.000Z");

    const rows = await client.query("SELECT scope FROM customer_ai_health");
    assert.deepEqual(rows.rows, [{ scope: "global" }]);

    await persistence.recordFallback("feedback", "provider", new Date("2026-09-08T10:00:00Z"));
    const updated = await persistence.load() as any;
    assert.equal(updated.fallbackCount, 10);
    assert.equal(updated.feedbackFallbackCount, 4);
    assert.equal(updated.consecutiveFallbackCount, 5);
    assert.equal(updated.failureRevision, 1);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});