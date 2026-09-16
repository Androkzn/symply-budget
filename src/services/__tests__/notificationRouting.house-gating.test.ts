/**
 * House-domain notification taps must not open House screens in a child app.
 *
 * `notificationVisibility.ts` hides these types from a child app's notification
 * list, but a tapped push (or a crafted deep link) still flows through
 * `routeNotificationTap`. In a non-House brand (Budget, Kaizen, …) the handler
 * must redirect to home ('/') instead of pushing a House screen the app no
 * longer surfaces; in the House app it must still route to the real screen.
 *
 * `expo-router` and `@services/navigation` are globally stubbed in jest.setup.js;
 * we assert on the shared `router.push` mock. `@brand` is pinned per test so we
 * exercise both the House and non-House branches from one file.
 */

type RouteFn = (
  data: Record<string, unknown>,
  options?: { beforeNavigate?: () => void },
) => boolean;

/** Reload `routeNotificationTap` with `isHouseBrand()` pinned to `isHouse`. */
function loadRouter(isHouse: boolean): { route: RouteFn; push: jest.Mock } {
  let route!: RouteFn;
  let push!: jest.Mock;
  jest.isolateModules(() => {
    jest.doMock('@brand', () => ({
      __esModule: true,
      isHouseBrand: () => isHouse,
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reload under jest.isolateModules with the per-brand @brand mock
    route = require('../notificationRouting').routeNotificationTap;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- same isolate scope → same stubbed router instance the module imported
    push = require('expo-router').router.push as jest.Mock;
  });
  return { route, push };
}

/** One representative tap for each House-domain type + legacy `screen` value. */
const HOUSE_TAPS: Array<Record<string, unknown>> = [
  { type: 'aihousekeeper_briefing', date: '2026-01-02' },
  { type: 'task_reminder', taskId: 't1' },
  { type: 'task_overdue', taskId: 't2' },
  { type: 'task_drafts_ready', reportId: 'r1' },
  { type: 'task_draft_detail', draftId: 'd1' },
  { type: 'maintenance_suggestions', reportId: 'r2' },
  { type: 'report_ready', reportId: 'r3', householdId: 'h3' },
  { type: 'critical_findings', reportId: 'r4', householdId: 'h4' },
  { type: 'garbage_collection' },
  { type: 'garden_plan_ready', garden_plan_id: 'g1' },
  { type: 'garden_plan_failed' },
  { screen: 'TaskDetail', taskId: 't5' },
  { screen: 'ReportDetail', reportId: 'r5', householdId: 'h5' },
];

describe('routeNotificationTap — House-domain gating in child apps', () => {
  beforeEach(() => jest.clearAllMocks());

  it('redirects every House-domain tap to home for a non-House brand', () => {
    for (const data of HOUSE_TAPS) {
      const { route, push } = loadRouter(false);
      const handled = route(data);
      expect(handled).toBe(true);
      expect(push).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith('/');
    }
  });

  it('still routes a House tap to its real screen in the House app', () => {
    const { route, push } = loadRouter(true);
    expect(route({ type: 'aihousekeeper_briefing', date: '2026-01-02' })).toBe(true);
    expect(push).toHaveBeenCalledWith('/briefing/2026-01-02');
    // House must NOT be bounced to home by the child-app guard.
    expect(push).not.toHaveBeenCalledWith('/');
  });

  it('leaves non-House payloads for the normal handlers (guard is scoped)', () => {
    const { route, push } = loadRouter(false);
    // An unrecognized type is not House-domain: the guard ignores it and the
    // function falls through to `return false` without touching the router.
    expect(route({ type: 'not_a_house_type' })).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  // `ai_disconnected` is an ecosystem-wide type (BYOK ships in every brand), so
  // it must open the reconnect hub in BOTH House and child apps — never be
  // bounced to home by the House-domain guard.
  it.each([true, false])(
    'routes an ai_disconnected tap to the reconnect hub (isHouse=%s)',
    (isHouse) => {
      const { route, push } = loadRouter(isHouse);
      expect(route({ type: 'ai_disconnected', provider: 'anthropic' })).toBe(true);
      expect(push).toHaveBeenCalledWith('/ai-access/manage');
      expect(push).not.toHaveBeenCalledWith('/');
    }
  );
});

export {};
