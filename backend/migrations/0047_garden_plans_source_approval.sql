-- Track which ai_tool_pending row drove an AI-generated garden plan, so the
-- `/retry` and `/cancel` endpoints can re-fetch the original prompt and clean
-- up the linked approval row. NULL for rows that came from manual user uploads.

ALTER TABLE garden_plans ADD COLUMN source_approval_id TEXT;

CREATE INDEX garden_plans_source_approval_idx ON garden_plans(source_approval_id);
