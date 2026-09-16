/**
 * v1.2 AI chat schema (partial — Aihousekeeper's carve-out only).
 *
 * This file currently defines the minimum subset of v1.2's ai_chat schema
 * that Aihousekeeper depends on: `ai_tool_pending`, the approval queue for
 * HIGH_WRITE tool invocations (v1.2 ADR-32).
 *
 * When v1.2's full ai_chat plan lands, the additional tables
 * (ai_chat_sessions, ai_chat_messages, ai_tool_calls, ai_tool_audit,
 * ai_idempotency_keys) should be added here and their SQL shipped in a
 * follow-up migration.
 *
 * SQL-of-record: backend/migrations/0034_ai_tool_pending.sql.
 */

import { sql } from 'drizzle-orm';
import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { households, users } from './schema';

/**
 * `ai_tool_pending` — parked HIGH_WRITE tool invocations awaiting user approval.
 *
 * Aihousekeeper HIGH_WRITE tools (`send_sms_to_contractor`, `send_email_to_contractor`,
 * `request_quotes_from_saved_contractors`, `assign_task_to_member`) write a
 * row here with `status='pending'` and return the id to the caller. The UX
 * surfaces these as approval cards; user action updates status to
 * `approved` (→ executed by dispatcher) or `cancelled`.
 */
export const aiToolPending = sqliteTable(
  'ai_tool_pending',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tool_name: text('tool_name').notNull(),
    /** JSON-encoded tool input. */
    input_json: text('input_json').notNull(),
    idempotency_key: text('idempotency_key').notNull(),
    /**
     * Enum enforced by CHECK in the SQL migration:
     * 'pending' | 'approved' | 'cancelled' | 'executed' | 'expired' | 'failed'.
     */
    status: text('status').notNull().default('pending'),
    approved_at: text('approved_at'),
    approved_by: text('approved_by').references(() => users.id, { onDelete: 'set null' }),
    cancelled_at: text('cancelled_at'),
    cancelled_by: text('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
    executed_at: text('executed_at'),
    execution_result_json: text('execution_result_json'),
    execution_error: text('execution_error'),
    /** Default 72h TTL; expiry sweeper sets status='expired'. */
    expires_at: text('expires_at').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_status_idx: index('idx_ai_tool_pending_household').on(
      table.household_id,
      table.status,
      table.created_at
    ),
    idempotency_idx: uniqueIndex('idx_ai_tool_pending_idempotency').on(
      table.household_id,
      table.idempotency_key
    ),
    // NOTE: the filtered "WHERE status='pending'" index in the SQL migration
    // (idx_ai_tool_pending_expiry) is not expressible in Drizzle core; it
    // still exists in D1 and queries using `expires_at` with a `status='pending'`
    // filter will use it. The SQL migration is authoritative.
  })
);

export type AIToolPending = typeof aiToolPending.$inferSelect;
export type NewAIToolPending = typeof aiToolPending.$inferInsert;

export type AIToolPendingStatus =
  | 'pending'
  | 'approved'
  | 'cancelled'
  | 'executed'
  | 'expired'
  | 'failed';
