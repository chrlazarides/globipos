import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "./db";
import { createCustomerAiHealthPersistenceForClient } from "./customer-ai-health-persistence";

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
    await persistence.recordFallback("recommendation", "authentication");

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