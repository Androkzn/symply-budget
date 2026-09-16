-- Add priority/severity level to maintenance tasks (nice_to_have ... urgent, critical)
-- Already-migrated remotes have this column; a fresh database never gets it
-- without this statement, breaking the index below.
ALTER TABLE maintenance_tasks ADD COLUMN priority_severity TEXT DEFAULT 'nice_to_have' NOT NULL;

-- Index for filtering/sorting by priority
CREATE INDEX IF NOT EXISTS maintenance_tasks_priority_severity_idx ON maintenance_tasks(priority_severity);
