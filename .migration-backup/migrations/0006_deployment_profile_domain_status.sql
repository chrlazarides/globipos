ALTER TABLE "deployment_profiles"
  ADD COLUMN IF NOT EXISTS "domain_status" text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "domain_message" text,
  ADD COLUMN IF NOT EXISTS "domain_checks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "domain_checked_at" timestamp;