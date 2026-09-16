import { describe, it, expect } from 'vitest';

import type { BudgetItem, Expense } from '../../db/schema-budget';
import {
  buildQuickAddSuggestionsFromExpenses,
  buildQuickAddSuggestionsFromPlanned,
} from '../budget-quick-add';

const NOW = '2026-07-10T12:00:00Z';
const EARLIER = '2026-07-01T12:00:00Z';

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: crypto.randomUUID(),
    household_id: 'hh-1',
    category_id: null,
    budget_item_id: null,
    title: 'Groceries',
    description: null,
    amount: 3200,
    saved_amount: 0,
    tax_amount: 0,
    deposit_amount: 0,
    expense_date: '2026-07-10',
    vendor: null,
    receipt_key: null,
    source: 'manual',
    import_batch_id: null,
    created_by: null,
    created_at: NOW,
    ...overrides,
  };
}

function makePlanned(overrides: Partial<BudgetItem> = {}): BudgetItem {
  return {
    id: crypto.randomUUID(),
    household_id: 'hh-1',
    category_id: null,
    horizon: 'short_term',
    timeframe: 'immediate',
    year: 2026,
    quarter: null,
    title: 'Water filter',
    description: null,
    estimated_cost_min: 4000,
    estimated_cost_max: 4000,
    actual_cost: null,
    priority: 'medium',
    status: 'planned',
    is_recurring: false,
    recurrence_frequency: null,
    source_type: null,
    source_id: null,
    target_date: '2026-07-15',
    completed_at: null,
    created_by: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('budget-quick-add', () => {
  it('groups recent expenses by title and keeps the latest amount', () => {
    const { recent } = buildQuickAddSuggestionsFromExpenses([
      makeExpense({ title: 'Groceries', amount: 2500, created_at: EARLIER }),
      makeExpense({ title: 'groceries', amount: 3200, created_at: NOW }),
    ]);

    expect(recent).toHaveLength(1);
    expect(recent[0]?.title).toBe('groceries');
    expect(recent[0]?.amount).toBe(3200);
    expect(recent[0]?.usage_count).toBe(2);
  });

  it('deduplicates popular from recent titles', () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, index) =>
        makeExpense({
          title: `Recent ${index}`,
          created_at: `2026-07-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
        })
      ),
      ...Array.from({ length: 5 }, () =>
        makeExpense({ title: 'Coffee', amount: 600, created_at: '2026-01-01T12:00:00Z' })
      ),
    ];

    const { recent, popular } = buildQuickAddSuggestionsFromExpenses(rows);

    expect(recent.length).toBeLessThanOrEqual(6);
    expect(popular.some((item) => item.title === 'Coffee')).toBe(true);
    expect(popular.every((item) => !recent.some((r) => r.title === item.title))).toBe(true);
  });

  it('ignores cancelled planned items', () => {
    const { recent } = buildQuickAddSuggestionsFromPlanned([
      makePlanned({ title: 'Old roof', status: 'cancelled' }),
      makePlanned({ title: 'Water filter', status: 'planned' }),
    ]);

    expect(recent).toHaveLength(1);
    expect(recent[0]?.title).toBe('Water filter');
  });
});
