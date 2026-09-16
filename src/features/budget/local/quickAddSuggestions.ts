import type { BudgetItem, BudgetQuickAddSuggestion, Expense } from '@api/budget';

/**
 * Local-first twin of the Worker's `services/budget-quick-add.ts`: same
 * grouping, same limits, same row shape.
 *
 * The shape is the point. A spent chip must carry `amount` and a planned chip
 * its estimate pair, or the form's chip handler has nothing to apply and the
 * tap reads as dead — which is exactly how the previous local builder shipped:
 * it put the expense amount on `estimated_cost_*` and never set `amount`, so
 * every spent chip rendered without a price and did nothing when tapped.
 * Typing the result as `BudgetQuickAddSuggestion` keeps that from recurring.
 */

export interface QuickAddSuggestionLists {
  recent: BudgetQuickAddSuggestion[];
  popular: BudgetQuickAddSuggestion[];
}

const RECENT_LIMIT = 6;
const POPULAR_LIMIT = 6;

interface TitleGroup<T> {
  key: string;
  latest: T;
  count: number;
  lastUsedAt: string;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

function groupByTitle<T extends { title: string; created_at: string }>(rows: T[]): TitleGroup<T>[] {
  const map = new Map<string, TitleGroup<T>>();
  for (const row of rows) {
    const title = row.title.trim();
    if (!title) continue;
    const key = normalizeTitle(title);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { key, latest: row, count: 1, lastUsedAt: row.created_at });
      continue;
    }
    existing.count += 1;
    if (row.created_at > existing.lastUsedAt) {
      existing.lastUsedAt = row.created_at;
      existing.latest = row;
    }
  }
  return [...map.values()];
}

function buildLists<T>(
  groups: TitleGroup<T>[],
  toSuggestion: (group: TitleGroup<T>) => BudgetQuickAddSuggestion,
): QuickAddSuggestionLists {
  const recent = [...groups]
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, RECENT_LIMIT)
    .map(toSuggestion);
  const recentKeys = new Set(recent.map((s) => normalizeTitle(s.title)));
  const popular = groups
    .filter((group) => !recentKeys.has(group.key))
    .sort((a, b) => b.count - a.count || b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, POPULAR_LIMIT)
    .map(toSuggestion);
  return { recent, popular };
}

export function quickAddFromExpenses(expenses: Expense[]): QuickAddSuggestionLists {
  return buildLists(groupByTitle(expenses), (group) => ({
    title: group.latest.title.trim(),
    description: group.latest.description,
    category_id: group.latest.category_id,
    amount: group.latest.amount,
    estimated_cost_min: null,
    estimated_cost_max: null,
    priority: null,
    is_recurring: false,
    recurrence_frequency: null,
    usage_count: group.count,
    last_used_at: group.lastUsedAt,
  }));
}

export function quickAddFromPlanned(items: BudgetItem[]): QuickAddSuggestionLists {
  const active = items.filter((item) => item.status !== 'cancelled');
  return buildLists(groupByTitle(active), (group) => ({
    title: group.latest.title.trim(),
    description: group.latest.description,
    category_id: group.latest.category_id,
    amount: null,
    estimated_cost_min: group.latest.estimated_cost_min,
    estimated_cost_max: group.latest.estimated_cost_max,
    priority: group.latest.priority,
    is_recurring: group.latest.is_recurring ?? false,
    recurrence_frequency: group.latest.recurrence_frequency,
    usage_count: group.count,
    last_used_at: group.lastUsedAt,
  }));
}
