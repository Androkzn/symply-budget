-- Link a utility bill to the "Pay bill" task auto-created for it.
-- When a bill is imported/created UNPAID, the backend spawns a one-time
-- maintenance task ("Pay <provider> bill", due on the bill's due date) and
-- stores its id here. Marking the bill paid completes that task; marking it
-- unpaid again re-creates one. Cleared to NULL when no task is linked.
ALTER TABLE utility_bills ADD COLUMN task_id TEXT;

-- Cheaply find the bill a given task belongs to (and vice-versa).
CREATE INDEX IF NOT EXISTS utility_bills_task_id_idx ON utility_bills(task_id);
