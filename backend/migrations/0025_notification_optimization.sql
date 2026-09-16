-- Notification Optimization Migration (2026 Best Practices)
-- Adds send-time optimization and A/B testing support

-- ============ SEND-TIME OPTIMIZATION ============

-- Track user engagement with notifications
CREATE TABLE IF NOT EXISTS notification_engagement (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id TEXT NOT NULL REFERENCES notification_history(id) ON DELETE CASCADE,
    sent_hour INTEGER NOT NULL,           -- 0-23
    sent_day_of_week INTEGER NOT NULL,    -- 0-6 (Sun-Sat)
    opened_at TEXT,
    action_taken TEXT,                    -- 'view', 'snooze', 'complete', 'dismiss'
    response_time_seconds INTEGER,        -- Time from send to action
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS notification_engagement_user_id_idx ON notification_engagement(user_id);
CREATE INDEX IF NOT EXISTS notification_engagement_sent_hour_idx ON notification_engagement(sent_hour);

-- Store computed optimal send times per user
CREATE TABLE IF NOT EXISTS user_optimal_send_times (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    weekday_hours TEXT,                   -- JSON: preferred hours Mon-Fri
    weekend_hours TEXT,                   -- JSON: preferred hours Sat-Sun
    hourly_engagement_scores TEXT,        -- JSON: engagement score by hour
    last_computed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_optimal_send_times_user_id_idx ON user_optimal_send_times(user_id);

-- ============ A/B TESTING ============

-- Define A/B test experiments
CREATE TABLE IF NOT EXISTS notification_ab_tests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    variants TEXT NOT NULL,               -- JSON array of variant definitions
    traffic_percentage INTEGER NOT NULL DEFAULT 100,
    start_date TEXT NOT NULL,
    end_date TEXT,
    winning_variant TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS notification_ab_tests_type_idx ON notification_ab_tests(notification_type);
CREATE INDEX IF NOT EXISTS notification_ab_tests_active_idx ON notification_ab_tests(is_active);

-- Track user assignment to test variants
CREATE TABLE IF NOT EXISTS user_ab_test_assignments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    test_id TEXT NOT NULL REFERENCES notification_ab_tests(id) ON DELETE CASCADE,
    variant_id TEXT NOT NULL,
    notifications_sent INTEGER NOT NULL DEFAULT 0,
    notifications_opened INTEGER NOT NULL DEFAULT 0,
    actions_taken INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_ab_test_assignments_user_test_idx 
    ON user_ab_test_assignments(user_id, test_id);
