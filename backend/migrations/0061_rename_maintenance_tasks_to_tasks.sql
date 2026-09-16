-- Rename the core "thing to do" entity from maintenance_tasks to tasks, and
-- repoint everything that linked to action_items at tasks instead. No real
-- users yet, so this drops/recreates columns rather than preserving data.

-- SQLite (3.25+, which D1 runs) propagates this rename into FK REFERENCES
-- clauses of other tables (maintenance_completions.task_id,
-- maintenance_subtasks.task_id, task_drafts.converted_to_task_id,
-- maintenance_suggestions.created_task_id, scheduled_notifications.task_id).
ALTER TABLE maintenance_tasks RENAME TO tasks;

-- task_drafts: drop the action-item conversion target; converted_to_task_id
-- already covers all conversions going forward.
ALTER TABLE task_drafts DROP COLUMN converted_to_action_item_id;

-- contractor_visits: linked_action_item_id -> linked_task_id
ALTER TABLE contractor_visits DROP COLUMN linked_action_item_id;
ALTER TABLE contractor_visits ADD COLUMN linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;

-- appointments: linked_action_item_id -> linked_task_id
ALTER TABLE appointments DROP COLUMN linked_action_item_id;
ALTER TABLE appointments ADD COLUMN linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;

-- quotes: drop linked_action_item_id; linked_maintenance_task_id was schema-only
-- (never shipped in a prior migration), so its replacement is a straight add.
ALTER TABLE quotes DROP COLUMN linked_action_item_id;
ALTER TABLE quotes ADD COLUMN linked_task_id TEXT;
CREATE INDEX quotes_linked_task_idx ON quotes (linked_task_id);

-- projects: linked_action_item_ids (JSON array) -> linked_task_ids
ALTER TABLE projects DROP COLUMN linked_action_item_ids;
ALTER TABLE projects ADD COLUMN linked_task_ids TEXT;

-- contractor_issue_resolutions: action_item_id -> task_id
ALTER TABLE contractor_issue_resolutions DROP COLUMN action_item_id;
ALTER TABLE contractor_issue_resolutions ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
