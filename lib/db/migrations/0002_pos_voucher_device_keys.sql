BEGIN;

ALTER TABLE pos_terminals
  ADD COLUMN IF NOT EXISTS voucher_device_key_hash varchar(64);

COMMIT;