-- ============================================
-- Migration: Add Subtasks for Maintenance Tasks
-- Date: 2026-02-06
-- Description: Allow tasks to be broken down into trackable subtasks with optional reminders
-- ============================================

-- Create subtasks table
CREATE TABLE IF NOT EXISTS maintenance_subtasks (
  -- Identity
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,

  -- Content
  title TEXT NOT NULL CHECK(length(trim(title)) > 0), -- Ensure non-empty title
  description TEXT,

  -- Ordering (for user-defined sequence)
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),

  -- Simple completion tracking (boolean, not separate table for simplicity)
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK(is_completed IN (0, 1)),
  completed_at TEXT, -- ISO 8601 timestamp
  completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,

  -- Optional independent reminders (most subtasks won't need these)
  reminder_enabled INTEGER DEFAULT 0 CHECK(reminder_enabled IN (0, 1)),
  reminder_days_before INTEGER DEFAULT 1 CHECK(reminder_days_before >= 0 AND reminder_days_before <= 365),
  reminder_time TEXT DEFAULT '09:00' CHECK(reminder_time LIKE '__:__'), -- HH:MM format
  reminder_date TEXT, -- Calculated reminder date (ISO 8601)

  -- Audit fields (consistent with maintenanceTasks pattern)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  deleted_at TEXT -- Soft delete support
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Primary lookup: get all subtasks for a task
CREATE INDEX IF NOT EXISTS maintenance_subtasks_task_id_idx
  ON maintenance_subtasks(task_id)
  WHERE deleted_at IS NULL;

-- Ordered retrieval: get subtasks in user-defined order
CREATE INDEX IF NOT EXISTS maintenance_subtasks_task_order_idx
  ON maintenance_subtasks(task_id, sort_order)
  WHERE deleted_at IS NULL;

-- Completion queries: filter by completion status
CREATE INDEX IF NOT EXISTS maintenance_subtasks_completed_idx
  ON maintenance_subtasks(is_completed)
  WHERE deleted_at IS NULL;

-- Reminder scheduling: find subtasks needing reminders
CREATE INDEX IF NOT EXISTS maintenance_subtasks_reminder_idx
  ON maintenance_subtasks(reminder_enabled, reminder_date)
  WHERE reminder_enabled = 1 AND deleted_at IS NULL;

-- Audit queries: find recently updated subtasks
CREATE INDEX IF NOT EXISTS maintenance_subtasks_updated_idx
  ON maintenance_subtasks(updated_at)
  WHERE deleted_at IS NULL;

-- ============================================
-- TRIGGER: Auto-update updated_at timestamp
-- ============================================

CREATE TRIGGER IF NOT EXISTS maintenance_subtasks_updated_at_trigger
AFTER UPDATE ON maintenance_subtasks
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE maintenance_subtasks
  SET updated_at = datetime('now')
  WHERE id = NEW.id;
END;

-- ============================================
-- MIGRATION VALIDATION QUERIES (for verification)
-- ============================================

-- Verify table exists
-- SELECT name FROM sqlite_master WHERE type='table' AND name='maintenance_subtasks';

-- Verify indexes exist
-- SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='maintenance_subtasks';

-- Verify trigger exists
-- SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='maintenance_subtasks';

-- ============================================
-- USAGE EXAMPLES
-- ============================================

-- 1. Create a subtask:
-- INSERT INTO maintenance_subtasks (id, task_id, title, sort_order, updated_by)
-- VALUES ('sub-123', 'task-456', 'Replace air filter', 0, 'user-789');

-- 2. Complete a subtask:
-- UPDATE maintenance_subtasks
-- SET is_completed = 1, completed_at = datetime('now'), completed_by = 'user-789'
-- WHERE id = 'sub-123' AND deleted_at IS NULL;

-- 3. Reorder subtasks (batch operation):
-- UPDATE maintenance_subtasks SET sort_order = 0 WHERE id = 'sub-123';
-- UPDATE maintenance_subtasks SET sort_order = 1 WHERE id = 'sub-124';
-- UPDATE maintenance_subtasks SET sort_order = 2 WHERE id = 'sub-125';

-- 4. Soft delete a subtask:
-- UPDATE maintenance_subtasks
-- SET deleted_at = datetime('now')
-- WHERE id = 'sub-123';

-- 5. Get subtask progress for a task:
-- SELECT
--   COUNT(*) as total,
--   SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) as completed,
--   ROUND(SUM(CASE WHEN is_completed = 1 THEN 1.0 ELSE 0.0 END) * 100.0 / COUNT(*), 2) as percentage
-- FROM maintenance_subtasks
-- WHERE task_id = 'task-456' AND deleted_at IS NULL;

-- ============================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================

-- DROP TRIGGER IF EXISTS maintenance_subtasks_updated_at_trigger;
-- DROP INDEX IF EXISTS maintenance_subtasks_updated_idx;
-- DROP INDEX IF EXISTS maintenance_subtasks_reminder_idx;
-- DROP INDEX IF EXISTS maintenance_subtasks_completed_idx;
-- DROP INDEX IF EXISTS maintenance_subtasks_task_order_idx;
-- DROP INDEX IF EXISTS maintenance_subtasks_task_id_idx;
-- DROP TABLE IF EXISTS maintenance_subtasks;
