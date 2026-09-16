/**
 * Household notes schema — free-form shared notes, distinct from
 * assistant_memory. Memory redacts PII before surfacing to the LLM;
 * notes are returned verbatim so users can store things like door
 * codes, wifi passwords, or quick reminders and have Aihousekeeper recall
 * them as written. Migration: 0045_household_notes.sql
 */
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { households, users } from './schema';

export const householdNotes = sqliteTable(
  'household_notes',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    created_by: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    body: text('body').notNull(),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    deleted_at: text('deleted_at'),
  },
  (table) => ({
    household_idx: index('idx_household_notes_household').on(
      table.household_id,
      table.pinned,
      table.updated_at
    ),
  })
);

export type HouseholdNote = typeof householdNotes.$inferSelect;
export type NewHouseholdNote = typeof householdNotes.$inferInsert;
