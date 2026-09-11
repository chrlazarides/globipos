CREATE TABLE IF NOT EXISTS "operator_alert_failures" (
  "alert_key" text PRIMARY KEY,
  "event" text NOT NULL,
  "operation" text NOT NULL,
  "reason" text NOT NULL,
  "occurrence_count" integer NOT NULL DEFAULT 1,
  "delivery_attempts" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "claimed_at" timestamp,
  "claim_token" text,
  "next_attempt_at" timestamp,
  "first_failed_at" timestamp NOT NULL DEFAULT now(),
  "last_failed_at" timestamp NOT NULL DEFAULT now(),
  "resolved_at" timestamp
);

ALTER TABLE "operator_alert_failures"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "claimed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "claim_token" text,
  ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp;

CREATE INDEX IF NOT EXISTS "operator_alert_failures_unresolved"
  ON "operator_alert_failures" ("last_failed_at" DESC)
  WHERE "resolved_at" IS NULL;