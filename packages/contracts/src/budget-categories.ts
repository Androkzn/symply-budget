/**
 * THE list of default budget categories — the one every surface derives from.
 *
 * Three lists used to hold this, and they drifted: the server's seed blocks
 * (`budget-service.ts`), the local-first seed (`features/budget/local/defaults.ts`)
 * and the name -> glyph map (`utils/budgetCategoryIcon.ts`). `Fees` is the
 * cautionary tale — added server-side, never added to the local seed, so the
 * local-first app shipped without it and nothing failed, because the drift test
 * only ever parsed one of the three lists.
 *
 * ADDING A CATEGORY is one row. Give it a `localOrder` to put it on device;
 * leave it off for a server-only (House) category. Row ids are derived from the
 * NAME on both surfaces, so position is display order and nothing else.
 */

/** Which part of the product a default belongs to. */
export type BudgetCategoryScope = 'house' | 'general' | 'catchall' | 'income';

export interface DefaultBudgetCategory {
  /** Canonical display name. THE join key — the row id, the glyph lookup and
   *  the AI category matching all resolve by name (case-insensitively). */
  name: string;
  /** Tile colour, stored on the row at seed time. */
  color: string;
  /** Symply Budget brand-kit slug. Stored on the row AND used to render: one
   *  icon vocabulary, so the category editor's picker pre-selects the glyph the
   *  row actually draws. (It used to store an Ionicons name on device and an
   *  emoji on the server, and the picker offers neither.) */
  brandIcon: string;
  scope: BudgetCategoryScope;
  /** Seeded by the Cloudflare Worker, and counted as "predefined" there. */
  server: boolean;
  /** Position in the local-first seed, or absent when it isn't seeded on
   *  device. Display order only. */
  localOrder?: number;
}

export const DEFAULT_BUDGET_CATEGORIES: readonly DefaultBudgetCategory[] = Object.freeze([
  // House maintenance — Worker-seeded. Only `Utilities` is also a device seed.
  {
    name: 'HVAC',
    color: '#4ECDC4',
    brandIcon: 'utilities',
    scope: 'house',
    server: true,
  },
  {
    name: 'Plumbing',
    color: '#2196F3',
    brandIcon: 'maintenance-fund',
    scope: 'house',
    server: true,
  },
  {
    name: 'Electrical',
    color: '#FFD600',
    brandIcon: 'utilities',
    scope: 'house',
    server: true,
  },
  {
    name: 'Roofing',
    color: '#8BC34A',
    brandIcon: 'housing',
    scope: 'house',
    server: true,
  },
  {
    name: 'Foundation',
    color: '#795548',
    brandIcon: 'housing',
    scope: 'house',
    server: true,
  },
  {
    name: 'Exterior',
    color: '#4CAF50',
    brandIcon: 'home',
    scope: 'house',
    server: true,
  },
  {
    name: 'Interior',
    color: '#9C27B0',
    brandIcon: 'home',
    scope: 'house',
    server: true,
  },
  {
    name: 'Appliances',
    color: '#FF5722',
    brandIcon: 'cube',
    scope: 'house',
    server: true,
  },
  {
    name: 'Safety',
    color: '#F44336',
    brandIcon: 'insurance',
    scope: 'house',
    server: true,
  },
  {
    name: 'Garden',
    color: '#689F38',
    brandIcon: 'leaf',
    scope: 'house',
    server: true,
  },
  {
    name: 'Landscaping',
    color: '#558B2F',
    brandIcon: 'leaf',
    scope: 'house',
    server: true,
  },
  {
    name: 'Lawn Care',
    color: '#7CB342',
    brandIcon: 'leaf',
    scope: 'house',
    server: true,
  },
  {
    name: 'Pool & Spa',
    color: '#0288D1',
    brandIcon: 'utilities',
    scope: 'house',
    server: true,
  },
  {
    name: 'Pest Control',
    color: '#827717',
    brandIcon: 'leaf',
    scope: 'house',
    server: true,
  },
  {
    name: 'Utilities',
    color: '#FFB300',
    brandIcon: 'utilities',
    scope: 'house',
    server: true,
    localOrder: 5,
  },
  {
    name: 'Cleaning & Supplies',
    color: '#78909C',
    brandIcon: 'home',
    scope: 'house',
    server: true,
  },
  {
    name: 'Home Improvement',
    color: '#EF6C00',
    brandIcon: 'construct',
    scope: 'house',
    server: true,
  },
  // Everyday spending — what a local-first Budget device mints.
  {
    name: 'Groceries',
    color: '#66BB6A',
    brandIcon: 'marketplace',
    scope: 'general',
    server: true,
    localOrder: 0,
  },
  {
    name: 'Restaurants & Takeout',
    color: '#FF7043',
    brandIcon: 'food',
    scope: 'general',
    server: true,
    localOrder: 1,
  },
  {
    name: 'Coffee & Snacks',
    color: '#A1887F',
    brandIcon: 'food',
    scope: 'general',
    server: true,
    localOrder: 2,
  },
  {
    name: 'Gifts',
    color: '#EC407A',
    brandIcon: 'gift',
    scope: 'general',
    server: true,
    localOrder: 32,
  },
  {
    name: 'Entertainment',
    color: '#7E57C2',
    brandIcon: 'play',
    scope: 'general',
    server: true,
    localOrder: 20,
  },
  {
    name: 'Hobbies',
    color: '#26A69A',
    brandIcon: 'play',
    scope: 'general',
    server: true,
    localOrder: 21,
  },
  {
    name: 'Gaming',
    color: '#5C6BC0',
    brandIcon: 'play',
    scope: 'general',
    server: true,
    localOrder: 22,
  },
  {
    name: 'Books & Music',
    color: '#42A5F5',
    brandIcon: 'play',
    scope: 'general',
    server: true,
    localOrder: 23,
  },
  {
    name: 'Pets',
    color: '#8D6E63',
    brandIcon: 'leaf',
    scope: 'general',
    server: true,
    localOrder: 31,
  },
  {
    name: 'Travel & Vacation',
    color: '#29B6F6',
    brandIcon: 'globe',
    scope: 'general',
    server: true,
    localOrder: 14,
  },
  {
    name: 'Transportation',
    color: '#3949AB',
    brandIcon: 'transport',
    scope: 'general',
    server: true,
    localOrder: 9,
  },
  {
    name: 'Fuel',
    color: '#FB8C00',
    brandIcon: 'transport',
    scope: 'general',
    server: true,
    localOrder: 10,
  },
  {
    name: 'Public Transit',
    color: '#4DD0E1',
    brandIcon: 'transport',
    scope: 'general',
    server: true,
    localOrder: 11,
  },
  {
    name: 'Car Maintenance',
    color: '#78909C',
    brandIcon: 'maintenance-fund',
    scope: 'general',
    server: true,
    localOrder: 12,
  },
  {
    name: 'Personal Care',
    color: '#F06292',
    brandIcon: 'profile',
    scope: 'general',
    server: true,
    localOrder: 17,
  },
  {
    name: 'Beauty',
    color: '#BA68C8',
    brandIcon: 'ai-coach',
    scope: 'general',
    server: true,
    localOrder: 18,
  },
  {
    name: 'Clothing',
    color: '#D81B60',
    brandIcon: 'shopping',
    scope: 'general',
    server: true,
    localOrder: 19,
  },
  {
    name: 'Health & Fitness',
    color: '#00BFA5',
    brandIcon: 'health',
    scope: 'general',
    server: true,
    localOrder: 15,
  },
  {
    name: 'Subscriptions',
    color: '#7986CB',
    brandIcon: 'subscriptions',
    scope: 'general',
    server: true,
    localOrder: 25,
  },
  {
    name: 'Electronics & Tech',
    color: '#455A64',
    brandIcon: 'cube',
    scope: 'general',
    server: true,
    localOrder: 26,
  },
  {
    name: 'Education',
    color: '#1E88E5',
    brandIcon: 'copy',
    scope: 'general',
    server: true,
    localOrder: 28,
  },
  {
    name: 'Childcare & Kids',
    color: '#FFB74D',
    brandIcon: 'members',
    scope: 'general',
    server: true,
    localOrder: 29,
  },
  {
    name: 'Phone & Internet',
    color: '#00ACC1',
    brandIcon: 'mobile-phone',
    scope: 'general',
    server: true,
    localOrder: 6,
  },
  {
    name: 'Insurance',
    color: '#546E7A',
    brandIcon: 'insurance',
    scope: 'general',
    server: true,
    localOrder: 35,
  },
  {
    name: 'Debt Payments',
    color: '#C62828',
    brandIcon: 'debt',
    scope: 'general',
    server: true,
    localOrder: 39,
  },
  {
    name: 'Savings & Investments',
    color: '#2E7D32',
    brandIcon: 'savings',
    scope: 'general',
    server: true,
    localOrder: 40,
  },
  {
    name: 'Charity & Donations',
    color: '#E91E63',
    brandIcon: 'gift',
    scope: 'general',
    server: true,
    localOrder: 34,
  },
  {
    name: 'Holidays & Seasonal',
    color: '#C2185B',
    brandIcon: 'calendar',
    scope: 'general',
    server: true,
    localOrder: 33,
  },
  {
    name: 'Alcohol & Bars',
    color: '#8E24AA',
    brandIcon: 'food',
    scope: 'general',
    server: true,
    localOrder: 3,
  },
  {
    name: 'Taxes',
    color: '#6D4C41',
    brandIcon: 'tax',
    scope: 'general',
    server: true,
    localOrder: 36,
  },
  {
    name: 'Medical & Pharmacy',
    color: '#D32F2F',
    brandIcon: 'health',
    scope: 'general',
    server: true,
    localOrder: 16,
  },
  {
    name: 'Home Office',
    color: '#673AB7',
    brandIcon: 'freelance',
    scope: 'general',
    server: true,
    localOrder: 27,
  },
  {
    name: 'Sports & Outdoors',
    color: '#388E3C',
    brandIcon: 'goal',
    scope: 'general',
    server: true,
    localOrder: 24,
  },
  {
    name: 'Rent & Mortgage',
    color: '#455A64',
    brandIcon: 'housing',
    scope: 'general',
    server: true,
    localOrder: 4,
  },
  {
    name: 'Furniture & Decor',
    color: '#6D4C41',
    brandIcon: 'home',
    scope: 'general',
    server: true,
    localOrder: 8,
  },
  {
    name: 'Legal & Professional',
    color: '#5D4037',
    brandIcon: 'account-tie',
    scope: 'general',
    server: true,
    localOrder: 38,
  },
  {
    name: 'Home Services',
    color: '#546E7A',
    brandIcon: 'construct',
    scope: 'general',
    server: true,
    localOrder: 7,
  },
  {
    name: 'Baby & Family',
    color: '#FF8A65',
    brandIcon: 'members',
    scope: 'general',
    server: true,
    localOrder: 30,
  },
  {
    name: 'Fees',
    color: '#90A4AE',
    brandIcon: 'bills',
    scope: 'general',
    server: true,
    localOrder: 37,
  },
  {
    name: 'Parking',
    color: '#3F51B5',
    brandIcon: 'transport',
    scope: 'general',
    server: true,
    localOrder: 13,
  },
  {
    name: 'Other',
    color: '#607D8B',
    brandIcon: 'other',
    scope: 'catchall',
    server: true,
    localOrder: 42,
  },
  {
    name: 'Income',
    color: '#22C55E',
    brandIcon: 'income-category',
    scope: 'income',
    server: false,
    localOrder: 41,
  },
]);

/**
 * The row id for a default, on every surface and every build.
 *
 * Derived from the NAME, never from position: an index-derived id renumbers
 * every seed after an insertion, so two devices on different builds would
 * author one category under two ids and the household would end up with two of
 * it. Name-derived, the projection's LWW collapses them into one row.
 */
export function defaultCategoryId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `cat_default_${slug}`;
}

/** What a server household is seeded with, in insert order. */
export const SERVER_SEED_CATEGORIES: readonly DefaultBudgetCategory[] =
  DEFAULT_BUDGET_CATEGORIES.filter((c) => c.server);

/** The local-first seed, in display order. */
export const LOCAL_SEED_CATEGORIES: readonly DefaultBudgetCategory[] =
  DEFAULT_BUDGET_CATEGORIES.filter((c) => c.localOrder !== undefined).sort(
    (a, b) => a.localOrder! - b.localOrder!,
  );

/**
 * Lowercased name -> brand-kit slug, for every default on either surface.
 * A name missing here renders the generic catch-all glyph.
 */
export const BUDGET_CATEGORY_ICON_SLUGS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(DEFAULT_BUDGET_CATEGORIES.map((c) => [c.name.toLowerCase(), c.brandIcon])),
);

/**
 * Names the SERVER treats as predefined — togglable via hide, never deletable.
 * `Income` is a local-only seed and stays deletable there.
 */
export const SERVER_DEFAULT_CATEGORY_NAMES: ReadonlySet<string> = new Set(
  SERVER_SEED_CATEGORIES.map((c) => c.name.trim().toLowerCase()),
);
