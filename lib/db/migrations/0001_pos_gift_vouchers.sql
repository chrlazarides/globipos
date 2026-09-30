BEGIN;

ALTER TABLE pos_terminals
  ADD COLUMN IF NOT EXISTS price_level integer NOT NULL DEFAULT 1
  CHECK (price_level BETWEEN 1 AND 5);

CREATE TABLE IF NOT EXISTS pos_gift_vouchers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_hash varchar(64) NOT NULL UNIQUE,
  serial_suffix varchar(8) NOT NULL,
  original_amount_cents integer NOT NULL CHECK (original_amount_cents > 0),
  balance_cents integer NOT NULL CHECK (balance_cents >= 0 AND balance_cents <= original_amount_cents),
  currency varchar(3) NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'spent', 'void')),
  issued_reason text NOT NULL CHECK (issued_reason IN ('sale', 'return', 'residual')),
  terminal_id varchar NOT NULL REFERENCES pos_terminals(id) ON DELETE RESTRICT,
  location_id varchar NOT NULL REFERENCES pos_locations(id) ON DELETE RESTRICT,
  cashier_id varchar NOT NULL REFERENCES pos_cashiers(id) ON DELETE RESTRICT,
  source_order_id varchar REFERENCES pos_orders(id) ON DELETE SET NULL,
  source_return_order_id varchar REFERENCES pos_return_orders(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  spent_at timestamp
);

CREATE INDEX IF NOT EXISTS pos_gift_vouchers_status_location_idx
  ON pos_gift_vouchers(status, location_id);

CREATE TABLE IF NOT EXISTS pos_gift_voucher_operations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_id varchar NOT NULL REFERENCES pos_terminals(id) ON DELETE RESTRICT,
  idempotency_key varchar(128) NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('sale', 'return', 'redeem')),
  request_hash varchar(64) NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  response_ciphertext text,
  response_iv varchar(32),
  response_tag varchar(32),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT pos_gift_voucher_operations_terminal_key_uq UNIQUE (terminal_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS pos_gift_voucher_ledger (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id varchar NOT NULL REFERENCES pos_gift_vouchers(id) ON DELETE RESTRICT,
  operation_id varchar NOT NULL REFERENCES pos_gift_voucher_operations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('sale_issue', 'return_issue', 'redemption', 'serial_retirement', 'residual_issue')),
  amount_cents integer NOT NULL CHECK (amount_cents <> 0),
  balance_after_cents integer NOT NULL CHECK (balance_after_cents >= 0),
  related_order_id varchar REFERENCES pos_orders(id) ON DELETE SET NULL,
  related_return_order_id varchar REFERENCES pos_return_orders(id) ON DELETE SET NULL,
  terminal_id varchar NOT NULL REFERENCES pos_terminals(id) ON DELETE RESTRICT,
  cashier_id varchar NOT NULL REFERENCES pos_cashiers(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT pos_gift_voucher_ledger_event_uq UNIQUE (operation_id, voucher_id, event_type)
);

CREATE INDEX IF NOT EXISTS pos_gift_voucher_ledger_voucher_created_idx
  ON pos_gift_voucher_ledger(voucher_id, created_at);

CREATE TABLE IF NOT EXISTS pos_gift_voucher_auth_failures (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_id varchar NOT NULL REFERENCES pos_terminals(id) ON DELETE CASCADE,
  remote_key_hash varchar(64) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_gift_voucher_auth_failures_terminal_remote_created_idx
  ON pos_gift_voucher_auth_failures(terminal_id, remote_key_hash, created_at);

CREATE INDEX IF NOT EXISTS pos_gift_voucher_auth_failures_terminal_created_idx
  ON pos_gift_voucher_auth_failures(terminal_id, created_at);

COMMIT;