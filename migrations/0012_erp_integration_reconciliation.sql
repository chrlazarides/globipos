-- Reconciles clean databases and deployments where colliding 0007/0008/0010
-- versions journaled the unrelated deployment migration instead of ERP DDL.
CREATE TABLE IF NOT EXISTS "erp_integration_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "scope" text NOT NULL DEFAULT 'local' UNIQUE,
  "provider" text NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "policies" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_tested_at" timestamp, "last_test_status" text, "last_sync_at" timestamp, "last_sync_status" text,
  "sync_locked_at" timestamp, "sync_lock_token" text, "generation" integer NOT NULL DEFAULT 1,
  "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
);
ALTER TABLE "erp_integration_configs" ADD COLUMN IF NOT EXISTS "sync_lock_token" text;
ALTER TABLE "erp_integration_configs" ADD COLUMN IF NOT EXISTS "generation" integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "erp_sync_audits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "config_id" uuid NOT NULL REFERENCES "erp_integration_configs"("id") ON DELETE CASCADE,
  "generation" integer NOT NULL DEFAULT 1, "idempotency_key" text NOT NULL, "record_type" text NOT NULL,
  "record_id" text NOT NULL, "direction" text NOT NULL, "status" text NOT NULL, "external_id" text,
  "error_code" text, "error_message" text, "attempt" integer NOT NULL DEFAULT 1, "created_at" timestamp NOT NULL DEFAULT now()
);
ALTER TABLE "erp_sync_audits" ADD COLUMN IF NOT EXISTS "generation" integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "erp_record_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "config_id" uuid NOT NULL REFERENCES "erp_integration_configs"("id") ON DELETE CASCADE,
  "generation" integer NOT NULL DEFAULT 1, "record_type" text NOT NULL, "local_id" text NOT NULL,
  "external_id" text NOT NULL, "source_version" text, "last_synced_at" timestamp NOT NULL DEFAULT now()
);
ALTER TABLE "erp_record_mappings" ADD COLUMN IF NOT EXISTS "generation" integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "erp_sync_cursors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "config_id" uuid NOT NULL REFERENCES "erp_integration_configs"("id") ON DELETE CASCADE,
  "generation" integer NOT NULL DEFAULT 1, "record_type" text NOT NULL, "cursor" text, "updated_at" timestamp NOT NULL DEFAULT now()
);
ALTER TABLE "erp_sync_cursors" ADD COLUMN IF NOT EXISTS "generation" integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "erp_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "config_id" uuid NOT NULL REFERENCES "erp_integration_configs"("id") ON DELETE CASCADE,
  "generation" integer NOT NULL DEFAULT 1, "initiated_by" varchar, "record_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'running', "succeeded" integer NOT NULL DEFAULT 0, "failed" integer NOT NULL DEFAULT 0,
  "skipped" integer NOT NULL DEFAULT 0, "failure_summary" text, "started_at" timestamp NOT NULL DEFAULT now(), "finished_at" timestamp
);
ALTER TABLE "erp_sync_runs" ADD COLUMN IF NOT EXISTS "generation" integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "erp_stock_reconciliations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "config_id" uuid NOT NULL REFERENCES "erp_integration_configs"("id") ON DELETE CASCADE,
  "generation" integer NOT NULL, "local_id" text NOT NULL, "cycle" integer NOT NULL,
  "target_quantity" integer NOT NULL, "observed_quantity" integer NOT NULL, "observed_revision" text NOT NULL,
  "correlation_key" text NOT NULL UNIQUE, "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp NOT NULL DEFAULT now(), "finished_at" timestamp
);

DROP INDEX IF EXISTS "erp_record_mappings_local";
DROP INDEX IF EXISTS "erp_record_mappings_external";
DROP INDEX IF EXISTS "erp_sync_cursors_unique";
DROP INDEX IF EXISTS "erp_stock_reconciliations_cycle";
CREATE UNIQUE INDEX "erp_record_mappings_local" ON "erp_record_mappings" ("config_id", "generation", "record_type", "local_id");
CREATE UNIQUE INDEX "erp_record_mappings_external" ON "erp_record_mappings" ("config_id", "generation", "record_type", "external_id");
CREATE UNIQUE INDEX "erp_sync_cursors_unique" ON "erp_sync_cursors" ("config_id", "generation", "record_type");
CREATE UNIQUE INDEX "erp_stock_reconciliations_cycle" ON "erp_stock_reconciliations" ("config_id", "generation", "local_id", "cycle");

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "erp_external_ref" text;
DROP INDEX IF EXISTS "invoices_erp_external_ref_unique";
CREATE UNIQUE INDEX "invoices_erp_external_ref_unique" ON "invoices" ("erp_external_ref");