CREATE TABLE IF NOT EXISTS product_families (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamp
);

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS family_id varchar REFERENCES product_families(id) ON DELETE SET NULL;

INSERT INTO product_families (id, code, name) VALUES
  ('swiftpos-family-0', '0', 'ALL'),
  ('swiftpos-family-1', '1', 'Labels'),
  ('swiftpos-family-2', '2', 'FRUITS/VEGGIE'),
  ('swiftpos-family-3', '3', 'Azax refil 500ml 1+1'),
  ('swiftpos-family-4', '4', 'Garden napkins 1+1'),
  ('swiftpos-family-5', '5', 'Dettol wipes 25% Off'),
  ('swiftpos-family-6', '6', 'Azax trigger 750ml 1+1'),
  ('swiftpos-family-7', '7', 'Points redemption'),
  ('swiftpos-family-8', '8', 'JAFFA MINI'),
  ('swiftpos-family-9', '9', 'VAT 0')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;