/**
 * Budget → App Group snapshot contracts for the iOS widget and Apple Watch.
 *
 * These tests pin the cross-language contract with two Swift files that cannot
 * import them:
 *   - ios/SymplyEcosystemWidget/SymplyBudgetWidgetContent.swift  (BudgetSummary)
 *   - ios/SymplyEcosystemWatch/Views/SymplyBudgetWatchView.swift (BudgetToday)
 *
 * Matrix: BUDGET-WIDGET-001…005, BUDGET-WATCH-001…006.
 */
import type { MonthlyOverview } from '@api/budget';

import {
  BUDGET_WATCH_KEY,
  BUDGET_WIDGET_KEY,
  buildBudgetWatchSnapshot,
  buildBudgetWidgetSnapshot,
  publishBudgetSnapshots,
} from '../budgetSnapshot';

jest.mock('@services/widget-sync', () => ({
  widgetSync: { setSnapshot: jest.fn() },
}));

 
const { widgetSync } = require('@services/widget-sync') as {
  widgetSync: { setSnapshot: jest.Mock };
};

/** Minimal overview with only the fields the snapshots read. */
function overview(partial: Partial<MonthlyOverview> = {}): MonthlyOverview {
  return {
    plannedBudget: 500000,
    actualSpent: 200000,
    remainingBudget: 300000,
    committedTotal: 0,
    ...partial,
  } as MonthlyOverview;
}

beforeEach(() => {
  widgetSync.setSnapshot.mockClear();
});

describe('widget snapshot', () => {
  it('BUDGET-WIDGET-002: uses the exact snake_case keys BudgetSummary decodes', () => {
    const snap = buildBudgetWidgetSnapshot(overview(), {
      periodLabel: 'Jul 2026',
      currency: 'USD',
    });

    // `.convertFromSnakeCase` means a camelCase key silently decodes to nil.
    expect(Object.keys(snap).sort()).toEqual(
      ['budget_cents', 'currency', 'period_label', 'remaining_cents', 'spent_cents'].sort()
    );
  });

  it('BUDGET-WIDGET-003: publishes integer cents, not major units', () => {
    const snap = buildBudgetWidgetSnapshot(
      overview({ remainingBudget: 123456, actualSpent: 7899, plannedBudget: 131355 })
    );

    // BudgetFormat.money(_ cents: Int) divides by 100 itself.
    expect(snap.remaining_cents).toBe(123456);
    expect(snap.spent_cents).toBe(7899);
    expect(snap.budget_cents).toBe(131355);
    expect(Number.isInteger(snap.remaining_cents)).toBe(true);
  });

  it('BUDGET-WIDGET-003: rounds fractional cents to an integer', () => {
    const snap = buildBudgetWidgetSnapshot(overview({ remainingBudget: 100.6 }));
    expect(snap.remaining_cents).toBe(101);
  });

  it('BUDGET-WIDGET-002: omits optional fields rather than emitting undefined', () => {
    const snap = buildBudgetWidgetSnapshot(overview());
    expect('currency' in snap).toBe(false);
    expect('next_bill' in snap).toBe(false);
    expect('top_category' in snap).toBe(false);
  });

  it('BUDGET-WIDGET-002: nests next_bill with a snake_case amount', () => {
    const snap = buildBudgetWidgetSnapshot(overview(), {
      nextBill: { name: 'Hydro', amountCents: 8250, due: '2026-08-01' },
    });
    expect(snap.next_bill).toEqual({ name: 'Hydro', amount_cents: 8250, due: '2026-08-01' });
  });

  it('BUDGET-WIDGET-005: period_label follows the selected month', () => {
    const snap = buildBudgetWidgetSnapshot(overview(), { periodLabel: 'Aug 2026' });
    expect(snap.period_label).toBe('Aug 2026');
  });

  it('BUDGET-WIDGET-017: publishes savings as integer cents, rounded', () => {
    const snap = buildBudgetWidgetSnapshot(overview(), {
      savingsCurrentCents: 4200.4,
      savingsPreviousCents: 3150,
    });
    expect(snap.savings_cents).toBe(4200);
    expect(snap.savings_prev_cents).toBe(3150);
  });

  it('BUDGET-WIDGET-017: omits savings fields when not provided', () => {
    const snap = buildBudgetWidgetSnapshot(overview());
    expect('savings_cents' in snap).toBe(false);
    expect('savings_prev_cents' in snap).toBe(false);
  });

  it('BUDGET-WIDGET-017: a genuinely zero savings figure still publishes (not omitted)', () => {
    // `!= null` (not truthiness) is required here — `0` must survive, unlike
    // the falsy-guarded string fields below.
    const snap = buildBudgetWidgetSnapshot(overview(), { savingsCurrentCents: 0 });
    expect(snap.savings_cents).toBe(0);
  });

  it('publishes the projected year-end figure as integer cents, rounded, omitted when absent', () => {
    const withValue = buildBudgetWidgetSnapshot(overview(), { projectedYearEndCents: 4_200_000.4 });
    expect(withValue.projected_year_end_cents).toBe(4_200_000);

    const withoutValue = buildBudgetWidgetSnapshot(overview());
    expect('projected_year_end_cents' in withoutValue).toBe(false);
  });

  it('BUDGET-WIDGET-018: publishes the AI insight tone/message/emoji verbatim', () => {
    const snap = buildBudgetWidgetSnapshot(overview(), {
      insightTone: 'celebrate',
      insightMessage: "You're $80 ahead of last month.",
      insightEmoji: '🎉',
    });
    expect(snap.insight_tone).toBe('celebrate');
    expect(snap.insight_message).toBe("You're $80 ahead of last month.");
    expect(snap.insight_emoji).toBe('🎉');
  });

  it('BUDGET-WIDGET-018: omits insight fields when there is no encouragement yet', () => {
    const snap = buildBudgetWidgetSnapshot(overview());
    expect('insight_tone' in snap).toBe(false);
    expect('insight_message' in snap).toBe(false);
    expect('insight_emoji' in snap).toBe(false);
  });
});

describe('watch snapshot', () => {
  it('BUDGET-WATCH-002: uses the exact keys BudgetToday CodingKeys declares', () => {
    const snap = buildBudgetWatchSnapshot(overview(), {
      periodLabel: 'Jul 2026',
      currency: 'CAD',
      nextBill: { name: 'Rent', amountCents: 180000, due: '2026-08-01' },
    });

    // BudgetToday has NO key strategy — bare money keys, snake_case for the rest.
    expect(Object.keys(snap).sort()).toEqual(
      [
        'budget',
        'currency_code',
        'next_bill_amount',
        'next_bill_due',
        'next_bill_name',
        'period_label',
        'remaining',
        'spent',
      ].sort()
    );
  });

  it('BUDGET-WATCH-003: publishes major units, unlike the widget', () => {
    const ov = overview({ remainingBudget: 123456, actualSpent: 7899, plannedBudget: 131355 });

    const watch = buildBudgetWatchSnapshot(ov);
    const widget = buildBudgetWidgetSnapshot(ov);

    // SymplyBudgetWatchView.currency(_ value:) formats the number directly.
    expect(watch.remaining).toBe(1234.56);
    expect(watch.spent).toBe(78.99);
    expect(watch.budget).toBe(1313.55);

    // The divergence between the two surfaces is deliberate.
    expect(watch.remaining).not.toBe(widget.remaining_cents);
    expect(watch.remaining * 100).toBeCloseTo(widget.remaining_cents, 6);
  });

  it('BUDGET-WATCH-004: preserves a negative remaining so the watch can show "Over budget"', () => {
    const snap = buildBudgetWatchSnapshot(
      overview({ plannedBudget: 100000, actualSpent: 150000, remainingBudget: -50000 })
    );

    // Clamping to zero here would hide the over-budget state entirely.
    expect(snap.remaining).toBe(-500);
    expect(snap.remaining).toBeLessThan(0);
  });

  it('BUDGET-WATCH-005: omits next-bill fields when there is no next bill', () => {
    const snap = buildBudgetWatchSnapshot(overview(), { nextBill: null });
    expect('next_bill_name' in snap).toBe(false);
    expect('next_bill_amount' in snap).toBe(false);
    expect('next_bill_due' in snap).toBe(false);
  });

  it('BUDGET-WATCH-005: emits an undated next bill without a due key', () => {
    const snap = buildBudgetWatchSnapshot(overview(), {
      nextBill: { name: 'Internet', amountCents: 9000 },
    });
    expect(snap.next_bill_name).toBe('Internet');
    expect(snap.next_bill_amount).toBe(90);
    expect('next_bill_due' in snap).toBe(false);
  });

  it('publishes the projected year-end figure in major units, omitted when absent', () => {
    const withValue = buildBudgetWatchSnapshot(overview(), { projectedYearEndCents: 4_200_050 });
    expect(withValue.projected_year_end).toBe(42_000.5);

    const withoutValue = buildBudgetWatchSnapshot(overview());
    expect('projected_year_end' in withoutValue).toBe(false);
  });

  it('BUDGET-WATCH-003: rounds to 2dp so JSON carries no float noise', () => {
    const snap = buildBudgetWatchSnapshot(overview({ remainingBudget: 3333 }));
    expect(snap.remaining).toBe(33.33);
    expect(JSON.stringify(snap)).not.toMatch(/\d\.\d{3,}/);
  });
});

describe('publishing', () => {
  it('BUDGET-WIDGET-001 / BUDGET-WATCH-001: writes both App Group keys', () => {
    publishBudgetSnapshots(overview(), { periodLabel: 'Jul 2026' });

    const keys = widgetSync.setSnapshot.mock.calls.map((c) => c[0]);
    expect(keys).toEqual([BUDGET_WIDGET_KEY, BUDGET_WATCH_KEY]);
    expect(BUDGET_WIDGET_KEY).toBe('widget_budget_summary');
    expect(BUDGET_WATCH_KEY).toBe('watch_budget_today');
  });

  it('BUDGET-WIDGET-001: the two payloads are not interchangeable', () => {
    publishBudgetSnapshots(overview({ remainingBudget: 123456 }));

    const [, widgetPayload] = widgetSync.setSnapshot.mock.calls[0];
    const [, watchPayload] = widgetSync.setSnapshot.mock.calls[1];

    expect(widgetPayload).toHaveProperty('remaining_cents', 123456);
    expect(watchPayload).toHaveProperty('remaining', 1234.56);
    expect(widgetPayload).not.toHaveProperty('remaining');
    expect(watchPayload).not.toHaveProperty('remaining_cents');
  });

  it('BUDGET-WIDGET-004 / BUDGET-WATCH-006: a zeroed overview still publishes real zeros', () => {
    // A genuinely zero budget is distinct from "not loaded yet" — the null guard
    // lives in the hook (see the useBudgetSnapshotPublisher tests), not here.
    publishBudgetSnapshots(overview({ plannedBudget: 0, actualSpent: 0, remainingBudget: 0 }));

    const [, widgetPayload] = widgetSync.setSnapshot.mock.calls[0];
    expect(widgetPayload).toMatchObject({
      remaining_cents: 0,
      spent_cents: 0,
      budget_cents: 0,
    });
  });
});
