/**
 * isBudgetApiEnabled — full money product gate (Budget Worker only).
 */
import { describe, it, expect } from 'vitest';

import type { Env } from '../../types';
import { isBudgetApiEnabled } from '../budget-api';

const mkEnv = (brand: string, budgetFlag?: string): Env =>
  ({ APP_BRAND: brand, BUDGET_API_ENABLED: budgetFlag } as unknown as Env);

describe('isBudgetApiEnabled', () => {
  it('is off on House when BUDGET_API_ENABLED=false', () => {
    expect(isBudgetApiEnabled(mkEnv('symply-house', 'false'))).toBe(false);
  });

  it('is on on Budget Worker when flag true or unset', () => {
    expect(isBudgetApiEnabled(mkEnv('symply-budget', 'true'))).toBe(true);
    expect(isBudgetApiEnabled(mkEnv('symply-budget'))).toBe(true);
  });

  it('is off on non-full-budget brands even when flag is true', () => {
    expect(isBudgetApiEnabled(mkEnv('symply-kaizen', 'true'))).toBe(false);
    expect(isBudgetApiEnabled(mkEnv('symply-house', 'true'))).toBe(false);
  });

  it("treats explicit 'false' as off on Budget Worker", () => {
    expect(isBudgetApiEnabled(mkEnv('symply-budget', 'false'))).toBe(false);
  });
});
