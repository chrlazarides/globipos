ALTER TABLE "deployment_profiles"
  ADD COLUMN IF NOT EXISTS "domain_failure_started_at" timestamp,
  ADD COLUMN IF NOT EXISTS "domain_failure_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "domain_check_claimed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "domain_check_claim_token" text;