-- Calendar Sync Tokens Table
-- Stores tokens for iCal subscribe URLs
CREATE TABLE IF NOT EXISTS calendar_sync_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  name TEXT DEFAULT 'My Calendar',
  -- What to include in the feed
  includes_tasks INTEGER DEFAULT 1,
  includes_appointments INTEGER DEFAULT 1,
  includes_garbage INTEGER DEFAULT 1,
  -- Filters
  household_id TEXT REFERENCES households(id) ON DELETE SET NULL,
  -- Tracking
  last_accessed_at TEXT,
  access_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS calendar_sync_tokens_user_id_idx ON calendar_sync_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_sync_tokens_token_idx ON calendar_sync_tokens(token);

-- Calendar Event Links Table
-- Tracks which items have been synced to external calendars
CREATE TABLE IF NOT EXISTS calendar_event_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Source entity
  source_type TEXT NOT NULL, -- 'task', 'appointment', 'garbage'
  source_id TEXT NOT NULL,
  -- External calendar
  calendar_type TEXT NOT NULL, -- 'apple', 'google', 'device'
  calendar_id TEXT, -- External calendar ID
  event_id TEXT NOT NULL, -- External event ID
  -- Sync status
  last_synced_at TEXT NOT NULL,
  sync_status TEXT DEFAULT 'synced', -- 'synced', 'pending', 'failed', 'deleted'
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS calendar_event_links_user_id_idx ON calendar_event_links(user_id);
CREATE INDEX IF NOT EXISTS calendar_event_links_source_idx ON calendar_event_links(source_type, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_links_unique_idx ON calendar_event_links(user_id, source_type, source_id, calendar_type);

-- Notification Overrides Table
-- Per-object notification settings (task, space, category, etc.)
CREATE TABLE IF NOT EXISTS notification_overrides (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Target (what this override applies to)
  target_type TEXT NOT NULL, -- 'task', 'space', 'category', 'appliance'
  target_id TEXT, -- NULL for category-level overrides
  category TEXT, -- For category-level overrides (e.g., 'hvac', 'plumbing')
  -- Override settings (NULL means use default)
  enabled INTEGER, -- Override for notification enabled
  reminder_days_before INTEGER,
  reminder_time TEXT,
  reminder_repeat INTEGER,
  -- Calendar sync settings
  sync_to_calendar INTEGER DEFAULT 0,
  calendar_id TEXT, -- Which calendar to sync to
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS notification_overrides_user_id_idx ON notification_overrides(user_id);
CREATE INDEX IF NOT EXISTS notification_overrides_target_idx ON notification_overrides(user_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS notification_overrides_category_idx ON notification_overrides(user_id, target_type, category);
CREATE UNIQUE INDEX IF NOT EXISTS notification_overrides_unique_idx ON notification_overrides(user_id, target_type, COALESCE(target_id, ''), COALESCE(category, ''));

-- User Calendar Settings Table
-- Stores user's calendar sync preferences
CREATE TABLE IF NOT EXISTS user_calendar_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  -- Default calendar for sync
  default_calendar_type TEXT, -- 'apple', 'google', 'device'
  default_calendar_id TEXT,
  default_calendar_name TEXT,
  -- Sync preferences
  auto_sync_tasks INTEGER DEFAULT 0,
  auto_sync_appointments INTEGER DEFAULT 0,
  auto_sync_garbage INTEGER DEFAULT 0,
  -- Task sync settings
  sync_task_due_date INTEGER DEFAULT 1, -- Create event on due date
  sync_task_reminder INTEGER DEFAULT 1, -- Include reminder in calendar event
  task_event_duration_minutes INTEGER DEFAULT 60, -- Default duration for task events
  -- Appearance
  task_event_color TEXT, -- Hex color for task events
  appointment_event_color TEXT,
  garbage_event_color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_calendar_settings_user_id_idx ON user_calendar_settings(user_id);
