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