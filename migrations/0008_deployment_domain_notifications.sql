ALTER TABLE "deployment_profiles"
  ADD COLUMN IF NOT EXISTS "domain_notification_pending" text,
  ADD COLUMN IF NOT EXISTS "domain_notification_message" text,
  ADD COLUMN IF NOT EXISTS "domain_notification_created_at" timestamp;