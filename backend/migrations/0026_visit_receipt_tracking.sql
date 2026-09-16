-- Migration: Add receipt tracking to contractor visits
-- Created: 2026-02-05

-- Add receipt_received flag to contractor_visits
-- ALTER TABLE contractor_visits ADD COLUMN receipt_received INTEGER DEFAULT 0;

-- Add receipt_task_id to track the auto-created reminder task
-- ALTER TABLE contractor_visits ADD COLUMN receipt_reminder_task_id TEXT REFERENCES maintenance_tasks(id) ON DELETE SET NULL;

-- Add receipt_requested_at timestamp (when the receipt was requested via email/message)
-- ALTER TABLE contractor_visits ADD COLUMN receipt_requested_at TEXT;

-- Create index for visits without receipts (for reminder queries)
-- COMMENTED OUT: Depends on receipt_received column which may not exist
-- CREATE INDEX IF NOT EXISTS contractor_visits_receipt_pending_idx
-- ON contractor_visits(receipt_received, status)
-- WHERE receipt_received = 0 AND status = 'completed';
