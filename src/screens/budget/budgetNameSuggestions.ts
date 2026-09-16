/**
 * Name shortcuts for the spending form.
 *
 * Someone types "Peanuts", but most of the time this household logs "Nuts" —
 * so the Name field offers "Nuts" as a bubble underneath. Three signals feed
 * that, strongest first:
 *
 *  - `alias`  a rename this household has already made once, remembered in
 *             [[receiptAliases]]. Explicit teaching, so it always wins.
 *  - `group`  a relative from [[budgetNameLexicon]] that the household is
 *             already using. Bridges names that share no letters at all.
 *  - `match`  a logged name that contains what is being typed. Free, and the
 *             only signal available on a household's very first spendings.
 *
 * Everything here is pure: the screen loads the vocabulary once when the form
 * opens and re-ranks synchronously per keystroke.
 */
import { lexiconRelatives } from './budgetNameLexicon';

/** One name the household has used, and how much it leans on it. */
export interface NameVocabularyEntry {
  /** Display form — the spelling most recently logged. */
  name: string;
  /** How many logged expenses carry this name. */
  usageCount: number;
  /** Date of the most recent use (`YYYY-MM-DD`), for tie-breaks. */
  lastUsedAt: string;
}

export type NameSuggestionReason = 'alias' | 'group' | 'match';

export interface NameSuggestion {
  name: string;
  reason: NameSuggestionReason;
}

/** A learned rename: `key` is a normalized typed name, `name` what replaced it. */
export interface NameAlias {
  key: string;
  name: string;
}

export interface RankNameSuggestionsInput {
  query: string;
  vocabulary: NameVocabularyEntry[];
  aliases: NameAlias[];
  limit?: number;
}

const REASON_WEIGHT: Record<NameSuggestionReason, number> = {
  alias: 3,
  group: 2,
  match: 1,
};

/** Below this, a query matches half the ledger and the bubbles are noise. */
const MIN_QUERY_LENGTH = 2;

/** Three bubbles fit under the field without pushing Store off the screen. */
const DEFAULT_LIMIT = 3;

export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Collapse logged expenses into the household's naming vocabulary.
 *
 * Grouped case-insensitively, but the display form follows the most recent
 * spelling — rename "nuts" to "Nuts" once and the bubble stops shouting.
 */
export function buildNameVocabulary(
  expenses: Array<{ title: string; expense_date: string }>
): NameVocabularyEntry[] {
  const entries = new Map<string, NameVocabularyEntry>();

  for (const row of expenses) {
    const name = row.title?.trim();
    if (!name) continue;

    const key = normalizeName(name);
    const existing = entries.get(key);
    if (!existing) {
      entries.set(key, { name, usageCount: 1, lastUsedAt: row.expense_date });
      continue;
    }

    existing.usageCount += 1;
    if (row.expense_date > existing.lastUsedAt) {
      existing.lastUsedAt = row.expense_date;
      existing.name = name;
    }
  }

  return [...entries.values()];
}

export function rankNameSuggestions({
  query,
  vocabulary,
  aliases,
  limit = DEFAULT_LIMIT,
}: RankNameSuggestionsInput): NameSuggestion[] {
  const typed = normalizeName(query);
  if (typed.length < MIN_QUERY_LENGTH) return [];

  const byName = new Map<string, NameVocabularyEntry>();
  for (const entry of vocabulary) byName.set(normalizeName(entry.name), entry);

  // "Most of the time we use Nuts" is the whole point, so a shortcut only earns
  // its bubble when the name it proposes is used MORE than the one being typed.
  // Without this floor, editing a spending already called "Nuts" would helpfully
  // offer to rename it "Peanuts".
  const typedUsage = byName.get(typed)?.usageCount ?? 0;

  const candidates = new Map<string, { entry: NameVocabularyEntry; reason: NameSuggestionReason }>();

  const offer = (name: string, reason: NameSuggestionReason) => {
    const key = normalizeName(name);
    if (!key || key === typed) return;

    const logged = byName.get(key);
    // A remembered rename stands on its own — the household said so out loud.
    // Group and match shortcuts must point at a name the ledger actually holds.
    if (reason !== 'alias' && (!logged || logged.usageCount <= typedUsage)) return;

    const entry = logged ?? { name: name.trim(), usageCount: 0, lastUsedAt: '' };
    const existing = candidates.get(key);
    if (existing && REASON_WEIGHT[existing.reason] >= REASON_WEIGHT[reason]) return;
    candidates.set(key, { entry, reason });
  };

  for (const alias of aliases) {
    if (normalizeName(alias.key) === typed) offer(alias.name, 'alias');
  }

  for (const relative of lexiconRelatives(typed)) offer(relative, 'group');

  for (const entry of vocabulary) {
    if (normalizeName(entry.name).includes(typed)) offer(entry.name, 'match');
  }

  return [...candidates.values()]
    .sort((a, b) => {
      const byReason = REASON_WEIGHT[b.reason] - REASON_WEIGHT[a.reason];
      if (byReason !== 0) return byReason;
      const byUsage = b.entry.usageCount - a.entry.usageCount;
      if (byUsage !== 0) return byUsage;
      return b.entry.lastUsedAt.localeCompare(a.entry.lastUsedAt);
    })
    .slice(0, limit)
    .map(({ entry, reason }) => ({ name: entry.name, reason }));
}
