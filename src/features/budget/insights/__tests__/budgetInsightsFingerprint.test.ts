/**
 * The fingerprint is the whole regeneration policy in one function: what it
 * folds in costs a model call when it moves, what it leaves out never does.
 */
import type { MonthlyOverview } from '@api/budget';

import { budgetInsightsFingerprint } from '../budgetInsightsFingerprint';

function overviewWith(overrides: Partial<MonthlyOverview> = {}): MonthlyOverview {
  return {
    plannedBudget: 200_000,
    actualSpent: 45_000,
    committedTotal: 2_748,
    remainingBudget: 152_252,
    savedTotal: 0,
    expenses: [],
    items: [],
    subBudgets: { entries: [], totalCapCents: 0, plannedBudget: 200_000, overAllocatedBy: 0 },
    ...overrides,
  } as unknown as MonthlyOverview;
}

const expense = (id: string, amount: number, category: string | null = 'cat-1') =>
  ({ id, amount, category_id: category, saved_amount: 0 }) as MonthlyOverview['expenses'][number];

describe('budgetInsightsFingerprint', () => {
  it('is stable for the same month — the case that must not regenerate', () => {
    const a = overviewWith({ expenses: [expense('e1', 1_000), expense('e2', 2_000)] });
    const b = overviewWith({ expenses: [expense('e1', 1_000), expense('e2', 2_000)] });
    expect(budgetInsightsFingerprint(a)).toBe(budgetInsightsFingerprint(b));
  });

  it('ignores row order — neither transport promises one', () => {
    const ordered = overviewWith({ expenses: [expense('e1', 1_000), expense('e2', 2_000)] });
    const shuffled = overviewWith({ expenses: [expense('e2', 2_000), expense('e1', 1_000)] });
    expect(budgetInsightsFingerprint(ordered)).toBe(budgetInsightsFingerprint(shuffled));
  });

  it.each([
    ['a new expense', { expenses: [expense('e1', 1_000), expense('e2', 500)] }],
    ['an edited amount', { expenses: [expense('e1', 1_200)] }],
    ['a changed month total', { actualSpent: 46_000 }],
    ['a changed budget', { plannedBudget: 250_000 }],
    ['a new commitment', { committedTotal: 5_000 }],
    ['a recategorized expense', { expenses: [expense('e1', 1_000, 'cat-2')] }],
  ])('changes when the month does: %s', (_label, overrides) => {
    const before = overviewWith({ expenses: [expense('e1', 1_000)] });
    const after = overviewWith({ expenses: [expense('e1', 1_000)], ...overrides });
    expect(budgetInsightsFingerprint(after)).not.toBe(budgetInsightsFingerprint(before));
  });

  it('does not change for cosmetics the prompt never sees', () => {
    const base = overviewWith({ expenses: [expense('e1', 1_000)] });
    const retitled = overviewWith({
      expenses: [
        { ...expense('e1', 1_000), title: 'Beer', vendor: 'Corner store' } as MonthlyOverview['expenses'][number],
      ],
    });
    expect(budgetInsightsFingerprint(retitled)).toBe(budgetInsightsFingerprint(base));
  });

  it('follows sub-budget caps and planned items', () => {
    const base = overviewWith();
    const capped = overviewWith({
      subBudgets: {
        entries: [{ category_id: 'cat-1', cap_cents: 50_000, spent_cents: 10_000 }],
        totalCapCents: 50_000,
        plannedBudget: 200_000,
        overAllocatedBy: 0,
      } as unknown as MonthlyOverview['subBudgets'],
    });
    expect(budgetInsightsFingerprint(capped)).not.toBe(budgetInsightsFingerprint(base));
  });
});
