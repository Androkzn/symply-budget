/**
 * Unit coverage for the quick-add payload/formatting helpers. These are pure
 * (no RN), so they render deterministically without a renderer.
 */
import type { BudgetQuickAddSuggestion } from '@api/budget';

import {
  buildPlannedCreatePayload,
  buildSpentCreatePayload,
  expenseDateForQuickAdd,
  formatQuickAddAmount,
  mergeQuickAddSuggestions,
  plannedTargetDateForQuickAdd,
  resolveReceiptExpenseDate,
} from '../budgetQuickAddHelpers';

function makeSuggestion(
  overrides: Partial<BudgetQuickAddSuggestion> = {}
): BudgetQuickAddSuggestion {
  return {
    title: 'Netflix',
    description: null,
    category_id: null,
    amount: null,
    estimated_cost_min: null,
    estimated_cost_max: null,
    priority: null,
    is_recurring: false,
    recurrence_frequency: null,
    usage_count: 1,
    last_used_at: '2026-07-10T00:00:00Z',
    ...overrides,
  };
}

describe('mergeQuickAddSuggestions', () => {
  it('folds recent and popular into one list, recent first', () => {
    const merged = mergeQuickAddSuggestions(
      [makeSuggestion({ title: 'Coffee', amount: 800 })],
      [makeSuggestion({ title: 'Beer', amount: 1200 }), makeSuggestion({ title: 'Wine', amount: 2000 })]
    );
    expect(merged.map((s) => s.title)).toEqual(['Coffee', 'Beer', 'Wine']);
  });

  it('dedupes by title, case- and whitespace-insensitively, keeping the recent row', () => {
    const recent = makeSuggestion({ title: 'Coffee', amount: 800 });
    const merged = mergeQuickAddSuggestions(
      [recent],
      [makeSuggestion({ title: ' coffee ', amount: 700 }), makeSuggestion({ title: 'COFFEE', amount: 600 })]
    );
    expect(merged).toEqual([recent]);
  });

  it('drops blank titles and tolerates empty inputs', () => {
    expect(mergeQuickAddSuggestions([], [])).toEqual([]);
    expect(mergeQuickAddSuggestions([makeSuggestion({ title: '   ' })], [])).toEqual([]);
  });
});

describe('formatQuickAddAmount — spent', () => {
  it('returns null when there is no positive amount', () => {
    expect(formatQuickAddAmount(makeSuggestion({ amount: null }), 'spent')).toBeNull();
    expect(formatQuickAddAmount(makeSuggestion({ amount: 0 }), 'spent')).toBeNull();
    expect(formatQuickAddAmount(makeSuggestion({ amount: -100 }), 'spent')).toBeNull();
  });

  it('formats whole grouped dollars, never a "k" abbreviation', () => {
    expect(formatQuickAddAmount(makeSuggestion({ amount: 1600 }), 'spent')).toBe('$16');
    expect(formatQuickAddAmount(makeSuggestion({ amount: 250000 }), 'spent')).toBe('$2,500');
  });
});

describe('formatQuickAddAmount — planned', () => {
  it('returns null when both estimates are missing', () => {
    expect(formatQuickAddAmount(makeSuggestion(), 'planned')).toBeNull();
  });

  it('formats a single estimate when min === max (or max missing)', () => {
    expect(
      formatQuickAddAmount(
        makeSuggestion({ estimated_cost_min: 4000, estimated_cost_max: 4000 }),
        'planned'
      )
    ).toBe('$40');
    expect(
      formatQuickAddAmount(
        makeSuggestion({ estimated_cost_min: 150000, estimated_cost_max: null }),
        'planned'
      )
    ).toBe('$1,500');
  });

  it('formats a min-max range with the symbol on both bounds', () => {
    // Both bounds carry the "$" so a grouped range can't read as one number
    // ("$1,200-3,400" is ambiguous; "$1,200-$3,400" is not).
    expect(
      formatQuickAddAmount(
        makeSuggestion({ estimated_cost_min: 4000, estimated_cost_max: 8000 }),
        'planned'
      )
    ).toBe('$40-$80');
    expect(
      formatQuickAddAmount(
        makeSuggestion({ estimated_cost_min: 120000, estimated_cost_max: 340000 }),
        'planned'
      )
    ).toBe('$1,200-$3,400');
  });

  it('collapses to the single present bound when only max is set', () => {
    // min == null (but max present) → the (min ?? max) single-figure branch.
    expect(
      formatQuickAddAmount(
        makeSuggestion({ estimated_cost_min: null, estimated_cost_max: 8000 }),
        'planned'
      )
    ).toBe('$80');
  });
});

describe('date helpers', () => {
  it('returns YYYY-MM-DD strings clamped to the month', () => {
    expect(expenseDateForQuickAdd(2026, 7)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(plannedTargetDateForQuickAdd(2026, 7)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('clamps a future month to its first day for the expense date', () => {
    // A month far in the future clamps to that month's minimum (its 1st).
    expect(expenseDateForQuickAdd(2999, 1)).toBe('2999-01-01');
  });
});

describe('buildPlannedCreatePayload', () => {
  it('maps a recurring suggestion into a create-item payload', () => {
    const payload = buildPlannedCreatePayload(
      makeSuggestion({
        title: 'HVAC filter',
        description: 'Replace filter',
        category_id: 'cat-home',
        estimated_cost_min: 2000,
        estimated_cost_max: 3000,
        priority: 'high',
        is_recurring: true,
        recurrence_frequency: 'monthly',
      }),
      2026,
      7
    );

    expect(payload).toMatchObject({
      title: 'HVAC filter',
      description: 'Replace filter',
      category_id: 'cat-home',
      timeframe: 'immediate',
      priority: 'high',
      estimated_cost_min: 2000,
      estimated_cost_max: 3000,
      is_recurring: true,
      recurrence_frequency: 'monthly',
    });
    expect(payload.target_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('defaults priority to medium and omits recurrence when absent', () => {
    const payload = buildPlannedCreatePayload(makeSuggestion(), 2026, 7);
    expect(payload.priority).toBe('medium');
    expect(payload).not.toHaveProperty('recurrence_frequency');
  });
});

describe('buildSpentCreatePayload', () => {
  it('maps a suggestion into an add-expense payload', () => {
    const payload = buildSpentCreatePayload(
      makeSuggestion({ title: 'Groceries', amount: 5400, category_id: 'cat-food' }),
      2026,
      7
    );
    expect(payload).toMatchObject({
      title: 'Groceries',
      amount: 5400,
      category_id: 'cat-food',
    });
    expect(payload.expense_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('falls back to amount 0 when the suggestion has none', () => {
    expect(buildSpentCreatePayload(makeSuggestion({ amount: null }), 2026, 7).amount).toBe(0);
  });
});

describe('resolveReceiptExpenseDate', () => {
  const now = new Date('2026-07-15T12:00:00');

  it('trusts a recent, non-future receipt date', () => {
    expect(resolveReceiptExpenseDate('2026-07-03', 2026, 7, now)).toBe('2026-07-03');
  });

  it('trusts a date from a recent prior month even if viewing a later month', () => {
    expect(resolveReceiptExpenseDate('2026-06-30', 2026, 7, now)).toBe('2026-06-30');
  });

  it('rejects a stale sample-receipt year and falls back to the viewed month', () => {
    const resolved = resolveReceiptExpenseDate('2004-07-26', 2026, 7, now);
    expect(resolved).not.toBe('2004-07-26');
    expect(resolved).toMatch(/^2026-07-\d{2}$/);
  });

  it('rejects a future date and falls back to the viewed month', () => {
    const resolved = resolveReceiptExpenseDate('2027-01-01', 2026, 7, now);
    expect(resolved).toMatch(/^2026-07-\d{2}$/);
  });

  it('allows a one-day skew for timezone differences', () => {
    expect(resolveReceiptExpenseDate('2026-07-16', 2026, 7, now)).toBe('2026-07-16');
  });

  it('falls back when the date is missing or malformed', () => {
    expect(resolveReceiptExpenseDate(null, 2026, 7, now)).toMatch(/^2026-07-\d{2}$/);
    expect(resolveReceiptExpenseDate('', 2026, 7, now)).toMatch(/^2026-07-\d{2}$/);
    expect(resolveReceiptExpenseDate(undefined, 2026, 7, now)).toMatch(/^2026-07-\d{2}$/);
    expect(resolveReceiptExpenseDate('2026/07/03', 2026, 7, now)).toMatch(/^2026-07-\d{2}$/);
    expect(resolveReceiptExpenseDate('not-a-date', 2026, 7, now)).toMatch(/^2026-07-\d{2}$/);
    // A syntactically ISO but calendar-invalid date (NaN time) also falls back.
    expect(resolveReceiptExpenseDate('2026-13-40', 2026, 7, now)).toMatch(/^2026-07-\d{2}$/);
  });

  it('resolves against the real clock when "now" is omitted (default parameter)', () => {
    // Exercises the `now: Date = new Date()` default branch. A today-stamped ISO
    // date is recent + non-future, so it is trusted verbatim.
    const today = expenseDateForQuickAdd(
      new Date().getFullYear(),
      new Date().getMonth() + 1
    );
    expect(resolveReceiptExpenseDate(today, new Date().getFullYear(), new Date().getMonth() + 1)).toBe(
      today
    );
  });
});
