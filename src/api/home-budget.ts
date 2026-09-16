/**
 * Symply House lightweight home-budget client.
 * Full money product uses `@api/budget` against the Symply Budget Worker.
 */
import type { MonthlyOverview } from './budget';
import { apiClient } from './client';

export interface HomeBudgetGlance {
  year: number;
  month: number;
  remaining: number;
  planned: number | null;
  spent: number;
}

export const homeBudgetApi = {
  getMonthlyOverview: (householdId: string, year: number, month: number) =>
    apiClient
      .get<MonthlyOverview>(`/households/${householdId}/home-budget/monthly-overview`, {
        params: { year, month },
      })
      .then((res) => res.data),

  getGlance: (householdId: string, year: number, month: number) =>
    apiClient
      .get<HomeBudgetGlance>(`/households/${householdId}/home-budget/glance`, {
        params: { year, month },
      })
      .then((res) => res.data),
};
