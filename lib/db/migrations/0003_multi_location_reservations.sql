BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS inventory_location_id varchar
  REFERENCES pos_locations(id) ON DELETE SET NULL;

ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS inventory_committed boolean NOT NULL DEFAULT false;

ALTER TABLE stock_transfer_items
  ADD COLUMN IF NOT EXISTS variant_id varchar
  REFERENCES item_variants(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id varchar NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_id varchar REFERENCES item_variants(id) ON DELETE CASCADE,
  source_location_id varchar NOT NULL REFERENCES pos_locations(id) ON DELETE RESTRICT,
  destination_location_id varchar NOT NULL REFERENCES pos_locations(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  customer_name text NOT NULL,
  requested_by_cashier_id varchar REFERENCES pos_cashiers(id) ON DELETE SET NULL,
  transfer_id varchar REFERENCES stock_transfers(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'transfer'
    CHECK (source_type IN ('transfer', 'portal_order', 'reorder', 'pos_order')),
  source_id varchar,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'transferred', 'fulfilled', 'cancelled')),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_reservations_stock_lookup_idx
  ON inventory_reservations(item_id, variant_id, source_location_id, status);
CREATE INDEX IF NOT EXISTS inventory_reservations_source_idx
  ON inventory_reservations(source_type, source_id, status);

COMMIT;