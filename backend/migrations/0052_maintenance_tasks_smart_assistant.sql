-- Smart Task Assistant: AI-enriched risk/complexity/time + async enrichment
-- lifecycle on maintenance_tasks.
--
-- A task is captured instantly (raw text from voice or typing) and enriched
-- asynchronously by a queue consumer that fills risk_level / complexity /
-- estimated_minutes / priority and generates subtasks. These columns are NULL
-- on legacy + manually-created tasks (enrichment_status NULL = "no enrichment").

-- Risk assessed independently of priority (e.g. low-priority but high-risk:
-- an overheating router that could start a fire). 'low'|'medium'|'high'|'critical'.
ALTER TABLE maintenance_tasks ADD COLUMN risk_level TEXT;

-- Effort/skill: 'trivial'|'simple'|'moderate'|'involved'|'expert'.
ALTER TABLE maintenance_tasks ADD COLUMN complexity TEXT;

-- AI estimate of hands-on time in minutes. Drives the 1-hour planner + reminders.
ALTER TABLE maintenance_tasks ADD COLUMN estimated_minutes INTEGER;

-- Short human-readable explanation of the risk/priority call (UI transparency).
ALTER TABLE maintenance_tasks ADD COLUMN ai_rationale TEXT;

-- Async enrichment lifecycle: 'pending'|'enriching'|'enriched'|'failed'. NULL = none.
ALTER TABLE maintenance_tasks ADD COLUMN enrichment_status TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN enrichment_error TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN enrichment_attempts INTEGER DEFAULT 0;
ALTER TABLE maintenance_tasks ADD COLUMN enriched_at TEXT;

-- Raw user-supplied capture text the AI enriches from (voice transcript / typed).
ALTER TABLE maintenance_tasks ADD COLUMN raw_capture_text TEXT;

-- Stuck-row sweep scans only in-flight rows; risk filter for planner/reports.
CREATE INDEX IF NOT EXISTS maintenance_tasks_enrichment_status_idx
  ON maintenance_tasks (enrichment_status);
CREATE INDEX IF NOT EXISTS maintenance_tasks_risk_level_idx
  ON maintenance_tasks (risk_level);
