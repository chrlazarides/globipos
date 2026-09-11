DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM customer_loyalty_points
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL
    GROUP BY source_type, source_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create customer_loyalty_points_source_unique: duplicate source pairs exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "customer_loyalty_points_source_unique"
  ON "customer_loyalty_points" ("source_type", "source_id")
  WHERE "source_type" IS NOT NULL AND "source_id" IS NOT NULL;