/**
 * Look of a user-created budget category.
 *
 * Shared by the Categories management screen (full colour + glyph pickers) and
 * the inline "create a category" row inside every category picker
 * ([[budgetCategoryQuickCreate]]), so a category made in a hurry from a
 * spending form looks like one made deliberately in settings.
 */

/**
 * Swatches for user-created categories — the tile behind the glyph, so custom
 * categories stay visually distinguishable from one another.
 *
 * Three runs around the same hue wheel (mid / deep / soft) rather than ten lone
 * hues: with only one tone per hue a household that runs past ten categories
 * had to reuse a colour before it ran out of ideas for names. Order is
 * load-bearing — `nextCategoryColor` rotates through it, so the first run stays
 * first and new tones are appended, never interleaved, or every household's
 * next auto-assigned colour would shift.
 */
/* eslint-disable no-restricted-syntax -- These hexes are content, not styling:
   the member picks one and it is stored on the category and sent to the API, so
   they must stay identical in light and dark. A useAppColors() token would
   resolve differently per theme and repaint saved categories. */
export const PRESET_CATEGORY_COLORS = [
  // Mid tones — the original ten, one per hue.
  '#EF5350',
  '#FF7043',
  '#FFA726',
  '#FFCA28',
  '#66BB6A',
  '#26A69A',
  '#29B6F6',
  '#5C6BC0',
  '#AB47BC',
  '#78909C',
  // Deep tones — same hues, enough contrast to read as a separate choice.
  '#C62828',
  '#E64A19',
  '#F57C00',
  '#F9A825',
  '#2E7D32',
  '#00796B',
  '#0277BD',
  '#303F9F',
  '#7B1FA2',
  '#455A64',
  // Soft tones + the hues the first two runs skip (pink, lime, brown).
  '#EC407A',
  '#F06292',
  '#FF8A65',
  '#D4E157',
  '#9CCC65',
  '#4DB6AC',
  '#4FC3F7',
  '#7986CB',
  '#BA68C8',
  '#8D6E63',
  '#A1887F',
  '#90A4AE',
];
/* eslint-enable no-restricted-syntax */

/**
 * Glyphs offered for a custom category — Symply Budget brand-kit slugs
 * (`brands/symply-budget/src/assets/icons/png/`), grouped so the picker rail
 * reads as themed runs rather than an alphabet soup.
 *
 * Brand slugs, NOT Ionicons names: a custom category has to look like a default
 * one, and the defaults draw the brush-style kit. Categories created before this
 * moved off Ionicons keep rendering — `Icon` falls back to the Ionicons glyph
 * for any name the kit doesn't ship.
 */
export const PRESET_CATEGORY_ICONS = [
  // Generic
  'tag', 'categories', 'other', 'folder', 'copy', 'key',
  // Home & living
  'housing', 'home', 'construct', 'maintenance-fund', 'utilities', 'leaf',
  // Everyday spending
  'food', 'marketplace', 'shopping', 'cube', 'gift',
  // Getting around
  'transport', 'globe', 'location-pin', 'calendar',
  // People & wellbeing
  'health', 'profile', 'members', 'person-add', 'ai-coach', 'account-tie',
  // Leisure & goals
  'play', 'goal', 'trends', 'insights', 'forecast',
  // Tech & comms
  'mobile-phone', 'freelance', 'server', 'call', 'envelope',
  // Money in / out
  'budget', 'savings', 'income-category', 'expense', 'spendings', 'cash',
  'currency', 'dollar-sign', 'bonus',
  // Bills & obligations
  'bills', 'credit', 'debt', 'tax', 'insurance', 'subscriptions', 'recurring',
  'receipt', 'registered-account', 'document-scan', 'privacy',
];

/** Default glyph for a category created inline, where there is no icon picker. */
export const DEFAULT_NEW_CATEGORY_ICON = PRESET_CATEGORY_ICONS[0];

/**
 * Rotate through the swatches by how many categories the household already has,
 * so two categories created back to back don't come out the same colour.
 */
export function nextCategoryColor(existingCount: number): string {
  const index = Math.abs(Math.trunc(existingCount)) % PRESET_CATEGORY_COLORS.length;
  return PRESET_CATEGORY_COLORS[index];
}
