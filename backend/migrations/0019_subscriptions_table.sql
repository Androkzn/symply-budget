-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    tier TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'active',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_start TEXT NOT NULL,
    current_period_end TEXT NOT NULL,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_idx
    ON subscriptions(user_id);

CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx
    ON subscriptions(stripe_customer_id);

CREATE INDEX IF NOT EXISTS subscriptions_tier_idx
    ON subscriptions(tier);

CREATE INDEX IF NOT EXISTS subscriptions_status_idx
    ON subscriptions(status);
