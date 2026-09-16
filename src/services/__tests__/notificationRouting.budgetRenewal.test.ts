/**
 * Renewal reminder taps (Monthly Payments — condo/car insurance, warranties,
 * memberships, licenses; Budget-only) route to Savings' Monthly Payments list,
 * the same `navigateToBudget('BudgetMain', { activeView: 'savings' })` call
 * `savings_pace` already uses — landing on the list rather than deep-linking
 * into the specific item, since the row's "Renews in N days" pill makes the
 * right item obvious.
 *
 * `@services/navigation` is globally stubbed in jest.setup.js;
 * `@features/budget` is pinned per test to flip `isBudgetOff`/`isFullBudget`.
 */

type RouteFn = (
  data: Record<string, unknown>,
  options?: { beforeNavigate?: () => void }
) => boolean;

function loadRouter(budgetOff: boolean): { route: RouteFn; navigateToBudget: jest.Mock } {
  let route!: RouteFn;
  let navigateToBudget!: jest.Mock;
  jest.isolateModules(() => {
    jest.doMock('@features/budget', () => ({
      __esModule: true,
      isBudgetOff: () => budgetOff,
      isFullBudget: () => !budgetOff,
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reload under jest.isolateModules with the per-brand @features/budget mock
    route = require('../notificationRouting').routeNotificationTap;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- same isolate scope → same stubbed navigateToBudget the module imported
    navigateToBudget = require('@services/navigation').navigateToBudget as jest.Mock;
  });
  return { route, navigateToBudget };
}

describe('routeNotificationTap — budget_renewal_reminder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens Savings on the Monthly Payments list when full-budget', () => {
    const { route, navigateToBudget } = loadRouter(false);
    expect(
      route({ type: 'budget_renewal_reminder', householdId: 'h-1', recurringPaymentId: 'rp-1', renewalId: 'ren-1' })
    ).toBe(true);
    expect(navigateToBudget).toHaveBeenCalledWith('BudgetMain', { activeView: 'savings' });
  });

  it('omits the savings activeView when budget is off (minimal Budget brand)', () => {
    const { route, navigateToBudget } = loadRouter(true);
    expect(route({ type: 'budget_renewal_reminder', householdId: 'h-1' })).toBe(true);
    expect(navigateToBudget).toHaveBeenCalledWith('BudgetMain', undefined);
  });
});

export {};
