/**
 * House home-enrolment notifications — the four moments when the next move
 * belongs to somebody on another phone.
 *
 * All four arrive as the shared `household_update` type and are told apart by
 * `data.updateType`, so this pins the routing key rather than the type: a tap on
 * "someone is waiting to join" that landed anywhere but Invite & home would make
 * the notification useless, since approving is the only thing the owner can do
 * about it and it happens nowhere else.
 *
 * **Both vocabularies.** The `budget_*` names shipped first and the shared `/v2`
 * routes sent them to every brand, House included; the Worker now picks
 * `house_*` per brand. A House device may hold notification rows in either
 * spelling — an older row, or a Worker that has not been redeployed — and both
 * are House's own events on a House bundle, so both must route here. That is
 * also why the House branch is checked BEFORE Budget's in `routeNotificationTap`
 * and guarded on the brand: on a Budget bundle this branch never runs.
 *
 * The signal bump is asserted alongside the navigation because the hub is very
 * often ALREADY open — the owner reads the push while looking at the screen it
 * refers to — and in that case navigating changes nothing on its own.
 */

// Makes this file a MODULE rather than a script. Without it `RouteFn` and
// `EVENTS` land in the global scope TypeScript shares across every import-less
// test file, and collide with the identically-named locals in the sibling
// routing suites — errors about this file that are really about all of them.
export {};

type RouteFn = (
  data: Record<string, unknown>,
  options?: { beforeNavigate?: () => void },
) => boolean;

function loadRouter(houseBrand: boolean): {
  route: RouteFn;
  navigateToHouseInvite: jest.Mock;
  navigateToBudgetInvite: jest.Mock;
  revision: () => number;
} {
  let route!: RouteFn;
  let navigateToHouseInvite!: jest.Mock;
  let navigateToBudgetInvite!: jest.Mock;
  let revision!: () => number;
  jest.isolateModules(() => {
    jest.doMock('@brand', () => ({
      __esModule: true,
      isHouseBrand: () => houseBrand,
      isHealthCapableBrand: () => false,
    }));
    jest.doMock('@features/budget', () => ({
      __esModule: true,
      isBudgetOff: () => true,
      isFullBudget: () => false,
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reload under jest.isolateModules with the per-brand mocks
    route = require('../notificationRouting').routeNotificationTap;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- same isolate scope → the stubbed helpers the module imported
    const nav = require('@services/navigation');
    navigateToHouseInvite = nav.navigateToHouseInvite as jest.Mock;
    navigateToBudgetInvite = nav.navigateToBudgetInvite as jest.Mock;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- same isolate scope → the store instance the module bumped
    const store = require('@features/house/local/enrolmentSignal').useHouseEnrolmentSignal;
    revision = () => store.getState().revision;
  });
  return { route, navigateToHouseInvite, navigateToBudgetInvite, revision };
}

/** Both spellings of the same four events — see the header. */
const EVENTS = [
  'house_join_request_received',
  'house_join_approved',
  'house_invite_revoked',
  'house_invite_expired',
  'budget_join_request_received',
  'budget_join_approved',
  'budget_invite_revoked',
  'budget_invite_expired',
];

describe('routeNotificationTap — house invite lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(EVENTS)('sends %s to Invite & home', (updateType) => {
    const { route, navigateToHouseInvite } = loadRouter(true);
    expect(route({ type: 'household_update', updateType, householdId: 'hh_1' })).toBe(true);
    expect(navigateToHouseInvite).toHaveBeenCalledTimes(1);
  });

  it('routes on the screen hint too, for a payload that carries no updateType', () => {
    const { route, navigateToHouseInvite } = loadRouter(true);
    expect(route({ type: 'household_update', screen: 'HouseInvite' })).toBe(true);
    expect(navigateToHouseInvite).toHaveBeenCalledTimes(1);
  });

  it('nudges an already-open hub to re-read the control plane', () => {
    const { route, revision } = loadRouter(true);
    const before = revision();
    route({ type: 'household_update', updateType: 'house_join_request_received' });
    expect(revision()).toBe(before + 1);
  });

  it('claims the budget_* spelling before the Budget branch can, on a House bundle', () => {
    const { route, navigateToHouseInvite, navigateToBudgetInvite } = loadRouter(true);
    route({
      type: 'household_update',
      // The `screen` the shared Worker still stamps. It names a Budget route
      // that a House bundle does not host, so following it would land the tap
      // nowhere at all.
      screen: 'BudgetInvite',
      updateType: 'budget_join_request_received',
    });
    expect(navigateToHouseInvite).toHaveBeenCalledTimes(1);
    expect(navigateToBudgetInvite).not.toHaveBeenCalled();
  });

  it('does not claim anything on a bundle that is not House', () => {
    const { route, navigateToHouseInvite } = loadRouter(false);
    route({ type: 'household_update', updateType: 'house_join_request_received' });
    expect(navigateToHouseInvite).not.toHaveBeenCalled();
  });

  it("leaves House's older server-side membership vocabulary alone", () => {
    // `join_request_received` is the legacy shared-invite flow on a different
    // screen. The two must not collide.
    const { route, navigateToHouseInvite } = loadRouter(true);
    route({ type: 'household_update', updateType: 'join_request_received', householdId: 'hh_1' });
    expect(navigateToHouseInvite).not.toHaveBeenCalled();
  });
});
