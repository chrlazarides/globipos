-- Safe widening conversion: every existing integer value is represented exactly.
ALTER TABLE "portal_order_items"
  ALTER COLUMN "quantity" TYPE numeric(12,3)
  USING "quantity"::numeric(12,3);