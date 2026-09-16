-- AI Access Migration: RevenueCat fields + billing_state on subscriptions
-- Additive nullable columns; safe with existing rows.

ALTER TABLE subscriptions ADD COLUMN provider TEXT;
ALTER TABLE subscriptions ADD COLUMN entitlement_id TEXT;
ALTER TABLE subscriptions ADD COLUMN store_environment TEXT;
ALTER TABLE subscriptions ADD COLUMN revenuecat_app_user_id TEXT;
ALTER TABLE subscriptions ADD COLUMN revenuecat_product_id TEXT;
ALTER TABLE subscriptions ADD COLUMN billing_state TEXT DEFAULT 'normal';

CREATE INDEX IF NOT EXISTS subscriptions_entitlement_id_idx ON subscriptions(entitlement_id);
CREATE INDEX IF NOT EXISTS subscriptions_revenuecat_app_user_id_idx ON subscriptions(revenuecat_app_user_id);

-- Webhook event ledger for at-least-once RevenueCat delivery
CREATE TABLE IF NOT EXISTS revenuecat_webhook_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  app_user_id TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS revenuecat_webhook_events_event_id_idx
  ON revenuecat_webhook_events(event_id);
