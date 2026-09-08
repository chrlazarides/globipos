ALTER TABLE "portal_orders"
  ADD COLUMN IF NOT EXISTS "checkout_key" VARCHAR;

CREATE UNIQUE INDEX IF NOT EXISTS "portal_orders_customer_checkout_key_unique"
  ON "portal_orders" ("customer_id", "checkout_key")
  WHERE "checkout_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "customer_loyalty_points_source_unique"
  ON "customer_loyalty_points" ("source_type", "source_id")
  WHERE "source_type" IS NOT NULL AND "source_id" IS NOT NULL;