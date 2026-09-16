-- Smart Task Assistant: let enrichment ask for clarification instead of
-- fabricating a task when raw_capture_text is gibberish/too vague.
ALTER TABLE maintenance_tasks ADD COLUMN clarification_question TEXT;
