-- Migration: Add garbage_collection notification preference
-- This adds support for garbage collection reminder notifications

-- Add garbage_collection column to notification_preferences table
ALTER TABLE notification_preferences ADD COLUMN garbage_collection INTEGER NOT NULL DEFAULT 1;
