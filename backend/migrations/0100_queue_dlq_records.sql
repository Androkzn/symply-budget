-- ============================================
-- Migration: Queue DLQ audit records (Track B / RES-5)
-- Date: 2026-07-16
-- Description: Persist summaries of messages drained from Cloudflare Queues
--              dead-letter queues so poisoned work is not silently lost when
--              the DLQ consumer acks. Written by dlq-consumer.ts; scanned
--              hourly by dlq-scanner.ts.
-- ============================================

CREATE TABLE IF NOT EXISTS queue_dlq_records (
  id TEXT PRIMARY KEY,
  source_queue TEXT NOT NULL,
  dlq_category TEXT NOT NULL CHECK (dlq_category IN (
    'aihousekeeper_outbound',
    'garden_plan',
    'task_enrichment',
    'unknown'
  )),
  message_id TEXT,
  delivery_attempts INTEGER NOT NULL DEFAULT 1,
  payload_summary TEXT NOT NULL,
  payload_preview TEXT,
  household_id TEXT,
  entity_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_queue_dlq_source_created
  ON queue_dlq_records(source_queue, created_at);

CREATE INDEX IF NOT EXISTS idx_queue_dlq_category_created
  ON queue_dlq_records(dlq_category, created_at);
