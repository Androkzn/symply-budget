/**
 * Settings Database Schema
 * Drizzle ORM schema for user and household settings
 */

import { sql } from 'drizzle-orm';
import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull(),
  household_id: text('household_id'),
  key: text('key').notNull(),
  value: text('value').notNull(), // JSON stored as text
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  unique_user_household_key: uniqueIndex('settings_user_household_key_idx').on(
    table.user_id,
    table.household_id,
    table.key
  ),
  user_id_idx: index('settings_user_id_idx').on(table.user_id),
  household_id_idx: index('settings_household_id_idx').on(table.household_id),
  key_idx: index('settings_key_idx').on(table.key),
}));

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
