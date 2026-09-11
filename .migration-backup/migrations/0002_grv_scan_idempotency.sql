CREATE TABLE IF NOT EXISTS "goods_received_voucher_scan_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "grv_id" varchar NOT NULL,
  "event_key" text NOT NULL,
  "line_id" varchar NOT NULL,
  "matched_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "goods_received_voucher_scan_events_grv_event_unique"
  ON "goods_received_voucher_scan_events" ("grv_id", "event_key");