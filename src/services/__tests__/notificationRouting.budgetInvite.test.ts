/**
 * Household enrolment notifications — the four moments when the next move
 * belongs to somebody on another phone.
 *
 * All four arrive as the shared `household_update` type and are told apart by
 * `data.updateType`, so this pins the routing key rather than the type: a tap on
 * "someone is waiting to join" that landed anywhere but Invite & Household would
 * make the notification useless, since approving is the only thing the owner can
 * do about it and it happens nowhere else.
 *
 * The signal bump is asserted alongside the navigation because the screen is
 * very often ALREADY open — the owner reads the push while looking at the
 * screen it refers to — and in that case navigating changes nothing on its own.
 *
 * `@services/navigation` is globally stubbed in jest.setup.js; `@features/budget`
 * is pinned per test to flip `isBudgetOff`.
 */

type RouteFn = (
  data: Record<string, unknown>,
  options?: { beforeNavigate?: () => void }
) => boolean;

function loadRouter(budgetOff: boolean): {
  route: RouteFn;
  navigateToBudgetInvite: jest.Mock;
  revision: () => number;
} {
  let route!: RouteFn;
  let navigateToBudgetInvite!: jest.Mock;
  let revision!: () => number;
  jest.isolateModules(() => {
    jest.doMock('@features/budget', () => ({
      __esModule: true,
      isBudgetOff: () => budgetOff,
      isFullBudget: () => !budgetOff,
    }));
    /**
     * A BUDGET bundle, explicitly.
     *
     * The four `budget_*` update types are the shared Worker's original names
     * and reach every brand, so House claims them first and routes them to its
     * own hub (`notificationRouting.houseInvite.test.ts` pins that half). Under
     * Jest the default brand IS House, so without this the Budget branch is
     * simply unreachable and every case here would assert House's routing.
     *
     * Stubbed rather than spread over the real module: `@brand` resolves its
     * capability table at import time, and re-importing it inside
     * `isolateModules` leaves that table undefined.
     */
    jest.doMock('@brand', () => ({
      __esModule: true,
      isHouseBrand: () => false,
      isHealthCapableBrand: () => false,
    }));
    /**
     * A BUDGET bundle, explicitly.
     *
     * The four `budget_*` update types are the shared Worker's original names
     * and reach every brand, so House claims them first and routes them to its
     * own hub (`notificationRouting.houseInvite.test.ts` pins that half). Under
     * Jest the default brand IS House, so without this the Budget branch is
     * simply unreachable and every case here would assert House's routing.
     */
    jest.doMock('@brand', () => ({
      __esModule: true,
      // The two `notificationRouting` reads. Stubbed rather than spread over the
      // real module: `@brand` resolves its capabilities at import time, and
      // re-importing it inside `isolateModules` leaves that table undefined.
      isHouseBrand: () => false,
      isHealthCapableBrand: () => false,
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reload under jest.isolateModules with the per-brand @features/budget mock
    route = require('../notificationRouting').routeNotificationTap;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- same isolate scope → same stubbed helper the module imported
    navigateToBudgetInvite = require('@services/navigation').navigateToBudgetInvite as jest.Mock;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- same isolate scope → the store instance the module bumped
    const store = require('@features/budget/local/enrolmentSignal').useBudgetEnrolmentSignal;
    revision = () => store.getState().revision;
  });
  return { route, navigateToBudgetInvite, revision };
}

const EVENTS = [
  'budget_join_request_received',
  'budget_join_approved',
  'budget_invite_revoked',
  'budget_invite_expired',
];

describe('routeNotificationTap — budget invite lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(EVENTS)('sends %s to Invite & Household', (updateType) => {
    const { route, navigateToBudgetInvite } = loadRouter(false);
    expect(
      route({ type: 'household_update', screen: 'BudgetInvite', updateType, householdId: 'hh_1' })
    ).toBe(true);
    expect(navigateToBudgetInvite).toHaveBeenCalledTimes(1);
  });

  it('routes on updateType alone, without the screen hint', () => {
    // The screen key is a convenience; the vocabulary is the contract.
    const { route, navigateToBudgetInvite } = loadRouter(false);
    expect(
      route({ type: 'household_update', updateType: 'budget_join_request_received' })
    ).toBe(true);
    expect(navigateToBudgetInvite).toHaveBeenCalledTimes(1);
  });

  it('nudges an already-open screen to re-read the control plane', () => {
    // Navigating to a screen you are already on changes nothing — and the owner
    // reading "someone is waiting" is very often looking at it already.
    const { route, revision } = loadRouter(false);
    const before = revision();
    route({ type: 'household_update', updateType: 'budget_join_request_received' });
    expect(revision()).toBe(before + 1);
  });

  it('sends the tap home on a brand without Budget', () => {
    const { route, navigateToBudgetInvite } = loadRouter(true);
    expect(
      route({ type: 'household_update', updateType: 'budget_join_approved' })
    ).toBe(true);
    expect(navigateToBudgetInvite).not.toHaveBeenCalled();
  });

  it('leaves House membership payloads alone', () => {
    // `join_request_received` is House's own, older vocabulary for a different
    // flow on a different screen. The two must not collide.
    const { route, navigateToBudgetInvite } = loadRouter(false);
    route({ type: 'household_update', updateType: 'join_request_received', householdId: 'hh_1' });
    expect(navigateToBudgetInvite).not.toHaveBeenCalled();
  });
});

export {};
