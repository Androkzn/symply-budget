/**
 * Cross-cutting queue operations schema — DLQ drain audit trail (Track B / RES-5).
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const queueDlqRecords = sqliteTable(
  'queue_dlq_records',
  {
    id: text('id').primaryKey(),
    source_queue: text('source_queue').notNull(),
    dlq_category: text('dlq_category').notNull(),
    message_id: text('message_id'),
    delivery_attempts: integer('delivery_attempts').notNull().default(1),
    payload_summary: text('payload_summary').notNull(),
    payload_preview: text('payload_preview'),
    household_id: text('household_id'),
    entity_id: text('entity_id'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_queue_dlq_source_created').on(table.source_queue, table.created_at),
    index('idx_queue_dlq_category_created').on(table.dlq_category, table.created_at),
  ]
);

export type QueueDlqRecord = typeof queueDlqRecords.$inferSelect;
export type NewQueueDlqRecord = typeof queueDlqRecords.$inferInsert;
