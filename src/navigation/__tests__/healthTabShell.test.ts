/**
 * Symply Health tab shell — the brand pack's `tabs` pool as consumed by
 * `app/(tabs)/_layout.tsx` through the tab registry.
 *
 * Health ships the DONOR's five-tab bar (Swift `TabItem.defaultTabs` =
 * Dashboard / Meals / Weight / Workouts / More), mapped onto this brand's
 * sections: Health · Weight · Nutrition · Activity · More, with Trends, Body
 * and Habits parked in the "More" hub until the user pins them. Like every other Symply
 * app, Health opts into the customizable-tabs model, so this suite pins both
 * the pool AND the resolved bar.
 *
 * `brand` is module-scoped and baked at import time, so the Health pack is
 * injected through an isolated module registry rather than by flipping
 * APP_BRAND (which would also swap generated icon/token files — see
 * documents/engineering/testing).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- brand is module-scoped, so the registry must be isolated per case */

const healthBrand = require('../../../brands/symply-health/brand.cjs') as {
  id: string;
  tabs: Array<{
    route: string;
    icon: string;
    brandIcon?: string;
    label: string;
    sfSymbol?: string;
    defaultHidden?: boolean;
    locked?: boolean;
  }>;
  featureTabs: unknown[];
  customizableTabs?: boolean;
  maxVisibleTabs?: number;
  features: Record<string, unknown>;
};

type Registry = typeof import('../tabRegistry');
type Effective = typeof import('../useEffectiveTabs');

/** Load the tab registry with `brand` pinned to the Symply Health pack. */
function withHealthBrand<T>(run: (registry: Registry, effective: Effective) => T): T {
  let result!: T;
  jest.isolateModules(() => {
    jest.doMock('@brand', () => ({
      brand: healthBrand,
      brandId: healthBrand.id,
    }));
    result = run(require('../tabRegistry'), require('../useEffectiveTabs'));
  });
  return result;
}

const POOL_ROUTES = [
  'index',
  'health-weight',
  'health-nutrition',
  'health-activity',
  'health-trends',
  'health-body',
  'health-habits',
  'health-water',
  'health-cycle',
  'health-vitality',
  'health-food',
  'health-recipes',
  'health-fridge',
  'health-exercises',
  'health-injuries',
  'health-goals',
  // Parity phase P3 — the AI surfaces. Both `defaultHidden`: AI is opt-in for
  // this app, so neither may take a slot on the bar by default.
  'health-coach',
  'health-scan',
  'health-files',
  'settings',
];
const PINNED_ROUTES = [
  'index',
  'health-weight',
  'health-nutrition',
  'health-activity',
  'settings',
];
/** Every `defaultHidden` pool entry, in pool order — derived, not hard-coded:
 *  the Health pool is still growing and this list must not need editing for
 *  each new section. The explicit contract lives in POOL_ROUTES above. */
const OVERFLOW_ROUTES = healthBrand.tabs
  .filter((t) => t.defaultHidden)
  .map((t) => t.route);

afterEach(() => {
  jest.resetModules();
  jest.dontMock('@brand');
});

describe('Symply Health brand pack — tab pool', () => {
  it('HEALTH-TAB-020: declares the full donor-parity pool in order', () => {
    expect(healthBrand.tabs.map((t) => t.route)).toEqual(POOL_ROUTES);
    expect(healthBrand.tabs.map((t) => t.label)).toEqual([
      'Dashboard',
      'Weight',
      'Nutrition',
      'Activity',
      'Trends',
      'Body',
      'Habits',
      'Water',
      'Cycle',
      'Vitality',
      'Foods',
      'Recipes',
      'Fridge',
      'Workouts',
      'Injuries',
      'Goals',
      'Coach',
      'Scan',
      'Files',
      'More',
    ]);
  });

  it('HEALTH-TAB-021: ships no feature tabs — nothing can be injected into the bar', () => {
    expect(healthBrand.featureTabs).toEqual([]);
  });

  it('HEALTH-TAB-022: every tab carries the Symply Health icon-kit glyph', () => {
    const byRoute = new Map(healthBrand.tabs.map((t) => [t.route, t]));
    expect(byRoute.get('index')?.brandIcon).toBe('health-home');
    expect(byRoute.get('index')?.icon).toBe('heart');
    expect(byRoute.get('health-nutrition')?.brandIcon).toBe('nutrition-tab');
    expect(byRoute.get('health-activity')?.brandIcon).toBe('activity-tab');
    expect(byRoute.get('health-trends')?.brandIcon).toBe('trends-tab');
    expect(byRoute.get('health-body')?.brandIcon).toBe('body-measurements');
    expect(byRoute.get('health-habits')?.brandIcon).toBe('streak');
    expect(byRoute.get('health-cycle')?.brandIcon).toBe('cycle');
    expect(byRoute.get('health-vitality')?.brandIcon).toBe('recovery');
    expect(byRoute.get('health-food')?.brandIcon).toBe('food-search');
    expect(byRoute.get('health-recipes')?.brandIcon).toBe('recipe');
    expect(byRoute.get('health-fridge')?.brandIcon).toBe('meals');
    expect(byRoute.get('health-exercises')?.brandIcon).toBe('workout-library');
    expect(byRoute.get('health-injuries')?.brandIcon).toBe('symptoms');
    expect(byRoute.get('health-water')?.brandIcon).toBe('hydration');
    expect(byRoute.get('health-goals')?.brandIcon).toBe('goals');
    expect(byRoute.get('health-files')?.brandIcon).toBe('journal');
    expect(byRoute.get('settings')?.icon).toBe('ellipsis-horizontal');
  });

  it('HEALTH-TAB-023: pins no House/Budget/Kaizen/Language section tab', () => {
    const foreign = [
      'my-home',
      'tasks',
      'contractors',
      'reports',
      'chat',
      'utilities',
      'gardening',
      'mira',
      'budget',
      'planning',
      'spending',
      'savings',
      'pension',
      'bills',
      'wishes',
      'mortgage',
      'kaizen-assess',
      'kaizen-career',
      'kaizen-learn',
      'kaizen-systems',
      'language-assessment',
      'language-dialogue',
      'language-plan',
      'language-review',
    ];
    const routes = healthBrand.tabs.map((t) => t.route);
    for (const route of foreign) {
      expect(routes).not.toContain(route);
    }
  });

  it('HEALTH-TAB-031: opts into the customizable-tabs model with a 5-slot bar', () => {
    expect(healthBrand.customizableTabs).toBe(true);
    expect(healthBrand.maxVisibleTabs).toBe(5);
    // Home + More can never be removed by a customization override.
    const byRoute = new Map(healthBrand.tabs.map((t) => [t.route, t]));
    expect(byRoute.get('index')?.locked).toBe(true);
    expect(byRoute.get('settings')?.locked).toBe(true);
    // Body + Habits start parked in the More hub (donor: available, not default).
    for (const route of [
      'health-trends',
      'health-body',
      'health-habits',
      'health-water',
      'health-cycle',
      'health-vitality',
      // Parity P2 sections — the bar is full, so both start in More.
      'health-food',
      'health-recipes',
      'health-fridge',
      // Workout library — the donor exercise catalogue.
      'health-exercises',
      // Injury log — the write half of the library's safety gate.
      'health-injuries',
      // Goals editor + the files locker.
      'health-goals',
      'health-files',
      // P3 AI surfaces — the coach and the label/meal scanner.
      'health-coach',
      'health-scan',
    ]) {
      expect(byRoute.get(route)?.defaultHidden).toBe(true);
    }
    // Exactly four tabs ride the bar by default (+ the locked More slot) — the
    // donor's `TabItem.defaultTabs` count, whatever else joins the pool.
    expect(healthBrand.tabs.filter((t) => !t.defaultHidden)).toHaveLength(5);
  });
});

describe('Symply Health — tab registry resolution', () => {
  it('HEALTH-TAB-024: buildTabConfig returns the whole pool regardless of the tasks feature', () => {
    withHealthBrand((registry) => {
      for (const showTasks of [true, false]) {
        expect(registry.buildTabConfig({ showTasks }).map((t) => t.route)).toEqual(POOL_ROUTES);
      }
    });
  });

  it('HEALTH-TAB-025: lands on the first pool tab (Dashboard)', () => {
    withHealthBrand((registry) => {
      expect(registry.getInitialTabRoute()).toBe('index');
    });
  });

  it('HEALTH-TAB-026: every pool route is a brand tab route, foreign ones are not', () => {
    withHealthBrand((registry) => {
      for (const route of POOL_ROUTES) {
        expect(registry.isBrandTabRoute(route)).toBe(true);
      }
      for (const route of ['tasks', 'budget', 'my-home', 'chat', 'kaizen-learn']) {
        expect(registry.isBrandTabRoute(route)).toBe(false);
      }
    });
  });

  it('HEALTH-TAB-027: hrefs exist for the pool; everything else stays reachable with href null', () => {
    withHealthBrand((registry) => {
      const opts = { showTasks: true };
      expect(registry.getTabScreenHref('index', opts)).toBe('/');
      expect(registry.getTabScreenHref('settings', opts)).toBe('/settings');
      expect(registry.getTabScreenHref('health-nutrition', opts)).toBe('/health-nutrition');
      expect(registry.getTabScreenHref('health-habits', opts)).toBe('/health-habits');
      // Health still pushes /notifications + /profile from the header, so those
      // routes must stay registered — just hidden from the bar.
      for (const route of ['notifications', 'profile', 'tasks', 'budget'] as const) {
        expect(registry.getTabScreenHref(route, opts)).toBeNull();
      }
    });
  });

  it('HEALTH-TAB-028: uses the brand labels for pool tabs and defaults elsewhere', () => {
    withHealthBrand((registry) => {
      const opts = { showTasks: true };
      expect(registry.getTabScreenTitle('index', opts)).toBe('Dashboard');
      expect(registry.getTabScreenTitle('health-nutrition', opts)).toBe('Nutrition');
      expect(registry.getTabScreenTitle('health-activity', opts)).toBe('Activity');
      expect(registry.getTabScreenTitle('health-trends', opts)).toBe('Trends');
      expect(registry.getTabScreenTitle('settings', opts)).toBe('More');
      expect(registry.getTabScreenTitle('profile', opts)).toBe('Profile');
    });
  });

  it('HEALTH-TAB-032: each Health section route is registered so expo-router can mount it', () => {
    withHealthBrand((registry) => {
      const registered = registry.ROUTABLE_TAB_SCREENS.map((s) => s.route);
      for (const route of POOL_ROUTES) {
        expect(registered).toContain(route);
      }
    });
  });
});

describe('Symply Health — effective bottom bar', () => {
  it('HEALTH-TAB-029: pins five tabs with More last and overflows every defaultHidden section', () => {
    withHealthBrand((registry, effective) => {
      const pool = registry.buildTabConfig({ showTasks: false });
      const { pinned, overflow } = effective.resolveEffectiveTabs(pool, null, 5);
      expect(pinned.map((t) => t.route)).toEqual(PINNED_ROUTES);
      // Pool order is preserved in the hub, so an entry moved in brand.cjs shows
      // up here as a reordering rather than a silent pass.
      expect(overflow.map((t) => t.route)).toEqual(OVERFLOW_ROUTES);
      // Nothing is lost between the two lists.
      expect([...pinned, ...overflow]).toHaveLength(POOL_ROUTES.length);
    });
  });

  it('HEALTH-TAB-030: a stale customization override cannot hide a locked tab or add a foreign one', () => {
    withHealthBrand((registry, effective) => {
      const pool = registry.buildTabConfig({ showTasks: false });
      const { pinned, overflow } = effective.resolveEffectiveTabs(
        pool,
        [
          // Left over from another brand's customization — must be ignored.
          { route: 'budget', order: 0, visible: true },
          { route: 'index', order: 1, visible: false },
          { route: 'settings', order: 2, visible: true },
        ],
        5,
      );
      expect(pinned.map((t) => t.route)).not.toContain('budget');
      expect(overflow.map((t) => t.route)).not.toContain('budget');
      // `index` and `settings` are locked, so an override cannot drop them.
      expect(pinned).toContain(pool.find((t) => t.route === 'index'));
      expect(pinned.map((t) => t.route)).toContain('settings');
      expect([...pinned, ...overflow].map((t) => t.route).sort()).toEqual([...POOL_ROUTES].sort());
    });
  });

  it('HEALTH-TAB-033: pinning Habits pushes the lowest-priority section into More', () => {
    withHealthBrand((registry, effective) => {
      const pool = registry.buildTabConfig({ showTasks: false });
      const { pinned, overflow } = effective.resolveEffectiveTabs(
        pool,
        [
          { route: 'index', order: 0, visible: true },
          { route: 'health-habits', order: 1, visible: true },
          { route: 'health-nutrition', order: 2, visible: true },
          { route: 'health-activity', order: 3, visible: true },
          { route: 'health-trends', order: 4, visible: true },
          { route: 'health-body', order: 5, visible: false },
          { route: 'health-cycle', order: 6, visible: false },
          { route: 'health-vitality', order: 7, visible: false },
          { route: 'settings', order: 8, visible: true },
        ],
        5,
      );
      expect(pinned.map((t) => t.route)).toEqual([
        'index',
        'health-weight',
        'health-habits',
        'health-nutrition',
        'settings',
      ]);
      // Home carries an explicit order:0 override, which now wins outright —
      // Dashboard is the pool's first entry, so Weight's fallback (its own pool
      // position) is order:1, no longer a tie. Weight then ties health-habits'
      // explicit order:1 override; a stable sort keeps Weight ahead since it
      // appears earlier in the pool. Activity/Trends are visible but past the
      // 4-slot cap, so Activity HEADS the hub — overflowed-by-cap tabs come
      // before the ones that were never visible.
      const overflowRoutes = overflow.map((t) => t.route);
      expect(overflowRoutes[0]).toBe('health-activity');
      expect(overflowRoutes[1]).toBe('health-trends');
      // …and the rest of the hub is exactly the pool minus what got pinned.
      // Asserted as a SET: routes carrying an override sort by that override's
      // order, so the tail ordering is a function of this fixture, not a
      // contract, and spelling it out would break on every new pool entry.
      expect([...overflowRoutes].sort()).toEqual(
        [
          ...OVERFLOW_ROUTES.filter((r) => r !== 'health-habits' && r !== 'health-trends'),
          'health-activity',
          'health-trends',
        ].sort(),
      );
      expect(overflowRoutes).not.toContain('health-habits');
    });
  });
});

/**
 * Symply Health gates its own sections behind per-install FEATURE TOGGLES
 * (`src/config/healthFeatures.ts`): a common user gets the four core trackers
 * on and everything else off, and `useEffectiveTabs` filters the pool through
 * `filterTabsByHealthFeatures` BEFORE resolving the bar. The pool contracts
 * above describe what Health *ships*; these describe what a member actually
 * sees, which is what the Maestro flows have to assert on a device.
 *
 * The toggle store, the admin gate and the settings switchboard are covered by
 * their own suite — this block only pins the tab-shell consequence.
 */
describe('Symply Health — the feature-gated bar', () => {
  const ALL_ON = Object.fromEntries(
    require('../../config/healthFeatures').HEALTH_FEATURE_KEYS.map((k: string) => [k, true]),
  );
  const DEFAULTS = require('../../config/healthFeatures').HEALTH_FEATURE_DEFAULTS;

  it('HEALTH-TAB-045: a default install shows only the core trackers, in the bar AND the hub', () => {
    withHealthBrand((registry, effective) => {
      const pool = effective.filterTabsByHealthFeatures(
        registry.buildTabConfig({ showTasks: false }),
        DEFAULTS,
      );
      const { pinned, overflow } = effective.resolveEffectiveTabs(pool, null, 5);

      // Calories + Weight + Workouts are on by default and not `defaultHidden`,
      // so their tabs stay pinned. Trends is an opt-in companion (feature off),
      // so it is filtered out of the pool entirely, not just overflowed.
      expect(pinned.map((t) => t.route)).toEqual([
        'index',
        'health-weight',
        'health-nutrition',
        'health-activity',
        'settings',
      ]);
      // Water / Foods / Recipes are on but `defaultHidden`, and Goals belongs
      // to no feature, so those four make up the hub. Workout library is an
      // opt-in companion (feature off by default, like Trends), so it is
      // filtered out of the pool entirely, not just overflowed.
      expect(overflow.map((t) => t.route)).toEqual([
        'health-water',
        'health-food',
        'health-recipes',
        'health-goals',
      ]);

      // A disabled feature is gone from BOTH lists — hiding it from the bar
      // alone would leave it one tap away in More, which is not "off".
      const visible = [...pinned, ...overflow].map((t) => t.route);
      for (const route of [
        'health-trends',
        'health-body',
        'health-habits',
        'health-cycle',
        'health-vitality',
        'health-fridge',
        'health-injuries',
        'health-coach',
        'health-scan',
        'health-files',
      ]) {
        expect(visible).not.toContain(route);
      }
    });
  });

  it('HEALTH-TAB-046: with every feature on, the bar is the full donor-parity five', () => {
    withHealthBrand((registry, effective) => {
      const pool = effective.filterTabsByHealthFeatures(
        registry.buildTabConfig({ showTasks: false }),
        ALL_ON,
      );
      const { pinned, overflow } = effective.resolveEffectiveTabs(pool, null, 5);
      expect(pinned.map((t) => t.route)).toEqual(PINNED_ROUTES);
      expect(overflow.map((t) => t.route)).toEqual(OVERFLOW_ROUTES);
    });
  });

  it('HEALTH-TAB-047: Home, More and Goals belong to no feature and can never be gated away', () => {
    withHealthBrand((registry, effective) => {
      const allOff = Object.fromEntries(
        Object.keys(ALL_ON).map((k) => [k, false]),
      );
      const pool = effective.filterTabsByHealthFeatures(
        registry.buildTabConfig({ showTasks: false }),
        allOff,
      );
      expect(pool.map((t) => t.route)).toEqual(['index', 'health-goals', 'settings']);

      const { pinned, overflow } = effective.resolveEffectiveTabs(pool, null, 5);
      // The shell survives with everything switched off: Home pinned, More
      // last, and the goals editor still reachable from the hub.
      expect(pinned.map((t) => t.route)).toEqual(['index', 'settings']);
      expect(overflow.map((t) => t.route)).toEqual(['health-goals']);
    });
  });
});
