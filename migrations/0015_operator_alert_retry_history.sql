ALTER TABLE operator_alert_failures
  ADD COLUMN IF NOT EXISTS retry_history jsonb NOT NULL DEFAULT '[]'::jsonb;