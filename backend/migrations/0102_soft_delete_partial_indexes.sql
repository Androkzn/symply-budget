-- ============================================
-- Migration: Soft-delete partial indexes (DATA-5)
-- Date: 2026-07-17
-- Description: Additive partial indexes WHERE deleted_at IS NULL on
--              high-traffic soft-delete tables so active-row reads skip
--              tombstones. Existing full indexes are left in place.
--
-- Skipped: savings_income_entries / savings_spending_entries — no deleted_at
--          column in 0067_savings_tables.sql (actor FK work is DATA-6).
-- ============================================

-- households
CREATE INDEX IF NOT EXISTS households_name_active_idx
  ON households(name)
  WHERE deleted_at IS NULL;

-- tasks (renamed from maintenance_tasks in 0061; index names unchanged)
CREATE INDEX IF NOT EXISTS maintenance_tasks_household_id_active_idx
  ON tasks(household_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS maintenance_tasks_next_due_date_active_idx
  ON tasks(household_id, next_due_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS maintenance_tasks_is_active_active_idx
  ON tasks(household_id, is_active)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS maintenance_tasks_reminder_active_idx
  ON tasks(reminder_enabled, next_due_date)
  WHERE deleted_at IS NULL AND reminder_enabled = 1;

-- reports
CREATE INDEX IF NOT EXISTS reports_household_id_active_idx
  ON reports(household_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS reports_status_active_idx
  ON reports(household_id, status)
  WHERE deleted_at IS NULL;

-- household_spaces
CREATE INDEX IF NOT EXISTS household_spaces_household_id_active_idx
  ON household_spaces(household_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS household_spaces_display_order_active_idx
  ON household_spaces(household_id, display_order)
  WHERE deleted_at IS NULL;
