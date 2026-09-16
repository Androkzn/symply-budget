/**
 * Synonym groups for spending names.
 *
 * "Peanuts" and "Nuts" share no letters, and neither do "Salmon" and "Fish" —
 * so no amount of string matching over the ledger can connect them. This table
 * supplies the *grouping*; the household's own spending history supplies the
 * *word*. [[rankNameSuggestions]] looks a typed name up here, then keeps only
 * the relatives that already appear in logged expenses, so a shortcut can never
 * put a name in someone's mouth that they have not used themselves.
 *
 * Entries are lowercase seeds, never display text — the bubble shows the
 * spelling from the ledger ("Nuts"), not the spelling written here.
 *
 * Keep this list small and boring. It is a nudge toward names the household
 * already has, not a product taxonomy, and every extra member is another chance
 * to offer a shortcut nobody wanted.
 */
export const NAME_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  // ===== Groceries =====
  [
    'nuts',
    'peanuts',
    'peanut',
    'almonds',
    'cashews',
    'walnuts',
    'pistachios',
    'pecans',
    'hazelnuts',
    'trail mix',
  ],
  [
    'fish',
    'seafood',
    'salmon',
    'tuna',
    'cod',
    'tilapia',
    'halibut',
    'shrimp',
    'prawns',
    'crab',
    'lobster',
    'scallops',
    'mussels',
    'sardines',
  ],
  [
    'beverages',
    'drinks',
    'soda',
    'pop',
    'cola',
    'coke',
    'pepsi',
    'juice',
    'lemonade',
    'iced tea',
    'sparkling water',
    'energy drink',
  ],
  ['dairy', 'milk', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'sour cream', 'eggs'],
  [
    'meat',
    'beef',
    'pork',
    'chicken',
    'turkey',
    'lamb',
    'steak',
    'ground beef',
    'bacon',
    'sausage',
    'ham',
  ],
  [
    'vegetables',
    'veggies',
    'produce',
    'tomatoes',
    'cucumber',
    'lettuce',
    'carrots',
    'onions',
    'potatoes',
    'peppers',
    'broccoli',
    'spinach',
    'celery',
  ],
  [
    'fruit',
    'fruits',
    'apples',
    'bananas',
    'oranges',
    'grapes',
    'berries',
    'strawberries',
    'blueberries',
    'watermelon',
    'mango',
  ],
  ['bakery', 'bread', 'buns', 'bagels', 'croissants', 'tortillas', 'pita'],
  ['snacks', 'chips', 'crackers', 'popcorn', 'pretzels', 'candy', 'chocolate', 'cookies'],
  ['pantry', 'pasta', 'rice', 'noodles', 'cereal', 'oats', 'flour', 'sugar'],
  ['coffee', 'tea', 'espresso', 'latte'],
  ['alcohol', 'beer', 'wine', 'liquor', 'spirits', 'vodka', 'whisky', 'whiskey'],

  // ===== Household + personal =====
  [
    'household',
    'cleaning',
    'detergent',
    'soap',
    'paper towels',
    'toilet paper',
    'dish soap',
    'garbage bags',
  ],
  [
    'personal care',
    'toiletries',
    'shampoo',
    'conditioner',
    'toothpaste',
    'deodorant',
    'razors',
  ],
  ['pharmacy', 'medicine', 'medication', 'vitamins', 'supplements', 'prescription'],
  ['baby', 'diapers', 'wipes', 'formula'],
  ['pet', 'pet food', 'dog food', 'cat food', 'litter'],

  // ===== Getting around + out =====
  ['fuel', 'gas', 'gasoline', 'petrol', 'diesel'],
  ['transit', 'bus', 'subway', 'metro', 'train ticket', 'uber', 'lyft', 'taxi'],
  ['dining', 'restaurant', 'takeout', 'take out', 'delivery', 'fast food'],
  ['utilities', 'hydro', 'electricity', 'water bill', 'gas bill', 'internet', 'phone bill'],
];

/** Shortest token worth looking up on its own, so "a"/"of" never match a group. */
const MIN_TOKEN_LENGTH = 3;

let memberIndex: Map<string, number[]> | null = null;

function buildIndex(): Map<string, number[]> {
  if (memberIndex) return memberIndex;
  const index = new Map<string, number[]>();
  NAME_SYNONYM_GROUPS.forEach((group, groupIndex) => {
    for (const member of group) {
      const existing = index.get(member);
      if (existing) existing.push(groupIndex);
      else index.set(member, [groupIndex]);
    }
  });
  memberIndex = index;
  return index;
}

/**
 * Every seed related to `normalizedQuery` — the whole name first ("peanut
 * butter"), falling back to its individual words ("salmon" out of "salmon
 * fillet") so a name with a qualifier still finds its family.
 *
 * Returns seeds, not suggestions: the caller decides which of them the
 * household actually uses.
 */
export function lexiconRelatives(normalizedQuery: string): string[] {
  const index = buildIndex();
  const groups = new Set<number>(index.get(normalizedQuery) ?? []);

  if (groups.size === 0) {
    for (const token of normalizedQuery.split(/[^a-z0-9]+/)) {
      if (token.length < MIN_TOKEN_LENGTH) continue;
      for (const groupIndex of index.get(token) ?? []) groups.add(groupIndex);
    }
  }

  const relatives: string[] = [];
  for (const groupIndex of groups) relatives.push(...NAME_SYNONYM_GROUPS[groupIndex]);
  return relatives;
}
