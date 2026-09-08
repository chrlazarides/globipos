CREATE TABLE IF NOT EXISTS "customer_ai_health" (
  "scope" text PRIMARY KEY DEFAULT 'local',
  "fallback_count" integer NOT NULL DEFAULT 0,
  "recommendation_fallback_count" integer NOT NULL DEFAULT 0,
  "feedback_fallback_count" integer NOT NULL DEFAULT 0,
  "consecutive_fallback_count" integer NOT NULL DEFAULT 0,
  "last_failure_category" text,
  "last_failure_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);