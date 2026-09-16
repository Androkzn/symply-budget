-- 0043_aihousekeeper_floor_plans_content_hash.sql
--
-- Adds SHA-256 content hash to aihousekeeper_attachments and floor_plans so the
-- classify_and_save_attachment tool can detect duplicate uploads for a
-- household before parking an approval. Enforced at the app layer; the
-- index is non-unique because (a) legitimate re-uploads after soft-delete
-- should be allowed, and (b) the dedup query filters by deleted_at IS NULL.

ALTER TABLE aihousekeeper_attachments ADD COLUMN content_hash TEXT;
ALTER TABLE floor_plans        ADD COLUMN content_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_floor_plans_household_content_hash
  ON floor_plans(household_id, content_hash);

CREATE INDEX IF NOT EXISTS idx_aihousekeeper_attachments_content_hash
  ON aihousekeeper_attachments(content_hash);
