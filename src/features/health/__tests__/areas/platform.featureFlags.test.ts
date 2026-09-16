/**
 * Symply Health — the per-feature toggle CONTRACT.
 *
 * Health ships eighteen trackers but opens with six on by default: Calories,
 * Weight, Workouts, Water, Foods and Recipes. Everything else is opt-in and
 * only an admin can turn it on (`users.role === 'admin'`, migration 0135).
 *
 * The rule that actually protects a common user is not the hidden menu row — it
 * is `resolveHealthFeature` ignoring stored overrides for a non-admin. These
 * tests drive that resolver, the catalog↔brand-pool agreement, and every
 * surface that consumes the resolved map (tab pool, Home cards, Home rings,
 * Home tiles, the jump grid), because each one is a separate place the gate
 * could be forgotten.
 *
 * `@brand` is NOT flipped to Health here: the catalog is asserted against the
 * Health brand file loaded directly, so the rest of the mobile suite keeps its
 * House baseline (see mobile-test-house-baseline).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- brand.cjs is CJS, loaded directly to avoid flipping APP_BRAND for the whole suite */

import {
  HEALTH_FEATURES,
  HEALTH_FEATURE_DEFAULTS,
  HEALTH_FEATURE_KEYS,
  healthFeatureForRoute,
  visibleGlanceKeys,
  visibleHomeRingKeys,
  visibleHomeSections,
  visibleHomeWidgets,
  type HealthFeatureKey,
} from '@config/healthFeatures';
import { filterTabsByHealthFeatures } from '@navigation/useEffectiveTabs';
import { resolveHealthFeature, resolveHealthFeatures } from '@stores/healthFeatureStore';

const healthBrand = require('../../../../../brands/symply-health/brand.cjs');

const CORE_KEYS: HealthFeatureKey[] = ['calories', 'weight', 'workouts', 'water', 'foods', 'recipes'];

/** Routes in the pool that deliberately belong to no feature. */
const UNOWNED_POOL_ROUTES = ['index', 'settings', 'health-goals'];

const allOn = (): Record<HealthFeatureKey, boolean> =>
  Object.fromEntries(HEALTH_FEATURE_KEYS.map((k) => [k, true])) as Record<
    HealthFeatureKey,
    boolean
  >;

describe('HEALTH-FLAG — defaults', () => {
  it('HEALTH-FLAG-001 enables exactly calories, weight, workouts, water, foods and recipes', () => {
    const on = HEALTH_FEATURE_KEYS.filter((k) => HEALTH_FEATURE_DEFAULTS[k]);
    expect(on.sort()).toEqual([...CORE_KEYS].sort());
  });

  it('HEALTH-FLAG-002 leaves every other tracker off by default', () => {
    const off = HEALTH_FEATURE_KEYS.filter((k) => !HEALTH_FEATURE_DEFAULTS[k]);
    // Nothing optional may sneak into the default install.
    expect(off).not.toHaveLength(0);
    for (const key of off) expect(CORE_KEYS).not.toContain(key);
  });

  it('HEALTH-FLAG-003 gives every catalog entry a label, description and icon', () => {
    for (const feature of HEALTH_FEATURES) {
      expect(feature.label.trim()).not.toHaveLength(0);
      expect(feature.description.trim()).not.toHaveLength(0);
      expect(feature.icon.trim()).not.toHaveLength(0);
    }
  });

  it('HEALTH-FLAG-004 has no duplicate keys and no route owned twice', () => {
    expect(new Set(HEALTH_FEATURE_KEYS).size).toBe(HEALTH_FEATURE_KEYS.length);
    const routes = HEALTH_FEATURES.flatMap((f) => f.routes);
    expect(new Set(routes).size).toBe(routes.length);
  });
});

describe('HEALTH-FLAG — catalog ↔ brand tab pool', () => {
  const poolRoutes: string[] = healthBrand.tabs.map((t: { route: string }) => t.route);

  it('HEALTH-FLAG-010 owns every route it claims (catalog → pool)', () => {
    for (const feature of HEALTH_FEATURES) {
      for (const route of feature.routes) {
        expect(poolRoutes).toContain(route);
      }
    }
  });

  it('HEALTH-FLAG-011 leaves no health tab unowned (pool → catalog)', () => {
    // A new tab added to brand.cjs without a catalog entry would ship
    // ungated — visible to every common user. This is the test that catches it.
    const unowned = poolRoutes.filter(
      (route) => !UNOWNED_POOL_ROUTES.includes(route) && healthFeatureForRoute(route) === null,
    );
    expect(unowned).toEqual([]);
  });

  it('HEALTH-FLAG-012 keeps the shell and the goals editor unowned', () => {
    for (const route of UNOWNED_POOL_ROUTES) {
      expect(healthFeatureForRoute(route)).toBeNull();
    }
  });
});

describe('HEALTH-FLAG — resolver / admin gate', () => {
  it('HEALTH-FLAG-020 gives a common user the defaults', () => {
    for (const key of HEALTH_FEATURE_KEYS) {
      expect(resolveHealthFeature({ overrides: {} }, key, false)).toBe(
        HEALTH_FEATURE_DEFAULTS[key],
      );
    }
  });

  it('HEALTH-FLAG-021 IGNORES stored overrides for a common user', () => {
    // The core protection: a stale override left by an admin who signed out, or
    // a hand-edited AsyncStorage blob, must not widen a common user's app.
    const overrides = { coach: true, cycle: true, scan: true };
    expect(resolveHealthFeature({ overrides }, 'coach', false)).toBe(false);
    expect(resolveHealthFeature({ overrides }, 'cycle', false)).toBe(false);
    expect(resolveHealthFeature({ overrides }, 'scan', false)).toBe(false);
  });

  it('HEALTH-FLAG-022 cannot have a core tracker switched off for a common user', () => {
    const overrides = { calories: false, weight: false, workouts: false, water: false };
    for (const key of CORE_KEYS) {
      expect(resolveHealthFeature({ overrides }, key, false)).toBe(true);
    }
  });

  it('HEALTH-FLAG-023 honours overrides for an admin, in both directions', () => {
    expect(resolveHealthFeature({ overrides: { coach: true } }, 'coach', true)).toBe(true);
    expect(resolveHealthFeature({ overrides: { weight: false } }, 'weight', true)).toBe(false);
  });

  it('HEALTH-FLAG-024 falls back to the default for a key an admin never touched', () => {
    expect(resolveHealthFeature({ overrides: { coach: true } }, 'habits', true)).toBe(false);
    expect(resolveHealthFeature({ overrides: { coach: true } }, 'calories', true)).toBe(true);
  });

  it('HEALTH-FLAG-025 resolves the whole map with one entry per catalog key', () => {
    const map = resolveHealthFeatures({ overrides: {} }, false);
    expect(Object.keys(map).sort()).toEqual([...HEALTH_FEATURE_KEYS].sort());
  });
});

describe('HEALTH-FLAG — tab pool filtering', () => {
  const pool = healthBrand.tabs.map((t: { route: string }) => ({ ...t }));

  it('HEALTH-FLAG-030 leaves a common user Home, Weight, Nutrition, Activity, Water, Foods, Recipes, Goals and More', () => {
    const features = resolveHealthFeatures({ overrides: {} }, false);
    const routes = filterTabsByHealthFeatures(pool, features).map((t) => t.route);

    expect(routes).toEqual([
      'index',
      'health-weight',
      'health-nutrition',
      'health-activity',
      'health-water',
      'health-food',
      'health-recipes',
      'health-goals',
      'settings',
    ]);
  });

  it('HEALTH-FLAG-031 drops every optional tab for a common user', () => {
    const features = resolveHealthFeatures({ overrides: {} }, false);
    const routes = filterTabsByHealthFeatures(pool, features).map((t) => t.route);

    for (const route of [
      'health-trends',
      'health-body',
      'health-habits',
      'health-cycle',
      'health-vitality',
      'health-fridge',
      'health-exercises',
      'health-injuries',
      'health-coach',
      'health-scan',
      'health-files',
    ]) {
      expect(routes).not.toContain(route);
    }
  });

  it('HEALTH-FLAG-032 restores a tab once an admin switches its feature on', () => {
    const features = resolveHealthFeatures({ overrides: { cycle: true } }, true);
    const routes = filterTabsByHealthFeatures(pool, features).map((t) => t.route);
    expect(routes).toContain('health-cycle');
    expect(routes).not.toContain('health-coach');
  });

  it('HEALTH-FLAG-033 never drops the locked shell tabs', () => {
    const nothingOn = Object.fromEntries(
      HEALTH_FEATURE_KEYS.map((k) => [k, false]),
    ) as Record<HealthFeatureKey, boolean>;
    const routes = filterTabsByHealthFeatures(pool, nothingOn).map((t) => t.route);
    expect(routes).toEqual(['index', 'health-goals', 'settings']);
  });

  it('HEALTH-FLAG-034 is a no-op for another brand’s pool', () => {
    const budgetPool = [
      { route: 'index' },
      { route: 'planning' },
      { route: 'spending' },
      { route: 'settings' },
    ];
    const nothingOn = Object.fromEntries(
      HEALTH_FEATURE_KEYS.map((k) => [k, false]),
    ) as Record<HealthFeatureKey, boolean>;
    expect(filterTabsByHealthFeatures(budgetPool as never, nothingOn)).toHaveLength(4);
  });
});

describe('HEALTH-FLAG — Home surfaces', () => {
  const DEFAULT_WIDGETS = ['today', 'glance', 'sleep', 'water', 'note', 'recent', 'sections'];

  it('HEALTH-FLAG-040 hides the sleep card for a common user, keeps water', () => {
    const features = resolveHealthFeatures({ overrides: {} }, false);
    const shown = visibleHomeWidgets(DEFAULT_WIDGETS, features);

    expect(shown).not.toContain('sleep');
    expect(shown).toEqual(expect.arrayContaining(['water', 'today']));
    // `glance` is Habits + Body only now (water owns a full card of its own,
    // not a tile) — both are opt-in and off by default for a common user, so
    // the composite correctly has nothing left to show and drops out too.
    expect(shown).not.toContain('glance');
  });

  it('HEALTH-FLAG-041 keeps the unconditional cards whatever is off', () => {
    const nothingOn = Object.fromEntries(
      HEALTH_FEATURE_KEYS.map((k) => [k, false]),
    ) as Record<HealthFeatureKey, boolean>;
    const shown = visibleHomeWidgets(DEFAULT_WIDGETS, nothingOn);
    expect(shown).toEqual(['note', 'recent', 'sections']);
  });

  it('HEALTH-FLAG-042 drops the composite cards only when they would be empty', () => {
    // "Today" survives on workouts alone (steps + move), and dies with calories
    // AND workouts off.
    expect(visibleHomeWidgets(['today'], { ...allOn(), calories: false })).toEqual(['today']);
    expect(
      visibleHomeWidgets(['today'], { ...allOn(), calories: false, workouts: false }),
    ).toEqual([]);

    expect(
      visibleHomeWidgets(['glance'], {
        ...allOn(),
        water: false,
        weight: false,
        habits: false,
        body: false,
      }),
    ).toEqual([]);
  });

  it('HEALTH-FLAG-043 preserves the admin’s stored card ORDER while filtering', () => {
    const custom = ['water', 'note', 'weight', 'today'];
    const features = resolveHealthFeatures({ overrides: {} }, false);
    expect(visibleHomeWidgets(custom, features)).toEqual(['water', 'note', 'weight', 'today']);
  });

  it('HEALTH-FLAG-044 filters the Today rings by their owning feature', () => {
    expect(visibleHomeRingKeys(allOn()).sort()).toEqual(['calories', 'move', 'steps']);
    expect(visibleHomeRingKeys({ ...allOn(), workouts: false })).toEqual(['calories']);
    expect(visibleHomeRingKeys({ ...allOn(), calories: false }).sort()).toEqual(['move', 'steps']);
  });

  it('HEALTH-FLAG-045 the at-a-glance tiles are Habits + Body only — empty for a common user, both once switched on', () => {
    // Water owns a full card on Home; the glance grid is not a second,
    // smaller copy of it. Habits and Body are the two trackers with no card
    // of their own, and both are admin opt-ins off by default — a common
    // user with neither switched on correctly sees no tiles at all.
    const features = resolveHealthFeatures({ overrides: {} }, false);
    expect(visibleGlanceKeys(features)).toEqual([]);

    expect(visibleGlanceKeys(allOn()).sort()).toEqual(['body', 'habits']);
  });

  it('HEALTH-FLAG-046 filters the Sections jump grid by each link’s route', () => {
    const sections = [
      { route: '/health-nutrition' },
      { route: '/health-activity' },
      { route: '/health-trends' },
      { route: '/health-weight' },
      { route: '/health-body' },
      { route: '/health-habits' },
    ];
    const features = resolveHealthFeatures({ overrides: {} }, false);
    expect(visibleHomeSections(sections, features).map((s) => s.route)).toEqual([
      '/health-nutrition',
      '/health-activity',
      '/health-weight',
    ]);
  });

  it('HEALTH-FLAG-047 keeps a section link whose route belongs to no feature', () => {
    const nothingOn = Object.fromEntries(
      HEALTH_FEATURE_KEYS.map((k) => [k, false]),
    ) as Record<HealthFeatureKey, boolean>;
    expect(visibleHomeSections([{ route: '/health-goals' }], nothingOn)).toHaveLength(1);
  });
});
