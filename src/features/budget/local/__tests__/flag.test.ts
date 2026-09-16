/**
 * Kill-switch drill — EXPO_PUBLIC_BUDGET_LOCAL_FIRST=0 must turn the local
 * path off even on the Budget brand (plan §1.6).
 */
describe('isBudgetLocalFirst kill switch', () => {
  const original = process.env.EXPO_PUBLIC_BUDGET_LOCAL_FIRST;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.EXPO_PUBLIC_BUDGET_LOCAL_FIRST;
    } else {
      process.env.EXPO_PUBLIC_BUDGET_LOCAL_FIRST = original;
    }
    jest.resetModules();
  });

  it('is off when EXPO_PUBLIC_BUDGET_LOCAL_FIRST=0', () => {
    process.env.EXPO_PUBLIC_BUDGET_LOCAL_FIRST = '0';
    jest.resetModules();
    const { isBudgetLocalFirst } = require('../flag') as typeof import('../flag');
    expect(isBudgetLocalFirst()).toBe(false);
  });

  it('is on when EXPO_PUBLIC_BUDGET_LOCAL_FIRST=1', () => {
    process.env.EXPO_PUBLIC_BUDGET_LOCAL_FIRST = '1';
    jest.resetModules();
    const { isBudgetLocalFirst } = require('../flag') as typeof import('../flag');
    expect(isBudgetLocalFirst()).toBe(true);
  });
});
