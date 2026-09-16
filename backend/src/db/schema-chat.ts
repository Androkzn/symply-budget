/**
 * Household chat schema — multi-room, member-to-member messaging with an
 * optional AI assistant participant (pulled into a room via `@assistant`).
 *
 * D1 is the durable source of truth for rooms + messages; the ChatRoomDO
 * (durable-objects/chat-room.ts) is only a live WebSocket fan-out layer and
 * stores no message state. Distinct from:
 *   - schema-ai-chat.ts (Aihousekeeper's tool-approval carve-out)
 *   - the stateless /chat AI Q&A route (report analysis)
 *   - household_notes (verbatim shared notes)
 *
 * Migration: 0055_household_chat.sql
 */
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { households, users } from './schema';

export const chatRooms = sqliteTable(
  'chat_rooms',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    created_by: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // When 1, `@assistant` mentions in this room trigger an AI reply.
    ai_enabled: integer('ai_enabled', { mode: 'boolean' }).notNull().default(true),
    // The auto-created "General" room. Used to avoid creating duplicates and
    // to keep it from being archived/deleted.
    is_default: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    // The dedicated 1:1 AI assistant room. Auto-created, pinned on top,
    // undeletable, participant-locked, and every member message triggers an AI
    // reply (no `@assistant` needed). At most one per household.
    is_assistant: integer('is_assistant', { mode: 'boolean' }).notNull().default(false),
    /**
     * The entity this conversation is ABOUT — 'home_project' |
     * 'home_project_material', NULL for an ordinary room. Migration 0167.
     *
     * `subject_id` is an OPAQUE string with no foreign key, deliberately: House
     * V2 home projects are Tier A (on-device ledger) while chat is Tier B
     * (server), so for a local-first household D1 has never seen the project a
     * room is about. A REFERENCES clause would make project chat impossible for
     * exactly those households. `household_id` is the only scope that matters.
     */
    subject_type: text('subject_type'),
    subject_id: text('subject_id'),
    /** A material chat carries its project id — group-by key for the rooms list. */
    subject_parent_id: text('subject_parent_id'),
    /** Denormalized display text; the Worker may not be able to resolve the subject. */
    subject_label: text('subject_label'),
    subject_parent_label: text('subject_parent_label'),
    /**
     * `{ text, updated_at }` — the assistant's grounding snapshot for this
     * subject, written by the CLIENT when it opens the room. The client is the
     * only party that can read a local-first project's budget, phases and
     * materials, so it is the only party that can say what this chat is about.
     */
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
    household_idx: index('chat_rooms_household_idx').on(table.household_id, table.archived_at),
    // One room per subject per household — what makes "open the chat for this
    // material" idempotent when two devices race. PARTIAL, matching migration
    // 0167: without the predicate every subject-less room (which is most of
    // them) would collide on the same all-NULL tuple.
    subject_idx: uniqueIndex('chat_rooms_subject_idx')
      .on(table.household_id, table.subject_type, table.subject_id)
      .where(sql`${table.subject_type} IS NOT NULL`),
    subject_parent_idx: index('chat_rooms_subject_parent_idx')
      .on(table.household_id, table.subject_parent_id)
      .where(sql`${table.subject_parent_id} IS NOT NULL`),
  })
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    room_id: text('room_id')
      .notNull()
      .references(() => chatRooms.id, { onDelete: 'cascade' }),
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
    room_created_idx: index('chat_messages_room_created_idx').on(table.room_id, table.created_at),
    household_idx: index('chat_messages_household_idx').on(table.household_id),
  })
);

/**
 * OPTIONAL per-room participant scoping. A room with NO participant rows (and the
 * default "General" room) is visible to EVERY household member — this keeps the
 * original "everyone is in every room" behavior with no backfill. Once an owner
 * adds participants, the room is restricted to that set (plus its creator).
 */
export const chatRoomParticipants = sqliteTable(
  'chat_room_participants',
  {
    room_id: text('room_id')
      .notNull()
      .references(() => chatRooms.id, { onDelete: 'cascade' }),
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
    user_idx: index('chat_room_participants_user_idx').on(table.user_id),
  })
);

export const chatRoomReads = sqliteTable(
  'chat_room_reads',
  {
    room_id: text('room_id')
      .notNull()
      .references(() => chatRooms.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    last_read_message_id: text('last_read_message_id'),
    last_read_at: text('last_read_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    room_user_idx: uniqueIndex('chat_room_reads_room_user_idx').on(table.room_id, table.user_id),
  })
);

export type ChatRoom = typeof chatRooms.$inferSelect;
export type NewChatRoom = typeof chatRooms.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type ChatRoomRead = typeof chatRoomReads.$inferSelect;
export type NewChatRoomRead = typeof chatRoomReads.$inferInsert;
export type ChatRoomParticipant = typeof chatRoomParticipants.$inferSelect;
export type NewChatRoomParticipant = typeof chatRoomParticipants.$inferInsert;
