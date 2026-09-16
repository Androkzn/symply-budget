/**
 * Budget household chat schema — a 100%-independent fork of the House household
 * chat (schema-chat.ts), owned by the Symply Budget app. Multi-room,
 * member-to-member messaging with an optional AI assistant participant (pulled
 * into a room via `@assistant`, replying only with the user's own BYOK key).
 *
 * D1 is the durable source of truth for rooms + messages; the shared, stateless
 * ChatRoomDO (durable-objects/chat-room.ts) is reused purely as a live
 * WebSocket fan-out layer keyed by room id and stores no message state, so
 * Budget rooms never mix with House rooms. Tables are fully separate from the
 * House `chat_*` tables — nothing is shared at the schema level.
 *
 * Migration: 0091_budget_chat.sql
 */
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { households, users } from './schema';

export const budgetChatRooms = sqliteTable(
  'budget_chat_rooms',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    created_by: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // When 1, `@assistant` mentions in this room trigger an AI reply (BYOK).
    ai_enabled: integer('ai_enabled', { mode: 'boolean' }).notNull().default(true),
    // The auto-created "General" room. Used to avoid creating duplicates and
    // to keep it from being archived/deleted.
    is_default: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    // The dedicated 1:1 AI Budget Assistant room. Auto-created, pinned on top,
    // undeletable, participant-locked, and every member message triggers an AI
    // reply (no `@assistant` needed). At most one per household.
    is_assistant: integer('is_assistant', { mode: 'boolean' }).notNull().default(false),
    /**
     * Subject columns (migration 0167). Budget never sets them — they exist so
     * the Budget and House chat tables stay STRUCTURALLY IDENTICAL, which is the
     * standing contract `chat-room-service-core.ts` relies on when it runs one
     * implementation over both and casts these tables to the House shape. A
     * column present on one set and absent from the other is a runtime error
     * waiting for whichever app reads it second.
     */
    subject_type: text('subject_type'),
    subject_id: text('subject_id'),
    subject_parent_id: text('subject_parent_id'),
    subject_label: text('subject_label'),
    subject_parent_label: text('subject_parent_label'),
    subject_context_json: text('subject_context_json'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    archived_at: text('archived_at'),
  },
  (table) => ({
    household_idx: index('budget_chat_rooms_household_idx').on(table.household_id, table.archived_at),
    // Partial, matching migration 0167 — see `schema-chat.ts` for why.
    subject_idx: uniqueIndex('budget_chat_rooms_subject_idx')
      .on(table.household_id, table.subject_type, table.subject_id)
      .where(sql`${table.subject_type} IS NOT NULL`),
    subject_parent_idx: index('budget_chat_rooms_subject_parent_idx')
      .on(table.household_id, table.subject_parent_id)
      .where(sql`${table.subject_parent_id} IS NOT NULL`),
  })
);

export const budgetChatMessages = sqliteTable(
  'budget_chat_messages',
  {
    id: text('id').primaryKey(),
    room_id: text('room_id')
      .notNull()
      .references(() => budgetChatRooms.id, { onDelete: 'cascade' }),
    // Denormalized for cheap household-scoped queries + push fan-out.
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    // 'user' (a member), 'ai' (the assistant), 'system' (room events)
    sender_type: text('sender_type').notNull(),
    // Null for ai/system messages.
    sender_user_id: text('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    // JSON: { model?, mentionsAssistant?, mentions?: string[] (tagged user ids), replyToId?, ... }
    metadata_json: text('metadata_json'),
    // JSON array of { key, mimeType?, width?, height? } — image attachments served
    // from R2 via /files/:key. Null/absent for text-only messages.
    attachments_json: text('attachments_json'),
    // Set when the author edits their own message (renders an "edited" hint).
    edited_at: text('edited_at'),
    // Soft-delete marker. When set, body/attachments are blanked and the bubble
    // renders a "message deleted" tombstone; the row is retained for stable
    // pagination + reply context.
    deleted_at: text('deleted_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    room_created_idx: index('budget_chat_messages_room_created_idx').on(table.room_id, table.created_at),
    household_idx: index('budget_chat_messages_household_idx').on(table.household_id),
  })
);

/**
 * OPTIONAL per-room participant scoping. A room with NO participant rows (and the
 * default "General" room) is visible to EVERY household member — this keeps the
 * original "everyone is in every room" behavior with no backfill. Once an owner
 * adds participants, the room is restricted to that set (plus its creator).
 */
export const budgetChatRoomParticipants = sqliteTable(
  'budget_chat_room_participants',
  {
    room_id: text('room_id')
      .notNull()
      .references(() => budgetChatRooms.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    added_by: text('added_by').references(() => users.id, { onDelete: 'set null' }),
    added_at: text('added_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.room_id, table.user_id] }),
    user_idx: index('budget_chat_room_participants_user_idx').on(table.user_id),
  })
);

export const budgetChatRoomReads = sqliteTable(
  'budget_chat_room_reads',
  {
    room_id: text('room_id')
      .notNull()
      .references(() => budgetChatRooms.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    last_read_message_id: text('last_read_message_id'),
    last_read_at: text('last_read_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    room_user_idx: uniqueIndex('budget_chat_room_reads_room_user_idx').on(table.room_id, table.user_id),
  })
);

export type BudgetChatRoom = typeof budgetChatRooms.$inferSelect;
export type NewBudgetChatRoom = typeof budgetChatRooms.$inferInsert;
export type BudgetChatMessage = typeof budgetChatMessages.$inferSelect;
export type NewBudgetChatMessage = typeof budgetChatMessages.$inferInsert;
export type BudgetChatRoomRead = typeof budgetChatRoomReads.$inferSelect;
export type NewBudgetChatRoomRead = typeof budgetChatRoomReads.$inferInsert;
export type BudgetChatRoomParticipant = typeof budgetChatRoomParticipants.$inferSelect;
export type NewBudgetChatRoomParticipant = typeof budgetChatRoomParticipants.$inferInsert;
