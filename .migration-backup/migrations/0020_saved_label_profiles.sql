CREATE TABLE IF NOT EXISTS label_profiles (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('barcode', 'shelf')),
  config jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  created_by varchar,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS label_profiles_one_default_per_kind
  ON label_profiles (kind)
  WHERE is_default = true;

ALTER TABLE agoranomia_label_prints
  ADD COLUMN IF NOT EXISTS label_profile_id varchar,
  ADD COLUMN IF NOT EXISTS profile_snapshot jsonb;

INSERT INTO label_profiles (name, kind, config, is_default, is_system)
VALUES
(
  'Standard Barcode',
  'barcode',
  '{
    "version":1,"mode":"thermal","thermalPresetId":"50x30","customW":50,"customH":30,
    "a4PresetId":"3x8","priceLevel":"1",
    "fields":{"showName":true,"showSku":false,"showPrice":true,"showBarcodeText":true,"showUnitPrice":false,"showGarmentDetails":true},
    "elements":[
      {"id":"name","type":"text","field":"name","x":4,"y":3,"w":92,"h":14,"fontSize":9,"fontWeight":700,"textAlign":"center","visible":true},
      {"id":"barcode","type":"barcode","field":"barcode","x":8,"y":19,"w":84,"h":45,"visible":true},
      {"id":"barcodeText","type":"text","field":"barcodeText","x":8,"y":65,"w":84,"h":10,"fontSize":7,"fontWeight":400,"textAlign":"center","visible":true},
      {"id":"price","type":"text","field":"price","x":8,"y":77,"w":84,"h":18,"fontSize":12,"fontWeight":700,"textAlign":"center","visible":true}
    ]
  }'::jsonb,
  true,
  true
),
(
  'Shelf Label / Agoranomia',
  'shelf',
  '{
    "version":1,"mode":"thermal","thermalPresetId":"58x40","customW":58,"customH":40,
    "a4PresetId":"3x7","priceLevel":"1",
    "fields":{"showName":true,"showSku":true,"showPrice":true,"showBarcodeText":true,"showUnitPrice":true,"showGarmentDetails":false},
    "elements":[
      {"id":"name","type":"text","field":"name","x":3,"y":2,"w":94,"h":12,"fontSize":8,"fontWeight":700,"textAlign":"center","visible":true},
      {"id":"offer","type":"text","field":"offer","x":3,"y":15,"w":94,"h":10,"fontSize":7,"fontWeight":700,"textAlign":"center","visible":true},
      {"id":"priorPrice","type":"text","field":"priorPrice","x":3,"y":26,"w":94,"h":10,"fontSize":6,"fontWeight":400,"textAlign":"center","visible":true},
      {"id":"price","type":"text","field":"price","x":3,"y":38,"w":94,"h":15,"fontSize":11,"fontWeight":700,"textAlign":"center","visible":true},
      {"id":"unitPrice","type":"text","field":"unitPrice","x":3,"y":54,"w":94,"h":10,"fontSize":6,"fontWeight":600,"textAlign":"center","visible":true},
      {"id":"priorUnitPrice","type":"text","field":"priorUnitPrice","x":3,"y":65,"w":94,"h":9,"fontSize":5,"fontWeight":400,"textAlign":"center","visible":true},
      {"id":"barcode","type":"barcode","field":"barcode","x":16,"y":75,"w":68,"h":18,"visible":true},
      {"id":"barcodeText","type":"text","field":"barcodeText","x":8,"y":93,"w":84,"h":6,"fontSize":5,"fontWeight":400,"textAlign":"center","visible":true}
    ]
  }'::jsonb,
  false,
  true
)
ON CONFLICT (name) DO NOTHING;