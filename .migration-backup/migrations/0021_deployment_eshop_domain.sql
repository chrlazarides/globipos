ALTER TABLE "deployment_profiles"
  ADD COLUMN IF NOT EXISTS "e_shop_domain" text,
  ADD COLUMN IF NOT EXISTS "e_shop_domain_status" text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "e_shop_domain_message" text,
  ADD COLUMN IF NOT EXISTS "e_shop_domain_check" jsonb,
  ADD COLUMN IF NOT EXISTS "e_shop_domain_checked_at" timestamp,
  ADD COLUMN IF NOT EXISTS "domain_notification_queue" jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE deployment_profiles
SET customer_domain = lower(customer_domain),
    pos_domain = lower(pos_domain),
    e_shop_domain = lower(e_shop_domain);

DO $$
DECLARE
  collision text;
BEGIN
  SELECT hostname INTO collision
  FROM (
    SELECT id, lower(customer_domain) AS hostname FROM deployment_profiles WHERE customer_domain IS NOT NULL
    UNION ALL
    SELECT id, lower(pos_domain) AS hostname FROM deployment_profiles WHERE pos_domain IS NOT NULL
    UNION ALL
    SELECT id, lower(e_shop_domain) AS hostname FROM deployment_profiles WHERE e_shop_domain IS NOT NULL
  ) assigned
  GROUP BY hostname
  HAVING count(DISTINCT id) > 1
  LIMIT 1;
  IF collision IS NOT NULL THEN
    RAISE EXCEPTION 'existing deployment hostname collision for %; resolve the conflicting profiles before retrying migration', collision;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "deployment_profiles_customer_domain_unique_ci"
  ON "deployment_profiles" (lower("customer_domain"))
  WHERE "customer_domain" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "deployment_profiles_pos_domain_unique_ci"
  ON "deployment_profiles" (lower("pos_domain"))
  WHERE "pos_domain" IS NOT NULL;

DROP INDEX IF EXISTS "deployment_profiles_e_shop_domain_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "deployment_profiles_e_shop_domain_unique_ci"
  ON "deployment_profiles" (lower("e_shop_domain"))
  WHERE "e_shop_domain" IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_deployment_hostname_collision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('deployment_hostname_assignment'));
  NEW.customer_domain := lower(NEW.customer_domain);
  NEW.pos_domain := lower(NEW.pos_domain);
  NEW.e_shop_domain := lower(NEW.e_shop_domain);
  FOREACH candidate IN ARRAY ARRAY[NEW.customer_domain, NEW.pos_domain, NEW.e_shop_domain]
  LOOP
    IF candidate IS NOT NULL AND EXISTS (
      SELECT 1
      FROM deployment_profiles existing
      WHERE existing.id IS DISTINCT FROM NEW.id
        AND lower(candidate) IN (lower(existing.customer_domain), lower(existing.pos_domain), lower(existing.e_shop_domain))
    ) THEN
      RAISE EXCEPTION 'deployment hostname % is already assigned', candidate
        USING ERRCODE = '23505';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deployment_profiles_hostname_collision ON deployment_profiles;
CREATE TRIGGER deployment_profiles_hostname_collision
BEFORE INSERT OR UPDATE OF customer_domain, pos_domain, e_shop_domain
ON deployment_profiles
FOR EACH ROW EXECUTE FUNCTION prevent_deployment_hostname_collision();

ALTER TABLE deployment_domain_incidents
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'main';

DROP INDEX IF EXISTS deployment_domain_incidents_one_open;
CREATE UNIQUE INDEX IF NOT EXISTS deployment_domain_incidents_one_open_per_role
  ON deployment_domain_incidents (deployment_id, role)
  WHERE recovered_at IS NULL;