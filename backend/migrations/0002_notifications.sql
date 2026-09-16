-- Migration: Add notification tables
-- Created: 2026-01-20

-- Push tokens table
CREATE TABLE IF NOT EXISTS push_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform TEXT NOT NULL,
    device_name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON push_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_token_idx ON push_tokens(token);

-- Notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    push_enabled INTEGER NOT NULL DEFAULT 1,
    email_enabled INTEGER NOT NULL DEFAULT 1,
    quiet_hours_start TEXT,
    quiet_hours_end TEXT,
    timezone TEXT DEFAULT 'America/New_York',
    task_reminders INTEGER NOT NULL DEFAULT 1,
    task_overdue INTEGER NOT NULL DEFAULT 1,
    task_assigned INTEGER NOT NULL DEFAULT 1,
    task_completed INTEGER NOT NULL DEFAULT 1,
    household_updates INTEGER NOT NULL DEFAULT 1,
    report_ready INTEGER NOT NULL DEFAULT 1,
    weekly_summary INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_user_id_idx ON notification_preferences(user_id);

-- Scheduled notifications table
CREATE TABLE IF NOT EXISTS scheduled_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data TEXT,
    scheduled_for TEXT NOT NULL,
    sent_at TEXT,
    failed_at TEXT,
    error_message TEXT,
    reference_type TEXT,
    reference_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS scheduled_notifications_user_id_idx ON scheduled_notifications(user_id);
CREATE INDEX IF NOT EXISTS scheduled_notifications_scheduled_for_idx ON scheduled_notifications(scheduled_for);
CREATE INDEX IF NOT EXISTS scheduled_notifications_sent_at_idx ON scheduled_notifications(sent_at);
CREATE INDEX IF NOT EXISTS scheduled_notifications_reference_idx ON scheduled_notifications(reference_type, reference_id);

-- Notification history table
CREATE TABLE IF NOT EXISTS notification_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data TEXT,
    sent_at TEXT NOT NULL,
    read_at TEXT,
    clicked_at TEXT,
    reference_type TEXT,
    reference_id TEXT
);

CREATE INDEX IF NOT EXISTS notification_history_user_id_idx ON notification_history(user_id);
CREATE INDEX IF NOT EXISTS notification_history_sent_at_idx ON notification_history(sent_at);
CREATE INDEX IF NOT EXISTS notification_history_read_at_idx ON notification_history(read_at);
