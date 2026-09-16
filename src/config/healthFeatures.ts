/**
 * Symply Health feature catalog (per-user toggles).
 *
 * This is the "which trackers does THIS user want?" switchboard, and it is a
 * different thing from `@config/features`:
 *
 *   - `FEATURE_DEFAULTS` (features.ts) is a DEVELOPER rollout switch, driven
 *     remotely — "has this shipped?". The user never sees it.
 *   - `HEALTH_FEATURES` (here) is a USER preference, stored per device/account
 *     — "do I want to track this?". Every entry is toggleable from
 *     More → Health features.
 *
 * Defaults: Health opens with six trackers on — Calories, Weight, Workouts,
 * Water, Foods and Recipes. Everything else the port shipped (Sleep, Trends,
 * Body, Habits, Cycle, Vitality, Fridge, Workout library, Injuries, Coach,
 * Scan, Files) starts OFF and is opted into from Settings, so a new user is
 * not handed eighteen tabs on day one. Turning a feature off hides its tab,
 * its Home surfaces and its More row, and makes its route un-navigable — it
 * never deletes logged data, so turning it back on restores the history
 * intact.
 *
 * Keep `routes` in sync with the pool in `brands/symply-health/brand.cjs`;
 * `healthFeatureFlags.test.ts` asserts the two agree in both directions.
 */

import type { BrandTabRoute } from '@brand';

export interface HealthFeatureDefinition {
  key: HealthFeatureKey;
  /** Row title in More → Health features. */
  label: string;
  /** One-line explanation of what turning it on adds. */
  description: string;
  /** Brand icon-kit key (see brands/symply-health icon kit). */
  icon: string;
  /** Enabled for a user who has never opened the settings screen. */
  enabledByDefault: boolean;
  /**
   * Tab routes this feature owns. Hidden from the bottom bar, the "More" hub
   * and the tab customizer while the feature is off. A feature with no routes
   * (Sleep) is a Home-screen surface only.
   */
  routes: readonly BrandTabRoute[];
}

/**
 * Ordered for the settings screen: the default-on trackers first, then the
 * opt-in companions grouped by the tracker they extend.
 */
export const HEALTH_FEATURES: readonly HealthFeatureDefinition[] = [
  // ---- On by default ------------------------------------------------------
  {
    key: 'calories',
    label: 'Calories & meals',
    description: 'Log meals and track calories and macros against a daily goal.',
    icon: 'nutrition-tab',
    enabledByDefault: true,
    routes: ['health-nutrition'],
  },
  {
    key: 'weight',
    label: 'Weight',
    description: 'Log your weight and follow the trend towards a goal.',
    icon: 'weight',
    enabledByDefault: true,
    routes: ['health-weight'],
  },
  {
    key: 'workouts',
    label: 'Workouts & activity',
    description: 'Log workouts and steps, and track your daily activity.',
    icon: 'activity-tab',
    enabledByDefault: true,
    routes: ['health-activity'],
  },
  {
    key: 'water',
    label: 'Water',
    description: 'Count your cups against a daily hydration target.',
    icon: 'hydration',
    enabledByDefault: true,
    routes: ['health-water'],
  },
  {
    key: 'foods',
    label: 'Food library',
    description: 'Search a food database and save your own foods.',
    icon: 'food-search',
    enabledByDefault: true,
    routes: ['health-food'],
  },
  {
    key: 'recipes',
    label: 'Recipes',
    description: 'Save recipes and log them as a meal in one tap.',
    icon: 'recipe',
    enabledByDefault: true,
    routes: ['health-recipes'],
  },

  // ---- Opt-in companions — off until switched on -------------------------
  {
    key: 'sleep',
    label: 'Sleep',
    description: 'Log how long you slept and track it against a nightly goal.',
    icon: 'sleep',
    enabledByDefault: false,
    // Home-surface only — sleep has a card on Home but no tab of its own.
    routes: [],
  },
  {
    key: 'trends',
    label: 'Trends',
    description: 'Charts and weekly summaries across everything you track.',
    icon: 'trends-tab',
    enabledByDefault: false,
    routes: ['health-trends'],
  },
  {
    key: 'body',
    label: 'Body measurements',
    description: 'Track waist, chest, arms and other sites over time.',
    icon: 'body-measurements',
    enabledByDefault: false,
    routes: ['health-body'],
  },
  {
    key: 'habits',
    label: 'Habits',
    description: 'Build daily habits and keep a streak going.',
    icon: 'streak',
    enabledByDefault: false,
    routes: ['health-habits'],
  },
  {
    key: 'cycle',
    label: 'Cycle tracking',
    description: 'Track your cycle, symptoms and predictions.',
    icon: 'cycle',
    enabledByDefault: false,
    routes: ['health-cycle'],
  },
  {
    key: 'vitality',
    label: 'Vitality',
    description: 'Track energy, recovery and related daily markers.',
    icon: 'recovery',
    enabledByDefault: false,
    routes: ['health-vitality'],
  },
  {
    key: 'fridge',
    label: 'Smart fridge',
    description: 'Keep track of what you have in stock and what expires soon.',
    icon: 'meals',
    enabledByDefault: false,
    routes: ['health-fridge'],
  },
  {
    key: 'workoutLibrary',
    label: 'Workout library',
    description: 'Browse a catalogue of exercises and log a session from it.',
    icon: 'workout-library',
    enabledByDefault: false,
    routes: ['health-exercises'],
  },
  {
    key: 'injuries',
    label: 'Injuries',
    description: 'Record injuries and pain so workouts can steer around them.',
    icon: 'symptoms',
    enabledByDefault: false,
    routes: ['health-injuries'],
  },
  {
    key: 'coach',
    label: 'AI coach',
    description: 'Ask an AI coach about your logs and get suggestions.',
    icon: 'ai-coach',
    enabledByDefault: false,
    routes: ['health-coach'],
  },
  {
    key: 'scan',
    label: 'Scan',
    description: 'Read nutrition labels, barcodes and food photos with the camera.',
    icon: 'barcode',
    enabledByDefault: false,
    // `routes` here is "catalog → POOL" only (see `HEALTH-FLAG-010`) — a
    // push-only sub-screen does not belong in it, same as `health-notifications`
    // / `health-widget` are absent despite being real routes. `health-barcode-scan`
    // is still gated on this feature: `app/(tabs)/health-barcode-scan.tsx` wraps
    // it in `<HealthFeatureRoute feature="scan">` directly.
    routes: ['health-scan'],
  },
  {
    key: 'files',
    label: 'Files',
    description: 'Keep lab results, scans and other health documents together.',
    icon: 'journal',
    enabledByDefault: false,
    routes: ['health-files'],
  },
] as const;

export type HealthFeatureKey =
  | 'calories'
  | 'weight'
  | 'workouts'
  | 'water'
  | 'sleep'
  | 'trends'
  | 'body'
  | 'habits'
  | 'cycle'
  | 'vitality'
  | 'foods'
  | 'recipes'
  | 'fridge'
  | 'workoutLibrary'
  | 'injuries'
  | 'coach'
  | 'scan'
  | 'files';

export const HEALTH_FEATURE_KEYS: readonly HealthFeatureKey[] = HEALTH_FEATURES.map((f) => f.key);

/** `{ calories: true, ..., scan: false }` — the state of a brand-new install. */
export const HEALTH_FEATURE_DEFAULTS: Record<HealthFeatureKey, boolean> = Object.fromEntries(
  HEALTH_FEATURES.map((f) => [f.key, f.enabledByDefault]),
) as Record<HealthFeatureKey, boolean>;

/**
 * Route → owning feature.
 *
 * Routes absent from this map belong to no feature and are ALWAYS available:
 * `index` (Home) and `settings` (More) are the shell, and `health-goals` is the
 * editor for the core trackers' own targets (calorie goal, step goal, weight
 * goal) — gating it behind an optional feature would strand a common user with
 * goals they cannot change.
 */
export const HEALTH_ROUTE_FEATURE: Readonly<Partial<Record<BrandTabRoute, HealthFeatureKey>>> =
  Object.fromEntries(
    HEALTH_FEATURES.flatMap((f) => f.routes.map((route) => [route, f.key])),
  ) as Partial<Record<BrandTabRoute, HealthFeatureKey>>;

export function healthFeatureForRoute(route: string): HealthFeatureKey | null {
  return HEALTH_ROUTE_FEATURE[route as BrandTabRoute] ?? null;
}

/**
 * Home widget key → the feature that must be on for the card to render.
 *
 * Keys absent from this map are unconditional: `note` (a private line about the
 * day) and `sections` / `recent`, which are *views over whatever is enabled* —
 * they filter their own contents below rather than disappearing wholesale.
 *
 * `today` and `glance` are composites — the rings and tiles inside them are
 * filtered individually by `visibleHomeRingKeys` / `visibleGlanceKeys`, and the
 * card itself only disappears once nothing is left to show in it.
 */
const HOME_WIDGET_FEATURE: Readonly<Record<string, HealthFeatureKey>> = {
  sleep: 'sleep',
  water: 'water',
};

/** Ring key (inside the "Today" card) → owning feature. */
const HOME_RING_FEATURE: Readonly<Record<string, HealthFeatureKey>> = {
  calories: 'calories',
  steps: 'workouts',
  move: 'workouts',
};

/**
 * "At a glance" tile key → owning feature.
 *
 * Water and weight used to be here too, each as a tile restating a number the
 * full WATER/WEIGHT card a few lines above already showed — same figure,
 * same tap target once the Weight card's headline became tappable to its own
 * sheet. Habits and body stay: neither owns a full card of its own on Home, so
 * this tile is the only place either one appears.
 */
const HOME_GLANCE_FEATURE: Readonly<Record<string, HealthFeatureKey>> = {
  habits: 'habits',
  body: 'body',
};

type FeatureMap = Partial<Record<HealthFeatureKey, boolean>>;

const enabled = (features: FeatureMap, key: HealthFeatureKey | undefined): boolean =>
  key === undefined || features[key] !== false;

export function visibleHomeRingKeys(features: FeatureMap): string[] {
  return Object.keys(HOME_RING_FEATURE).filter((k) => enabled(features, HOME_RING_FEATURE[k]));
}

export function visibleGlanceKeys(features: FeatureMap): string[] {
  return Object.keys(HOME_GLANCE_FEATURE).filter((k) => enabled(features, HOME_GLANCE_FEATURE[k]));
}

/**
 * Filter Home's stored widget order down to what this user may see.
 *
 * Runs over the STORED order rather than the default, so an admin's card
 * arrangement survives toggling a feature off and back on. A composite whose
 * every child is gone (`today` with no rings, `glance` with no tiles) is dropped
 * too — an empty titled card is worse than no card.
 */
export function visibleHomeWidgets(widgets: readonly string[], features: FeatureMap): string[] {
  const hasRings = visibleHomeRingKeys(features).length > 0;
  const hasGlance = visibleGlanceKeys(features).length > 0;

  return widgets.filter((key) => {
    if (key === 'today') return hasRings;
    if (key === 'glance') return hasGlance;
    return enabled(features, HOME_WIDGET_FEATURE[key]);
  });
}

/** Filter Home's "Sections" jump grid by the feature each link's route belongs to. */
export function visibleHomeSections<T extends { route: string }>(
  sections: readonly T[],
  features: FeatureMap,
): T[] {
  return sections.filter((section) => {
    const feature = healthFeatureForRoute(section.route.replace(/^\//, ''));
    return feature === null || features[feature] !== false;
  });
}

export function getHealthFeature(key: HealthFeatureKey): HealthFeatureDefinition {
  const found = HEALTH_FEATURES.find((f) => f.key === key);
  // Unreachable for a `HealthFeatureKey`, but keeps the return type non-null
  // for call sites that map over persisted (and therefore untrusted) keys.
  if (!found) throw new Error(`Unknown health feature: ${key}`);
  return found;
}
