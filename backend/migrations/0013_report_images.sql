-- Migration: Report Images Extensions
-- Adds additional fields to the report_images table for extracted images

-- Add new columns for enhanced image handling
ALTER TABLE report_images ADD COLUMN household_id TEXT REFERENCES households(id) ON DELETE CASCADE;
ALTER TABLE report_images ADD COLUMN thumbnail_key TEXT;
ALTER TABLE report_images ADD COLUMN original_filename TEXT;
ALTER TABLE report_images ADD COLUMN content_type TEXT DEFAULT 'image/jpeg';
ALTER TABLE report_images ADD COLUMN file_size INTEGER;
ALTER TABLE report_images ADD COLUMN position_x REAL;
ALTER TABLE report_images ADD COLUMN position_y REAL;
ALTER TABLE report_images ADD COLUMN system_category TEXT;
ALTER TABLE report_images ADD COLUMN finding_ids TEXT; -- JSON array for multiple findings
ALTER TABLE report_images ADD COLUMN tags TEXT; -- JSON array of tags
ALTER TABLE report_images ADD COLUMN extraction_method TEXT CHECK (extraction_method IN ('pdf_native', 'pdf_render', 'ocr', 'manual_upload'));
ALTER TABLE report_images ADD COLUMN extraction_confidence REAL;
ALTER TABLE report_images ADD COLUMN status TEXT DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'failed', 'deleted'));
ALTER TABLE report_images ADD COLUMN error_message TEXT;
ALTER TABLE report_images ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

-- Add indexes for new fields
CREATE INDEX IF NOT EXISTS idx_report_images_household ON report_images(household_id);
CREATE INDEX IF NOT EXISTS idx_report_images_status ON report_images(status);
CREATE INDEX IF NOT EXISTS idx_report_images_category ON report_images(system_category);

-- Add image count to reports for quick reference
ALTER TABLE reports ADD COLUMN image_count INTEGER DEFAULT 0;
