CREATE TABLE IF NOT EXISTS "deployment_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" text NOT NULL UNIQUE,
  "client_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'active', 'suspended')),
  "back_office_url" text NOT NULL,
  "pos_server_url" text NOT NULL,
  "branding" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled_features" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "payment_provider" text NOT NULL DEFAULT 'none',
  "email_provider" text NOT NULL DEFAULT 'none',
  "whatsapp_provider" text NOT NULL DEFAULT 'none',
  "back_office_version" text NOT NULL DEFAULT 'unknown',
  "pos_version" text NOT NULL DEFAULT 'unknown',
  "target_back_office_version" text,
  "target_pos_version" text,
  "automation_provider" text NOT NULL DEFAULT 'manual' CHECK ("automation_provider" IN ('manual', 'github', 'replit')),
  "external_project_id" text,
  "credential_hash" text,
  "last_heartbeat_at" timestamp,
  "health_status" text NOT NULL DEFAULT 'unknown' CHECK ("health_status" IN ('unknown', 'healthy', 'warning', 'offline', 'error')),
  "health_message" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "deployment_rollouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "scope" text NOT NULL CHECK ("scope" IN ('all', 'selected')),
  "deployment_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "target_back_office_version" text,
  "target_pos_version" text,
  "status" text NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued', 'in_progress', 'completed', 'failed')),
  "initiated_by" varchar NOT NULL,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);