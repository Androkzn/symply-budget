/**
 * home-budget API client — the lightweight Symply House money glance (distinct
 * from the full @api/budget Worker). Verifies each method hits the right
 * household-scoped path with year/month params and unwraps `res.data`.
 */
const mockGet = jest.fn();
jest.mock('@api/client', () => ({
  apiClient: { get: (...args: unknown[]) => mockGet(...args) },
}));

import type { MonthlyOverview } from '@api/budget';
import { homeBudgetApi, type HomeBudgetGlance } from '@api/home-budget';

beforeEach(() => mockGet.mockReset());

describe('homeBudgetApi.getMonthlyOverview', () => {
  it('GETs the household monthly-overview with year/month params and returns data', async () => {
    const overview = { plannedBudget: 100000 } as unknown as MonthlyOverview;
    mockGet.mockResolvedValue({ data: overview });

    const result = await homeBudgetApi.getMonthlyOverview('hh-9', 2026, 7);

    expect(mockGet).toHaveBeenCalledWith(
      '/households/hh-9/home-budget/monthly-overview',
      { params: { year: 2026, month: 7 } }
    );
    expect(result).toBe(overview);
  });

  it('propagates a rejected request', async () => {
    mockGet.mockRejectedValue(new Error('network'));
    await expect(homeBudgetApi.getMonthlyOverview('hh-9', 2026, 7)).rejects.toThrow('network');
  });
});

describe('homeBudgetApi.getGlance', () => {
  it('GETs the household glance with year/month params and returns data', async () => {
    const glance: HomeBudgetGlance = { year: 2026, month: 7, remaining: 300, planned: 1000, spent: 700 };
    mockGet.mockResolvedValue({ data: glance });

    const result = await homeBudgetApi.getGlance('hh-9', 2026, 7);

    expect(mockGet).toHaveBeenCalledWith(
      '/households/hh-9/home-budget/glance',
      { params: { year: 2026, month: 7 } }
    );
    expect(result).toEqual(glance);
  });
});
