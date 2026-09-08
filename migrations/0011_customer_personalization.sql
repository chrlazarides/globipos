CREATE TABLE IF NOT EXISTS customer_preferences (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id VARCHAR NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  dietary_preferences TEXT[] NOT NULL DEFAULT '{}',
  disliked_ingredients TEXT[] NOT NULL DEFAULT '{}',
  preferred_categories TEXT[] NOT NULL DEFAULT '{}',
  recommendation_goals TEXT[] NOT NULL DEFAULT '{}',
  budget_preference TEXT,
  notification_recommendations BOOLEAN NOT NULL DEFAULT TRUE,
  notification_order_updates BOOLEAN NOT NULL DEFAULT TRUE,
  notification_offers BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE customer_preferences
  ADD COLUMN IF NOT EXISTS notification_recommendations BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notification_order_updates BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notification_offers BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS customer_feedback (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id VARCHAR NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id VARCHAR REFERENCES portal_orders(id) ON DELETE SET NULL,
  context TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  sentiment TEXT NOT NULL,
  sentiment_score NUMERIC(3,2) NOT NULL CHECK (sentiment_score BETWEEN -1 AND 1),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_notifications (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id VARCHAR NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL,
  action_url TEXT,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_feedback_customer_created_idx ON customer_feedback(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_notifications_customer_created_idx ON customer_notifications(customer_id, created_at DESC);