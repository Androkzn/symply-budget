import { describe, expect, it } from 'vitest';

import {
  BUDGET_CATEGORY_ICON_SLUGS,
  DEFAULT_BUDGET_CATEGORIES,
  LOCAL_SEED_CATEGORIES,
  SERVER_DEFAULT_CATEGORY_NAMES,
  SERVER_SEED_CATEGORIES,
  defaultCategoryId,
} from '../src/budget-categories';

/**
 * The table these guard used to be three lists: the Worker's five seed blocks,
 * the local-first seed and the name -> glyph map. They drifted, and the drift
 * was invisible because each list had its own (or no) test. These assertions
 * are what make one table safe to edit.
 */
describe('default budget categories', () => {
  it('has no duplicate names', () => {
    const names = DEFAULT_BUDGET_CATEGORIES.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('numbers the local seed contiguously from zero', () => {
    const orders = LOCAL_SEED_CATEGORIES.map((c) => c.localOrder);
    expect(orders).toEqual(orders.map((_, i) => i));
  });

  it('maps every category to a brand glyph', () => {
    const missing = DEFAULT_BUDGET_CATEGORIES.filter(
      (c) => !BUDGET_CATEGORY_ICON_SLUGS[c.name.toLowerCase()],
    );
    expect(missing.map((c) => c.name)).toEqual([]);
  });

  it('treats only server-seeded names as predefined', () => {
    // `Income` is a local-only seed; on the server it stays a deletable custom
    // category, exactly as it did before the lists were merged.
    expect(SERVER_DEFAULT_CATEGORY_NAMES.has('groceries')).toBe(true);
    expect(SERVER_DEFAULT_CATEGORY_NAMES.has('income')).toBe(false);
    expect(SERVER_DEFAULT_CATEGORY_NAMES.size).toBe(SERVER_SEED_CATEGORIES.length);
  });

  it('stores one icon vocabulary, the one the picker offers', () => {
    // Rows used to store an Ionicons name on device and an emoji on the server,
    // and the category editor's picker offers neither — so editing a default
    // pre-selected nothing. Now the stored glyph IS the brand slug.
    const seeded = DEFAULT_BUDGET_CATEGORIES.filter((c) => !c.brandIcon.trim());
    expect(seeded.map((c) => c.name)).toEqual([]);
  });

  /** Ids are name-derived, so position is display order and nothing more. */
  it('derives a unique, stable id for every default', () => {
    const ids = DEFAULT_BUDGET_CATEGORIES.map((c) => defaultCategoryId(c.name));
    expect(new Set(ids).size).toBe(ids.length);
    expect(defaultCategoryId('Restaurants & Takeout')).toBe('cat_default_restaurants_takeout');
    expect(ids.every((id) => id.startsWith('cat_default_'))).toBe(true);
  });
});
