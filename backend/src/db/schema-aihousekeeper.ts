/**
 * Aihousekeeper (Proactive Layer) Database Schema
 *
 * Drizzle mirror of the 6 Aihousekeeper tables defined across migrations
 * 0035-0038, plus `google_calendar_tokens` folded into 0040 per plan §G3.
 *
 * Migration files are authoritative for DDL semantics (CHECK constraints,
 * partial indexes, FTS5 virtual tables). This file covers enough for
 * type-safe Drizzle query builder use in services.
 *
 * NOT MIRRORED HERE (SQL-only — see backend/migrations/0035):
 * - `assistant_memory_fts` virtual table (FTS5).
 * - `assistant_memory_fts_{insert,update,delete}` sync triggers.
 *
 * Services that need FTS5 recall drop down to raw SQL via `d1.prepare(...)`;
 * Drizzle is used for everything else.
 *
 * Plan reference: documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan_v3.1.md §A8
 */

import { sql } from 'drizzle-orm';
import { integer, index, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { households, householdMembers, users } from './schema';

// ============ ASSISTANT IDENTITY ============

/**
 * Aihousekeeper persona (one row per household; seeded on createHousehold).
 * All defaults live on the DB side so createHousehold can INSERT with only
 * household_id + timezone and still get the canonical Aihousekeeper persona.
 */
export const assistantIdentity = sqliteTable('assistant_identity', {
  household_id: text('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('Aihousekeeper'),
  tone: text('tone').notNull().default('warm_brief'),
  pronouns: text('pronouns'),
  briefing_time: text('briefing_time').notNull().default('07:00'),
  quiet_hours_start: text('quiet_hours_start').notNull().default('22:00'),
  quiet_hours_end: text('quiet_hours_end').notNull().default('07:00'),
  daily_interrupt_budget: integer('daily_interrupt_budget').notNull().default(3),
  channels_enabled_json: text('channels_enabled_json')
    .notNull()
    .default('{"push":true,"sms":false,"email_weekly":false,"watch":true}'),
  timezone: text('timezone').notNull().default('UTC'),
  created_at: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updated_at: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ============ ASSISTANT MEMORY ============

/**
 * Aihousekeeper memory store. CHECK constraints on `type` and `source` are enforced
 * in migration 0035 and documented here for reference:
 *   type: 'fact' | 'preference' | 'history' | 'decision' | 'unresolved_question'
 *   source: 'user_said' | 'inferred' | 'tool_result' | 'external_signal'
 */
export const assistantMemory = sqliteTable(
  'assistant_memory',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // see CHECK in migration 0035
    subject_kind: text('subject_kind'),
    subject_id: text('subject_id'),
    body: text('body').notNull(),
    redacted_body: text('redacted_body'),
    confidence: real('confidence').notNull().default(0.7),
    source: text('source').notNull(), // see CHECK in migration 0035
    source_ref: text('source_ref'),
    is_anniversary_tracked: integer('is_anniversary_tracked', { mode: 'boolean' })
      .notNull()
      .default(false),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    last_used_at: text('last_used_at'),
    expires_at: text('expires_at'),
    // Self-reference: drizzle-orm's .references() cannot point at the same
    // table being defined, so the migration's FK is authoritative. This
    // column is plain text here.
    superseded_by_id: text('superseded_by_id'),
  },
  (table) => ({
    household_idx: index('idx_assistant_memory_household').on(
      table.household_id,
      table.type,
      table.superseded_by_id
    ),
    subject_idx: index('idx_assistant_memory_subject').on(
      table.household_id,
      table.subject_kind,
      table.subject_id
    ),
    // Note: migration 0035 creates this as a partial index
    // (WHERE is_anniversary_tracked = 1). Drizzle doesn't express partial
    // index predicates; migration SQL is authoritative.
    anniversary_idx: index('idx_assistant_memory_anniversary').on(
      table.household_id,
      table.is_anniversary_tracked
    ),
  })
);

// ============ ASSISTANT FOLLOWUPS ============

/**
 * CHECK constraints in migration 0036:
 *   origin: 'self_scheduled' | 'user_requested'
 *   status: 'pending' | 'fired' | 'cancelled' | 'skipped'
 */
export const assistantFollowups = sqliteTable(
  'assistant_followups',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    scheduled_for: text('scheduled_for').notNull(),
    prompt: text('prompt').notNull(),
    context_ref_json: text('context_ref_json'),
    origin: text('origin').notNull(),
    status: text('status').notNull().default('pending'),
    fired_at: text('fired_at'),
    outcome_json: text('outcome_json'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    due_idx: index('idx_assistant_followups_due').on(table.status, table.scheduled_for),
  })
);

// ============ ASSISTANT BRIEFINGS ============

/**
 * UNIQUE(household_id, date) enforces one briefing per household per day.
 * Composer is idempotent on this constraint.
 */
export const assistantBriefings = sqliteTable(
  'assistant_briefings',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    composed_at: text('composed_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    paragraph: text('paragraph').notNull(),
    bullets_json: text('bullets_json').notNull().default('[]'),
    push_sent: integer('push_sent', { mode: 'boolean' }).notNull().default(false),
    push_message_id: text('push_message_id'),
    read_at: text('read_at'),
    empty_reason: text('empty_reason'),
    source_signals_json: text('source_signals_json').notNull().default('[]'),
    composed_by_model: text('composed_by_model'),
    prompt_version: text('prompt_version'),
  },
  (table) => ({
    household_idx: index('idx_assistant_briefings_household').on(table.household_id, table.date),
    // Note: migration 0036 declares UNIQUE(household_id, date) inline on
    // the CREATE TABLE; SQLite generates an implicit unique index. We do
    // not re-declare it here to avoid a name collision on `db:generate`.
  })
);

// ============ ASSISTANT OUTBOUND LOG ============

/**
 * Single source of truth for every outbound Aihousekeeper message.
 * CHECK constraints in migration 0037:
 *   channel: 'push' | 'sms' | 'email' | 'watch'
 *   status: 'sent' | 'failed' | 'skipped_aihousekeeper_disabled' | 'skipped_channel_killed'
 *         | 'skipped_conservative_mode' | 'skipped_channel_disabled'
 *         | 'skipped_tcpa_quiet_hours' | 'skipped_quiet_hours' | 'skipped_budget'
 *         | 'skipped_duplicate' | 'skipped_empty' | 'skipped_kill_switch'
 * (12 total — matches §B4 CanSendDenyReason plus `skipped_empty` and
 *  `skipped_kill_switch`.)
 */
export const assistantOutboundLog = sqliteTable(
  'assistant_outbound_log',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    to_member_id: text('to_member_id'),
    template: text('template').notNull(),
    body: text('body').notNull(),
    external_message_id: text('external_message_id'),
    idempotency_key: text('idempotency_key'),
    status: text('status').notNull(),
    trigger_ref_json: text('trigger_ref_json'),
    user_action: text('user_action'),
    composed_by_model: text('composed_by_model'),
    prompt_version: text('prompt_version'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_day_idx: index('idx_outbound_household_day').on(
      table.household_id,
      table.created_at
    ),
    // Partial unique index — see migration 0037 for the
    // `WHERE idempotency_key IS NOT NULL` predicate. Drizzle cannot express
    // partial indexes; the migration is authoritative.
    idempotency_idx: uniqueIndex('idx_outbound_idempotency').on(
      table.household_id,
      table.idempotency_key
    ),
  })
);

// ============ ASSISTANT TRUST LEDGER ============

/**
 * Append-only record of meaningful Aihousekeeper actions (undo / audit).
 * CHECK on category (migration 0038):
 *   'decision' | 'message_sent' | 'task_changed' | 'memory_added'
 *   | 'followup_scheduled' | 'assignment'
 */
export const assistantTrustLedger = sqliteTable(
  'assistant_trust_ledger',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    occurred_at: text('occurred_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    category: text('category').notNull(),
    summary: text('summary').notNull(),
    rationale: text('rationale').notNull(),
    reversible: integer('reversible', { mode: 'boolean' }).notNull().default(false),
    undo_token: text('undo_token'),
    related_refs_json: text('related_refs_json'),
    user_dismissed_at: text('user_dismissed_at'),
    event_idempotency_key: text('event_idempotency_key'),
  },
  (table) => ({
    household_idx: index('idx_trust_ledger_household').on(
      table.household_id,
      table.occurred_at
    ),
    // Partial unique index — predicate in migration 0038 is authoritative.
    idempotency_idx: uniqueIndex('idx_trust_ledger_idempotency').on(
      table.event_idempotency_key
    ),
  })
);

// ============ GOOGLE CALENDAR TOKENS (folded into 0040 per §G3) ============

/**
 * Per-member OAuth tokens for Google Calendar (calendar.readonly).
 * Tokens refresh automatically; if refresh fails, propose_calendar_slots
 * returns a tool-level error prompting the user to re-link.
 */
export const googleCalendarTokens = sqliteTable('google_calendar_tokens', {
  member_id: text('member_id')
    .primaryKey()
    .references(() => householdMembers.id, { onDelete: 'cascade' }),
  access_token: text('access_token').notNull(),
  refresh_token: text('refresh_token').notNull(),
  expires_at: integer('expires_at').notNull(),
  scope: text('scope').notNull(),
  created_at: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ============ AIHOUSEKEEPER ATTACHMENTS (v3.1 follow-up) ============

/**
 * `aihousekeeper_attachments` — files the user attached inside the Aihousekeeper chat flow
 * (images from camera/library, documents picked from Files). Lifecycle +
 * routing targets are documented in migration 0042_aihousekeeper_attachments.sql.
 *
 * Classification happens via the `classify_and_save_attachment` Aihousekeeper tool:
 * for `report`/`floor_plan` the file is copied into the domain bucket and
 * `linked_entity_*` points at the new row; other kinds stay in place.
 */
export const aihousekeeperAttachments = sqliteTable(
  'aihousekeeper_attachments',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    r2_key: text('r2_key').notNull(),
    file_name: text('file_name').notNull(),
    mime_type: text('mime_type').notNull(),
    size_bytes: integer('size_bytes'),
    /** pending_upload | uploaded | classified | routed | failed */
    status: text('status').notNull().default('pending_upload'),
    /** photo | report | floor_plan | receipt | quote | note — NULL until classified */
    kind: text('kind'),
    kind_hint: text('kind_hint'),
    /** reports | floor_plans — set once routed */
    linked_entity_type: text('linked_entity_type'),
    linked_entity_id: text('linked_entity_id'),
    failure_reason: text('failure_reason'),
    /** SHA-256 hex of the uploaded bytes; set by PUT /:id/upload after the R2 write. */
    content_hash: text('content_hash'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_status_idx: index('idx_aihousekeeper_attachments_household_status').on(
      table.household_id,
      table.status,
      table.created_at
    ),
    household_created_idx: index('idx_aihousekeeper_attachments_household_created').on(
      table.household_id,
      table.created_at
    ),
  })
);

// ============ TypeScript types ============

export type AssistantIdentity = typeof assistantIdentity.$inferSelect;
export type NewAssistantIdentity = typeof assistantIdentity.$inferInsert;

export type AssistantMemory = typeof assistantMemory.$inferSelect;
export type NewAssistantMemory = typeof assistantMemory.$inferInsert;

export type AssistantFollowup = typeof assistantFollowups.$inferSelect;
export type NewAssistantFollowup = typeof assistantFollowups.$inferInsert;

export type AssistantBriefing = typeof assistantBriefings.$inferSelect;
export type NewAssistantBriefing = typeof assistantBriefings.$inferInsert;

export type AssistantOutboundLogEntry = typeof assistantOutboundLog.$inferSelect;
export type NewAssistantOutboundLogEntry = typeof assistantOutboundLog.$inferInsert;

export type AssistantTrustLedgerEntry = typeof assistantTrustLedger.$inferSelect;
export type NewAssistantTrustLedgerEntry = typeof assistantTrustLedger.$inferInsert;

export type GoogleCalendarToken = typeof googleCalendarTokens.$inferSelect;
export type NewGoogleCalendarToken = typeof googleCalendarTokens.$inferInsert;

export type AihousekeeperAttachment = typeof aihousekeeperAttachments.$inferSelect;
export type NewAihousekeeperAttachment = typeof aihousekeeperAttachments.$inferInsert;

export type AihousekeeperAttachmentStatus =
  | 'pending_upload'
  | 'uploaded'
  | 'classified'
  | 'routed'
  | 'failed';

export type AihousekeeperAttachmentKind =
  | 'photo'
  | 'report'
  | 'floor_plan'
  | 'receipt'
  | 'quote'
  | 'note';
