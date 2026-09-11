ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "shelf_label_discount_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "shelf_label_previous_price" numeric(10,2);
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "shelf_label_previous_price_verified_at" timestamp;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "shelf_label_previous_price_provenance" text;

ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_shelf_label_discount_check";
ALTER TABLE "items" ADD CONSTRAINT "items_shelf_label_discount_check"
  CHECK (
    "shelf_label_discount_enabled" = false OR (
      "shelf_label_previous_price" IS NOT NULL AND
      "shelf_label_previous_price" > "price_1" AND
      "shelf_label_previous_price_verified_at" IS NOT NULL AND
      "shelf_label_previous_price_provenance" IN ('recorded_30_day_low', 'staff_attested_legacy_period')
    )
  );

CREATE TABLE IF NOT EXISTS "item_shelf_price_history" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id" varchar NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "price" numeric(10,2) NOT NULL,
  "effective_at" timestamp NOT NULL DEFAULT now(),
  "source" text NOT NULL DEFAULT 'item_update',
  "recorded_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "item_shelf_price_history_item_effective_idx"
  ON "item_shelf_price_history" ("item_id", "effective_at");
INSERT INTO "item_shelf_price_history" ("item_id", "price", "effective_at", "source")
SELECT i."id", i."price_1", now(), 'migration_baseline'
FROM "items" i
WHERE NOT EXISTS (
  SELECT 1 FROM "item_shelf_price_history" h WHERE h."item_id" = i."id"
);

ALTER TABLE "agoranomia_label_prints" ADD COLUMN IF NOT EXISTS "printed_previous_price" numeric(10,2);
ALTER TABLE "agoranomia_label_prints" ADD COLUMN IF NOT EXISTS "printed_previous_unit_price" numeric(10,2);
ALTER TABLE "agoranomia_label_prints" ADD COLUMN IF NOT EXISTS "discount_percentage" numeric(5,2);
ALTER TABLE "agoranomia_label_prints" ADD COLUMN IF NOT EXISTS "discount_verified_at" timestamp;
ALTER TABLE "agoranomia_label_prints" ADD COLUMN IF NOT EXISTS "discount_provenance" text;
ALTER TABLE "agoranomia_label_prints" DROP CONSTRAINT IF EXISTS "agoranomia_label_prints_discount_provenance_check";
ALTER TABLE "agoranomia_label_prints" ADD CONSTRAINT "agoranomia_label_prints_discount_provenance_check"
  CHECK (
    "printed_previous_price" IS NULL OR
    "discount_provenance" IN ('recorded_30_day_low', 'staff_attested_legacy_period')
  );
ALTER TABLE "agoranomia_label_prints" DROP CONSTRAINT IF EXISTS "agoranomia_label_prints_item_id_unique";
DROP INDEX IF EXISTS "agoranomia_label_prints_item_id_unique";
CREATE INDEX IF NOT EXISTS "agoranomia_label_prints_item_printed_idx"
  ON "agoranomia_label_prints" ("item_id", "printed_at" DESC);