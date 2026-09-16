import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

import { households, users } from './schema';

// ============ WISHES ============
//
// Long-term dreams / a household wishlist, deliberately distinct from savings
// goals and budget items. A wish ("buy a boat") is aspirational and visual
// first; money is optional context only. Each wish owns a chat/feed-style
// stream of entries (notes, photos, links). See migrations/0076_wishes.sql.

export const wishes = sqliteTable(
  'wishes',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    // R2 key of the chosen cover image (mirrors a wish_entries image_key).
    cover_image_key: text('cover_image_key'),
    // Optional ballpark cost — NOT budget/affordability math.
    estimated_cost_cents: integer('estimated_cost_cents'),
    target_date: text('target_date'), // optional YYYY-MM-DD
    // 'active' | 'achieved' | 'archived'
    status: text('status').notNull().default('active'),
    sort_order: integer('sort_order').notNull().default(0),
    created_by: text('created_by').references(() => users.id),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_idx: index('wishes_household_idx').on(table.household_id),
    household_status_idx: index('wishes_household_status_idx').on(
      table.household_id,
      table.status
    ),
  })
);

export const wishEntries = sqliteTable(
  'wish_entries',
  {
    id: text('id').primaryKey(),
    wish_id: text('wish_id')
      .notNull()
      .references(() => wishes.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    // 'note' | 'image' | 'link'
    kind: text('kind').notNull(),
    body: text('body'), // note text / image caption / link note
    image_key: text('image_key'), // R2 key for kind='image'
    url: text('url'), // link URL for kind='link'
    link_title: text('link_title'), // display label for kind='link'
    price_cents: integer('price_cents'), // optional price tag on the entry
    // Soft link to the entry this one replies to (threaded chat). NULL = top-level.
    parent_entry_id: text('parent_entry_id'),
    created_by: text('created_by').references(() => users.id),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    wish_idx: index('wish_entries_wish_idx').on(table.wish_id, table.created_at),
    household_idx: index('wish_entries_household_idx').on(table.household_id),
  })
);

export type Wish = typeof wishes.$inferSelect;
export type NewWish = typeof wishes.$inferInsert;
export type WishEntry = typeof wishEntries.$inferSelect;
export type NewWishEntry = typeof wishEntries.$inferInsert;
