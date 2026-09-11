ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "item_type" text NOT NULL DEFAULT 'general';
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "shelf_label_uom_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "shelf_label_quantity" numeric(12,3);
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "shelf_label_unit" text;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "garment_gender" text;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "garment_material" text;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "garment_style" text;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "garment_care" text;

ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_item_type_check";
ALTER TABLE "items" ADD CONSTRAINT "items_item_type_check"
  CHECK ("item_type" IN ('general', 'garment'));
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_shelf_label_unit_check";
ALTER TABLE "items" ADD CONSTRAINT "items_shelf_label_unit_check"
  CHECK ("shelf_label_unit" IS NULL OR "shelf_label_unit" IN ('g', 'kg', 'ml', 'L', 'pc', 'm', 'm2', 'm3'));
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_shelf_label_uom_config_check";
ALTER TABLE "items" ADD CONSTRAINT "items_shelf_label_uom_config_check"
  CHECK (
    "shelf_label_uom_enabled" = false OR (
      "item_type" = 'general' AND
      "shelf_label_quantity" IS NOT NULL AND
      "shelf_label_quantity" > 0 AND
      "shelf_label_unit" IS NOT NULL
    )
  );