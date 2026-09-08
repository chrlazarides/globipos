-- This migration intentionally reconciles both notification schema generations.
-- Some environments may have journaled one of the former colliding 0008
-- migrations or the former 0009 delivery migration. Every statement is
-- idempotent so 0010 safely fills whichever columns are still missing.
ALTER TABLE "deployment_profiles"
  ADD COLUMN IF NOT EXISTS "domain_notification_pending" text,
  ADD COLUMN IF NOT EXISTS "domain_notification_message" text,
  ADD COLUMN IF NOT EXISTS "domain_notification_created_at" timestamp,
  ADD COLUMN IF NOT EXISTS "domain_notification_delivery_status" text,
  ADD COLUMN IF NOT EXISTS "domain_notification_delivery_kind" text,
  ADD COLUMN IF NOT EXISTS "domain_notification_delivery_message" text,
  ADD COLUMN IF NOT EXISTS "domain_notification_delivery_attempted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "domain_notification_delivery_history" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "portal_orders"
  ADD COLUMN IF NOT EXISTS "checkout_key" varchar;

CREATE UNIQUE INDEX IF NOT EXISTS "portal_orders_customer_checkout_key_unique"
  ON "portal_orders" ("customer_id", "checkout_key")
  WHERE "checkout_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "customer_loyalty_points_source_unique"
  ON "customer_loyalty_points" ("source_type", "source_id")
  WHERE "source_type" IS NOT NULL AND "source_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "deployment_domain_incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "deployment_id" uuid NOT NULL REFERENCES "deployment_profiles"("id") ON DELETE CASCADE,
  "started_at" timestamp NOT NULL,
  "recovered_at" timestamp,
  "reason" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "deployment_domain_incidents_one_open"
  ON "deployment_domain_incidents" ("deployment_id")
  WHERE "recovered_at" IS NULL;

CREATE INDEX IF NOT EXISTS "deployment_domain_incidents_recent"
  ON "deployment_domain_incidents" ("deployment_id", "started_at" DESC);

INSERT INTO "deployment_domain_incidents" ("deployment_id", "started_at", "reason")
SELECT "id", COALESCE("domain_failure_started_at", "domain_checked_at", now()), COALESCE("domain_message", 'Domain check failed')
FROM "deployment_profiles"
WHERE "domain_status" = 'failed'
ON CONFLICT ("deployment_id") WHERE "recovered_at" IS NULL DO NOTHING;