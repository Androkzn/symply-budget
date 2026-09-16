/**
 * Mortgage notification taps route to the Mortgage tab (Budget-only). Both the
 * renewal reminder and the monthly "upload your statement" reminder share one
 * branch: open '/mortgage' when full-budget, else bounce to '/' (the tab wrapper
 * redirects too, but the handler shouldn't push a screen the brand hides).
 *
 * `expo-router` + `@services/navigation` are globally stubbed in jest.setup.js;
 * `@features/budget` is pinned per test to flip `isBudgetOff`.
 */

type RouteFn = (
  data: Record<string, unknown>,
  options?: { beforeNavigate?: () => void },
) => boolean;

/** Reload `routeNotificationTap` with `isBudgetOff()` pinned. */
function loadRouter(budgetOff: boolean): { route: RouteFn; push: jest.Mock } {
  let route!: RouteFn;
  let push!: jest.Mock;
  jest.isolateModules(() => {
    jest.doMock('@features/budget', () => ({
      __esModule: true,
      isBudgetOff: () => budgetOff,
      isFullBudget: () => !budgetOff,
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reload under jest.isolateModules with the per-brand @features/budget mock
    route = require('../notificationRouting').routeNotificationTap;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- same isolate scope → same stubbed router instance the module imported
    push = require('expo-router').router.push as jest.Mock;
  });
  return { route, push };
}

describe('routeNotificationTap — mortgage reminders', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['mortgage_statement_reminder', 'mortgage_renewal'])(
    'opens the Mortgage tab for a %s tap when budget is on',
    (type) => {
      const { route, push } = loadRouter(false);
      expect(route({ type, mortgageId: 'm-1', householdId: 'h-1' })).toBe(true);
      expect(push).toHaveBeenCalledWith('/mortgage');
    }
  );

  it('bounces the statement-reminder tap to home when budget is off', () => {
    const { route, push } = loadRouter(true);
    expect(route({ type: 'mortgage_statement_reminder', mortgageId: 'm-1' })).toBe(true);
    expect(push).toHaveBeenCalledWith('/');
    expect(push).not.toHaveBeenCalledWith('/mortgage');
  });
});

export {};
