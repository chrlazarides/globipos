ALTER TABLE items
  ADD COLUMN IF NOT EXISTS image_thumbnail_url text,
  ADD COLUMN IF NOT EXISTS image_card_url text,
  ADD COLUMN IF NOT EXISTS image_full_url text,
  ADD COLUMN IF NOT EXISTS image_version text;

CREATE TABLE IF NOT EXISTS item_image_objects (
  object_name text PRIMARY KEY,
  content_type text NOT NULL DEFAULT 'image/webp',
  bytes bytea NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);