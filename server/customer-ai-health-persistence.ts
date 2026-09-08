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
    async recordFallback(feature, category) {
      const recommendationIncrement = feature === "recommendation" ? 1 : 0;
      const feedbackIncrement = feature === "feedback" ? 1 : 0;
      await database.insert(customerAiHealth).values({
        scope: "global",
        fallbackCount: 1,
        recommendationFallbackCount: recommendationIncrement,
        feedbackFallbackCount: feedbackIncrement,
        consecutiveFallbackCount: 1,
        lastFailureCategory: category,
        lastFailureAt: new Date(),
      }).onConflictDoUpdate({
        target: customerAiHealth.scope,
        set: {
          fallbackCount: sql`LEAST(2147483647::bigint, ${customerAiHealth.fallbackCount}::bigint + 1)::integer`,
          recommendationFallbackCount: sql`LEAST(2147483647::bigint, ${customerAiHealth.recommendationFallbackCount}::bigint + ${recommendationIncrement})::integer`,
          feedbackFallbackCount: sql`LEAST(2147483647::bigint, ${customerAiHealth.feedbackFallbackCount}::bigint + ${feedbackIncrement})::integer`,
          consecutiveFallbackCount: sql`LEAST(2147483647::bigint, ${customerAiHealth.consecutiveFallbackCount}::bigint + 1)::integer`,
          lastFailureCategory: category,
          lastFailureAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
    },
    async recordSuccess() {
      await database.insert(customerAiHealth).values({ scope: "global", consecutiveFallbackCount: 0 })
        .onConflictDoUpdate({
          target: customerAiHealth.scope,
          set: { consecutiveFallbackCount: 0, updatedAt: sql`CURRENT_TIMESTAMP` },
        });
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