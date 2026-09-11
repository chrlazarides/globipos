import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { customerAiHealth } from "@shared/schema";
import { db } from "./db";
import type {
  CustomerAiFailureCategory,
  CustomerAiHealthPersistence,
} from "./customer-ai-service";

type CustomerAiHealthDatabase = Pick<typeof db, "insert" | "select">;

export function createCustomerAiHealthPersistence(
  database: CustomerAiHealthDatabase = db,
): CustomerAiHealthPersistence {
  return {
    async recordFallback(feature, category, occurredAt) {
      const recommendationIncrement = feature === "recommendation" ? 1 : 0;
      const feedbackIncrement = feature === "feedback" ? 1 : 0;
      await database.insert(customerAiHealth).values({
        scope: "global",
        fallbackCount: 1,
        recommendationFallbackCount: recommendationIncrement,
        feedbackFallbackCount: feedbackIncrement,
        consecutiveFallbackCount: 1,
        failureRevision: 1,
        lastFailureCategory: category,
        lastFailureAt: occurredAt,
      }).onConflictDoUpdate({
        target: customerAiHealth.scope,
        set: {
          fallbackCount: sql`LEAST(2147483647::bigint, ${customerAiHealth.fallbackCount}::bigint + 1)::integer`,
          recommendationFallbackCount: sql`LEAST(2147483647::bigint, ${customerAiHealth.recommendationFallbackCount}::bigint + ${recommendationIncrement})::integer`,
          feedbackFallbackCount: sql`LEAST(2147483647::bigint, ${customerAiHealth.feedbackFallbackCount}::bigint + ${feedbackIncrement})::integer`,
          consecutiveFallbackCount: sql`LEAST(2147483647::bigint, ${customerAiHealth.consecutiveFallbackCount}::bigint + 1)::integer`,
          failureRevision: sql`LEAST(2147483647::bigint, ${customerAiHealth.failureRevision}::bigint + 1)::integer`,
          lastFailureCategory: sql`CASE
            WHEN ${customerAiHealth.lastFailureAt} IS NULL OR ${occurredAt} >= ${customerAiHealth.lastFailureAt}
            THEN ${category}
            ELSE ${customerAiHealth.lastFailureCategory}
          END`,
          lastFailureAt: sql`GREATEST(COALESCE(${customerAiHealth.lastFailureAt}, ${occurredAt}), ${occurredAt})`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      }).returning().then(rows => rows[0]);
    },
    async recordSuccess(expectedFailureRevision) {
      return database.insert(customerAiHealth).values({
        scope: "global",
        consecutiveFallbackCount: 0,
        failureRevision: expectedFailureRevision,
      })
        .onConflictDoUpdate({
          target: customerAiHealth.scope,
          set: {
            consecutiveFallbackCount: sql`CASE
              WHEN ${customerAiHealth.failureRevision} = ${expectedFailureRevision}
              THEN 0
              ELSE ${customerAiHealth.consecutiveFallbackCount}
            END`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        }).returning().then(rows => rows[0]);
    },
    async load() {
      const [health] = await database.select().from(customerAiHealth).where(eq(customerAiHealth.scope, "global"));
      if (!health) return null;
      const allowedCategories = new Set<CustomerAiFailureCategory>([
        "configuration", "authentication", "rate_limit", "timeout", "model", "invalid_response", "provider",
      ]);
      return {
        fallbackCount: health.fallbackCount,
        recommendationFallbackCount: health.recommendationFallbackCount,
        feedbackFallbackCount: health.feedbackFallbackCount,
        consecutiveFallbackCount: health.consecutiveFallbackCount,
        failureRevision: health.failureRevision,
        lastFailureCategory: allowedCategories.has(health.lastFailureCategory as CustomerAiFailureCategory)
          ? health.lastFailureCategory as CustomerAiFailureCategory
          : null,
        lastFailureAt: health.lastFailureAt?.toISOString() || null,
      };
    },
  };
}

export function createCustomerAiHealthPersistenceForClient(client: PoolClient) {
  return createCustomerAiHealthPersistence(drizzle(client, { schema: { customerAiHealth } }) as CustomerAiHealthDatabase);
}