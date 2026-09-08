CREATE TABLE IF NOT EXISTS "customer_ai_health" (
  "scope" text PRIMARY KEY DEFAULT 'global',
  "fallback_count" integer NOT NULL DEFAULT 0,
  "recommendation_fallback_count" integer NOT NULL DEFAULT 0,
  "feedback_fallback_count" integer NOT NULL DEFAULT 0,
  "consecutive_fallback_count" integer NOT NULL DEFAULT 0,
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
  )
);