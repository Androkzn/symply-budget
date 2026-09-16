-- Rich Notifications Migration (2026 Best Practices)
-- Adds support for image attachments, notification categories, and thread grouping

-- Add rich notification fields to scheduled_notifications
-- ALTER TABLE scheduled_notifications ADD COLUMN image_url TEXT;
-- ALTER TABLE scheduled_notifications ADD COLUMN category_id TEXT;
-- ALTER TABLE scheduled_notifications ADD COLUMN thread_id TEXT;

-- Add index for thread_id to efficiently group notifications
-- COMMENTED OUT: Depends on thread_id column which may not exist
-- CREATE INDEX IF NOT EXISTS scheduled_notifications_thread_id_idx ON scheduled_notifications(thread_id);
