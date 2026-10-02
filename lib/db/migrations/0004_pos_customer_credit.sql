CREATE TABLE IF NOT EXISTS customer_credit_profiles (
  customer_id varchar PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'suspended')),
  updated_by varchar,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customer_credit_history (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  actor_id varchar NOT NULL,
  actor_name text NOT NULL,
  reason text NOT NULL,
  previous jsonb NOT NULL,
  next jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_credit_history_customer_idx ON customer_credit_history(customer_id, created_at);
CREATE TABLE IF NOT EXISTS pos_invoice_sales (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_id varchar NOT NULL REFERENCES pos_terminals(id),
  request_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  invoice_id varchar NOT NULL UNIQUE REFERENCES invoices(id),
  order_id varchar NOT NULL UNIQUE REFERENCES pos_orders(id),
  mode text NOT NULL CHECK (mode IN ('retail', 'wholesale')),
  created_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2);