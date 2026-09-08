ALTER TABLE "deployment_profiles"
  ADD COLUMN IF NOT EXISTS "customer_domain" text,
  ADD COLUMN IF NOT EXISTS "pos_domain" text;