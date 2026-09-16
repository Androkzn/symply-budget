import type { MonthlyOverview } from '@api/budget';

import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../../engine';
import { generateStructuredByok, resolveLocalByokProvider } from '../localByokClient';
import { __resetLocalInsightsCache, runLocalInsights } from '../localInsights';

jest.mock('../localByokClient', () => ({
  resolveLocalByokProvider: jest.fn(async () => null),
  generateStructuredByok: jest.fn(),
  byokLog: jest.fn(),
}));

const GOOD_RESULT = {
  summary: 'Groceries are running the month.',
  alerts: [{ severity: 'warning', message: 'Groceries are 49% of spending.' }],
  recommendations: ['Hold groceries under $1,200 next month.'],
  projected_month_end_balance: -12_500,
};

function overviewWith(overrides: Partial<MonthlyOverview> = {}): MonthlyOverview {
  return {
    plannedBudget: 300_000,
    actualSpent: 290_000,
    committedTotal: 40_000,
    remainingBudget: 10_000,
    savedTotal: 0,
    expenses: [],
    items: [],
    subBudgets: { entries: [], totalCapCents: 0, plannedBudget: 300_000, overAllocatedBy: 0 },
    ...overrides,
  } as unknown as MonthlyOverview;
}

describe('runLocalInsights', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-insights-1' });
    __resetLocalInsightsCache();
    jest.mocked(resolveLocalByokProvider).mockResolvedValue(null);
    jest.mocked(generateStructuredByok).mockReset();
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('throws unsupported when no provider key is connected', async () => {
    const householdId = getLocalLedger().household.id;
    await expect(
      runLocalInsights({ householdId, year: 2026, month: 8, overview: overviewWith() }),
    ).rejects.toMatchObject({ name: 'BudgetLocalUnsupportedError' });
    expect(generateStructuredByok).not.toHaveBeenCalled();
  });

  it('generates insights through the member key when one is connected', async () => {
    jest
      .mocked(resolveLocalByokProvider)
      .mockResolvedValue({ provider: 'anthropic', apiKey: 'sk-test', source: 'own' });
    jest.mocked(generateStructuredByok).mockResolvedValue(GOOD_RESULT);

    const ledger = getLocalLedger();
    const category = ledger.categories[0]!;
    const insights = await runLocalInsights({
      householdId: ledger.household.id,
      year: 2026,
      month: 8,
      overview: overviewWith({
        expenses: [
          { category_id: category.id, amount: 143_300 },
          { category_id: null, amount: 2_500 },
        ] as MonthlyOverview['expenses'],
      }),
    });

    expect(insights.summary).toBe(GOOD_RESULT.summary);
    expect(insights.alerts).toHaveLength(1);
    expect(insights.cached).toBe(false);
    expect(insights.generatedAt).toEqual(expect.any(String));

    const prompt = jest.mocked(generateStructuredByok).mock.calls[0]![0].userPrompt;
    // The month's real numbers, and the category split the backend would have
    // had from D1 — the model explains these rather than inventing any.
    expect(prompt).toContain('Month: 2026-08');
    expect(prompt).toContain('Planned budget: $3000.00');
    expect(prompt).toContain(`- ${category.name}: $1433.00`);
    expect(prompt).toContain('- Uncategorized: $25.00');
  });

  it('normalizes a malformed provider answer instead of crashing the card', async () => {
    jest
      .mocked(resolveLocalByokProvider)
      .mockResolvedValue({ provider: 'openai', apiKey: 'sk-test', source: 'own' });
    jest.mocked(generateStructuredByok).mockResolvedValue({
      summary: '  Doing fine.  ',
      alerts: [{ severity: 'nonsense', message: 'Watch groceries.' }, { message: '' }],
      recommendations: ['a', 'b', 'c', 'd'],
      projected_month_end_balance: 'not-a-number',
    });

    const insights = await runLocalInsights({
      householdId: getLocalLedger().household.id,
      year: 2026,
      month: 8,
      overview: overviewWith(),
    });

    expect(insights.summary).toBe('Doing fine.');
    expect(insights.alerts).toEqual([{ severity: 'info', message: 'Watch groceries.' }]);
    expect(insights.recommendations).toEqual(['a', 'b', 'c']);
    // Falls back to the locally computed balance rather than showing NaN.
    expect(insights.projected_month_end_balance).toBe(10_000);
  });

  it.each([
    { alerts: GOOD_RESULT.alerts, recommendations: [] },
    { alerts: [], recommendations: GOOD_RESULT.recommendations },
    { alerts: GOOD_RESULT.alerts, recommendations: GOOD_RESULT.recommendations },
  ])('preserves and caches useful partial insights without summary: %j', async (partial) => {
    jest.mocked(resolveLocalByokProvider).mockResolvedValue({ provider: 'anthropic', apiKey: 'test', source: 'own' });
    jest.mocked(generateStructuredByok).mockResolvedValue({ ...partial, summary: '   ', projected_month_end_balance: null });
    const input = { householdId: getLocalLedger().household.id, year: 2026, month: 8, overview: overviewWith() };
    const first = await runLocalInsights(input);
    expect(first.summary).toBe('');
    expect(first.alerts).toEqual(partial.alerts);
    expect(first.recommendations).toEqual(partial.recommendations);
    expect(first.projected_month_end_balance).toBe(10_000);
    expect((await runLocalInsights(input)).cached).toBe(true);
    expect(generateStructuredByok).toHaveBeenCalledTimes(1);
  });

  it('rejects a genuinely empty result and allows a later refresh to recover', async () => {
    jest.mocked(resolveLocalByokProvider).mockResolvedValue({ provider: 'anthropic', apiKey: 'test', source: 'own' });
    jest.mocked(generateStructuredByok).mockResolvedValueOnce({ summary: '', alerts: [{ message: ' ' }], recommendations: [' '] }).mockResolvedValueOnce(GOOD_RESULT);
    const input = { householdId: getLocalLedger().household.id, year: 2026, month: 8, overview: overviewWith() };
    await expect(runLocalInsights(input)).rejects.toThrow('no usable summary, alerts, or recommendations');
    expect((await runLocalInsights({ ...input, forceRefresh: true })).summary).toBe(GOOD_RESULT.summary);
    expect(generateStructuredByok).toHaveBeenCalledTimes(2);
  });

  // Parity with the remote transport, which stores an `input_hash` per period
  // and only re-asks when it moves. Here the bill lands on the MEMBER's key, so
  // the same rule matters more, not less.
  describe('cache', () => {
    beforeEach(() => {
      jest
        .mocked(resolveLocalByokProvider)
        .mockResolvedValue({ provider: 'anthropic', apiKey: 'sk-test', source: 'own' });
      jest.mocked(generateStructuredByok).mockResolvedValue(GOOD_RESULT);
    });

    it('answers an unchanged month from cache instead of the provider', async () => {
      const householdId = getLocalLedger().household.id;
      const args = { householdId, year: 2026, month: 8, overview: overviewWith() };

      const first = await runLocalInsights(args);
      const second = await runLocalInsights(args);

      expect(generateStructuredByok).toHaveBeenCalledTimes(1);
      expect(second.summary).toBe(first.summary);
      expect(second.cached).toBe(true);
    });

    it('re-asks when the month changed', async () => {
      const householdId = getLocalLedger().household.id;
      await runLocalInsights({ householdId, year: 2026, month: 8, overview: overviewWith() });
      await runLocalInsights({
        householdId,
        year: 2026,
        month: 8,
        overview: overviewWith({ actualSpent: 295_000 }),
      });

      expect(generateStructuredByok).toHaveBeenCalledTimes(2);
    });

    it('re-asks on an explicit refresh, unchanged or not', async () => {
      const householdId = getLocalLedger().household.id;
      const args = { householdId, year: 2026, month: 8, overview: overviewWith() };

      await runLocalInsights(args);
      const forced = await runLocalInsights({ ...args, forceRefresh: true });

      expect(generateStructuredByok).toHaveBeenCalledTimes(2);
      expect(forced.cached).toBe(false);
    });

    it('shares one provider call between callers that overlap', async () => {
      const householdId = getLocalLedger().household.id;
      const args = { householdId, year: 2026, month: 8, overview: overviewWith() };

      const [a, b] = await Promise.all([runLocalInsights(args), runLocalInsights(args)]);

      expect(generateStructuredByok).toHaveBeenCalledTimes(1);
      expect(a).toBe(b);
    });
  });

  it('surfaces a provider failure as itself, not as the no-key guard', async () => {
    jest
      .mocked(resolveLocalByokProvider)
      .mockResolvedValue({ provider: 'gemini', apiKey: 'sk-test', source: 'own' });
    jest
      .mocked(generateStructuredByok)
      .mockRejectedValue(new Error('gemini HTTP 401: invalid key'));

    await expect(
      runLocalInsights({
        householdId: getLocalLedger().household.id,
        year: 2026,
        month: 8,
        overview: overviewWith(),
      }),
    ).rejects.toThrow(/HTTP 401/);
  });
});
