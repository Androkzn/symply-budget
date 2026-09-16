import type { BudgetItem, Expense } from '../db/schema-budget';

export interface BudgetQuickAddSuggestion {
  title: string;
  description: string | null;
  category_id: string | null;
  amount: number | null;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  priority: BudgetItem['priority'] | null;
  is_recurring: boolean;
  recurrence_frequency: string | null;
  usage_count: number;
  last_used_at: string;
}

interface TitleGroup<T> {
  key: string;
  latest: T;
  count: number;
  lastUsedAt: string;
}

const RECENT_LIMIT = 6;
const POPULAR_LIMIT = 6;

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

function groupByTitle<T>(
  rows: T[],
  getTitle: (row: T) => string,
  getCreatedAt: (row: T) => string
): TitleGroup<T>[] {
  const map = new Map<string, TitleGroup<T>>();

  for (const row of rows) {
    const title = getTitle(row).trim();
    if (!title) continue;

    const key = normalizeTitle(title);
    const createdAt = getCreatedAt(row);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, { key, latest: row, count: 1, lastUsedAt: createdAt });
      continue;
    }

    existing.count += 1;
    if (createdAt > existing.lastUsedAt) {
      existing.lastUsedAt = createdAt;
      existing.latest = row;
    }
  }

  return [...map.values()];
}

function expenseToSuggestion(group: TitleGroup<Expense>): BudgetQuickAddSuggestion {
  const row = group.latest;
  return {
    title: row.title.trim(),
    description: row.description,
    category_id: row.category_id,
    amount: row.amount,
    estimated_cost_min: null,
    estimated_cost_max: null,
    priority: null,
    is_recurring: false,
    recurrence_frequency: null,
    usage_count: group.count,
    last_used_at: group.lastUsedAt,
  };
}

function plannedToSuggestion(group: TitleGroup<BudgetItem>): BudgetQuickAddSuggestion {
  const row = group.latest;
  return {
    title: row.title.trim(),
    description: row.description,
    category_id: row.category_id,
    amount: null,
    estimated_cost_min: row.estimated_cost_min,
    estimated_cost_max: row.estimated_cost_max,
    priority: row.priority,
    is_recurring: row.is_recurring ?? false,
    recurrence_frequency: row.recurrence_frequency,
    usage_count: group.count,
    last_used_at: group.lastUsedAt,
  };
}

export function buildQuickAddSuggestionsFromExpenses(
  expenses: Expense[]
): { recent: BudgetQuickAddSuggestion[]; popular: BudgetQuickAddSuggestion[] } {
  const groups = groupByTitle(expenses, (row) => row.title, (row) => row.created_at);
  return buildLists(groups, expenseToSuggestion);
}

export function buildQuickAddSuggestionsFromPlanned(
  items: BudgetItem[]
): { recent: BudgetQuickAddSuggestion[]; popular: BudgetQuickAddSuggestion[] } {
  const active = items.filter((item) => item.status !== 'cancelled');
  const groups = groupByTitle(active, (row) => row.title, (row) => row.created_at);
  return buildLists(groups, plannedToSuggestion);
}

function buildLists<T>(
  groups: TitleGroup<T>[],
  toSuggestion: (group: TitleGroup<T>) => BudgetQuickAddSuggestion
): { recent: BudgetQuickAddSuggestion[]; popular: BudgetQuickAddSuggestion[] } {
  const recent = [...groups]
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, RECENT_LIMIT)
    .map(toSuggestion);

  const recentKeys = new Set(recent.map((item) => normalizeTitle(item.title)));

  const popular = [...groups]
    .filter((group) => !recentKeys.has(group.key))
    .sort((a, b) => b.count - a.count || b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, POPULAR_LIMIT)
    .map(toSuggestion);

  return { recent, popular };
}
