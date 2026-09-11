CREATE TABLE IF NOT EXISTS "customer_ai_health" (
  "scope" text PRIMARY KEY DEFAULT 'global',
  "fallback_count" integer NOT NULL DEFAULT 0,
  "recommendation_fallback_count" integer NOT NULL DEFAULT 0,
  "feedback_fallback_count" integer NOT NULL DEFAULT 0,
  "consecutive_fallback_count" integer NOT NULL DEFAULT 0,
  "failure_revision" integer NOT NULL DEFAULT 0,
  "last_failure_category" text,
  "last_failure_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "customer_ai_health_scope_check" CHECK ("scope" = 'global'),
  CONSTRAINT "customer_ai_health_category_check" CHECK (
    "last_failure_category" IS NULL OR "last_failure_category" IN
      ('configuration', 'authentication', 'rate_limit', 'timeout', 'model', 'invalid_response', 'provider')
  ),
  CONSTRAINT "customer_ai_health_counts_check" CHECK (
    "fallback_count" >= 0 AND "recommendation_fallback_count" >= 0
    AND "feedback_fallback_count" >= 0 AND "consecutive_fallback_count" >= 0
    AND "failure_revision" >= 0
  )
);

ALTER TABLE "customer_ai_health"
  ADD COLUMN IF NOT EXISTS "failure_revision" integer NOT NULL DEFAULT 0;

ALTER TABLE "customer_ai_health"
  ALTER COLUMN "scope" SET DEFAULT 'global';

INSERT INTO "customer_ai_health" (
  "scope", "fallback_count", "recommendation_fallback_count",
  "feedback_fallback_count", "consecutive_fallback_count", "failure_revision",
  "last_failure_category", "last_failure_at", "updated_at"
)
SELECT
  'global', "fallback_count", "recommendation_fallback_count",
  "feedback_fallback_count", "consecutive_fallback_count", "failure_revision",
  "last_failure_category", "last_failure_at", "updated_at"
FROM "customer_ai_health"
WHERE "scope" = 'local'
ON CONFLICT ("scope") DO UPDATE SET
  "fallback_count" = LEAST(2147483647::bigint, "customer_ai_health"."fallback_count"::bigint + EXCLUDED."fallback_count")::integer,
  "recommendation_fallback_count" = LEAST(2147483647::bigint, "customer_ai_health"."recommendation_fallback_count"::bigint + EXCLUDED."recommendation_fallback_count")::integer,
  "feedback_fallback_count" = LEAST(2147483647::bigint, "customer_ai_health"."feedback_fallback_count"::bigint + EXCLUDED."feedback_fallback_count")::integer,
  "consecutive_fallback_count" = LEAST(2147483647::bigint, "customer_ai_health"."consecutive_fallback_count"::bigint + EXCLUDED."consecutive_fallback_count")::integer,
  "failure_revision" = LEAST(2147483647::bigint, "customer_ai_health"."failure_revision"::bigint + EXCLUDED."failure_revision")::integer,
  "last_failure_category" = CASE
    WHEN "customer_ai_health"."last_failure_at" IS NULL
      OR EXCLUDED."last_failure_at" >= "customer_ai_health"."last_failure_at"
    THEN EXCLUDED."last_failure_category"
    ELSE "customer_ai_health"."last_failure_category"
  END,
  "last_failure_at" = GREATEST("customer_ai_health"."last_failure_at", EXCLUDED."last_failure_at"),
  "updated_at" = GREATEST("customer_ai_health"."updated_at", EXCLUDED."updated_at");

DELETE FROM "customer_ai_health" WHERE "scope" = 'local';