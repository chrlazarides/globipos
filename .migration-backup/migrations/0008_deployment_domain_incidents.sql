CREATE TABLE IF NOT EXISTS deployment_domain_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES deployment_profiles(id) ON DELETE CASCADE,
  started_at timestamp NOT NULL,
  recovered_at timestamp,
  reason text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS deployment_domain_incidents_one_open
  ON deployment_domain_incidents (deployment_id)
  WHERE recovered_at IS NULL;

CREATE INDEX IF NOT EXISTS deployment_domain_incidents_recent
  ON deployment_domain_incidents (deployment_id, started_at DESC);

INSERT INTO deployment_domain_incidents (deployment_id, started_at, reason)
SELECT id, COALESCE(domain_failure_started_at, domain_checked_at, now()), COALESCE(domain_message, 'Domain check failed')
FROM deployment_profiles
WHERE domain_status = 'failed'
ON CONFLICT (deployment_id) WHERE recovered_at IS NULL DO NOTHING;