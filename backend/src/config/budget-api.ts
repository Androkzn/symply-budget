import type { Env } from '../types';

import { isFullBudget } from './brand-capabilities';

/** Full money product routes — Budget Worker only (BUDGET_API_ENABLED + brand capability). */
export function isBudgetApiEnabled(env: Env): boolean {
  return isFullBudget(env) && env.BUDGET_API_ENABLED !== 'false';
}
