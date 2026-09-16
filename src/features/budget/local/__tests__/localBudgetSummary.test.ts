import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import {
  buildLocalBudgetSummaryV1,
  toBudgetSummaryEnvelopePayload,
} from '../export/localBudgetSummary';
import { localBudgetApi } from '../localBudgetApi';

describe('localBudgetSummary', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-summary-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('buildLocalBudgetSummaryV1 aggregates month and YTD totals', async () => {
    const householdId = getLocalLedger().household.id;
    const { category } = await localBudgetApi.createCategory(householdId, { name: 'Food' });
    await localBudgetApi.addExpense(householdId, {
      title: 'Lunch',
      amount: 1500,
      expense_date: '2026-08-05',
      category_id: category.id,
    });
    await localBudgetApi.addExpense(householdId, {
      title: 'January',
      amount: 2000,
      expense_date: '2026-01-15',
      category_id: category.id,
    });

    const summary = buildLocalBudgetSummaryV1({
      year: 2026,
      month: 8,
      exportedAt: '2026-08-10T12:00:00.000Z',
    });

    expect(summary.format).toBe('budget.summary.v1');
    expect(summary.monthTotal).toBe(1500);
    expect(summary.ytdTotal).toBe(3500);
    expect(summary.topCategories[0]).toEqual({ name: 'Food', total: 1500 });
  });

  it('toBudgetSummaryEnvelopePayload keeps manifest fields only', () => {
    const summary = buildLocalBudgetSummaryV1({
      year: 2026,
      month: 8,
      exportedAt: '2026-08-10T12:00:00.000Z',
    });
    const envelope = toBudgetSummaryEnvelopePayload(summary);

    expect(Object.keys(envelope).sort()).toEqual([
      'currency',
      'monthTotal',
      'remaining',
      'topCategories',
      'ytdTotal',
    ]);
    expect(envelope.currency).toBe(summary.currency);
    expect(envelope.monthTotal).toBe(summary.monthTotal);
  });
});
