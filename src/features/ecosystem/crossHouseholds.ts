import axios from 'axios';

import type { Household } from '@api/households';
import { createSpineClientHeaders, getPlatformSpineApiUrl } from '@api/platform-spine';
import { ENV } from '@config/env';
import { useAuthStore } from '@stores/authStore';

function budgetSpineApiUrl(): string {
  return ENV.IS_PRODUCTION
    ? 'https://simple-budget-api.a-tekhtelev.workers.dev'
    : 'https://simple-budget-api-staging.a-tekhtelev.workers.dev';
}

/** Platform-spine households for cross-app source selection. */
export async function fetchSpineHouseholds(): Promise<Household[]> {
  const token = useAuthStore.getState().token;
  if (!token) return [];
  const res = await axios.get<{ households: Household[] }>(
    `${getPlatformSpineApiUrl()}/households`,
    { headers: createSpineClientHeaders(token) }
  );
  return res.data.households ?? [];
}

/** Symply Budget households for House-side budget.summary source selection. */
export async function fetchBudgetHouseholds(): Promise<Household[]> {
  const token = useAuthStore.getState().token;
  if (!token) return [];
  const res = await axios.get<{ households: Household[] }>(`${budgetSpineApiUrl()}/households`, {
    headers: createSpineClientHeaders(token),
  });
  return res.data.households ?? [];
}
