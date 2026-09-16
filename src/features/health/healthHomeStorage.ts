import { storageHelpers } from '@services/storage';

import { moveWidget, toggleWidget } from './healthWeightStorage';

/**
 * Symply Health — which HOME cards are shown, and in what order.
 *
 * The donor's dashboard is customisable: `DashboardLayoutManager` keeps an
 * ordered `[DashboardWidgetType]` of nine cases with move / toggle / reset, and
 * `DashboardCustomizationView` is the editor. Home here rendered a FIXED stack
 * of cards, so the one screen every member opens first was the one screen they
 * could not shape.
 *
 * This is deliberately the SAME mechanism the Weight tab already ships
 * (`healthWeightStorage`'s `HEALTH_WEIGHT_LAYOUT_KEY` + `moveWidget` /
 * `toggleWidget`), not a second one: the pure list helpers are re-exported from
 * there rather than re-implemented, so a fix to either applies to both.
 *
 * DEVICE-LOCAL, like the weight layout. The donor persists its layout to a
 * `SDDashboardLayout` row AND to its own backend; there is no route for that
 * here, and inventing a schema change for a pure UI preference is not worth it.
 * It is still registered in `healthCacheKeys` and cleared on sign-out — a layout
 * is not a health record, but leaving one behind would tell the next person on a
 * shared handset which cards the previous one cared about.
 */

export const HEALTH_HOME_LAYOUT_KEY = 'health.homeLayout.v1';

export interface HomeLayout {
  /** Enabled widget keys, in render order. */
  widgets: string[];
}

/**
 * Everything on, in the order Home already shipped, with sleep folded in after
 * the at-a-glance grid.
 *
 * Unlike the Weight tab (which defaults to five of fourteen because fourteen
 * cards is a wall), Home defaults to ALL of them: this is the layout members
 * already have, and a first run that silently hides half of Home would read as
 * data loss rather than as a default.
 *
 * KEEP IN SYNC with `DEFAULT_HOME_WIDGETS` in `components/HealthHomeWidgets`,
 * which is the same list for the screen's Reset button. They are duplicated
 * rather than shared because this module must not import a component — storage
 * is reached from `authStore`'s sign-out path, and dragging React in through it
 * is the import cycle `healthCacheKeys` exists to avoid.
 */
export const DEFAULT_HOME_WIDGET_ORDER: readonly string[] = [
  'today',
  'weeklyTrends',
  'foodChallenges',
  'glance',
  'sleep',
  'water',
  'note',
];

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  widgets: [...DEFAULT_HOME_WIDGET_ORDER],
};

/**
 * Read the stored layout, reconciled against the widgets that actually exist.
 *
 * `known` is passed in by the caller (the component registry owns the list), so
 * this module never has to import the components. Unknown keys — a widget that
 * was renamed or removed after a member stored a layout — are dropped instead of
 * rendering nothing, and a layout that ends up empty degrades to the default
 * rather than leaving a blank screen with no way back.
 */
export async function loadHomeLayout(known?: readonly string[]): Promise<HomeLayout> {
  const stored = await storageHelpers.getObject<Partial<HomeLayout>>(HEALTH_HOME_LAYOUT_KEY);
  const widgets = Array.isArray(stored?.widgets)
    ? stored!.widgets.filter((key): key is string => typeof key === 'string')
    : [...DEFAULT_HOME_LAYOUT.widgets];
  return { widgets: reconcileHomeWidgets(widgets, known) };
}

export async function saveHomeLayout(
  patch: Partial<HomeLayout>,
  known?: readonly string[]
): Promise<HomeLayout> {
  const next: HomeLayout = { ...(await loadHomeLayout(known)), ...patch };
  const reconciled: HomeLayout = { widgets: reconcileHomeWidgets(next.widgets, known) };
  await storageHelpers.setObject(HEALTH_HOME_LAYOUT_KEY, reconciled);
  return reconciled;
}

/**
 * Drop unknown / duplicate keys; fall back to the default when nothing is left.
 *
 * A widget added to the registry AFTER someone stored a layout does not appear
 * in theirs — the stored order is the record, and silently splicing a new card
 * into a layout a member arranged themselves is the kind of "helpful" edit that
 * reads as a bug. Reset puts every card back, which is what that button is for.
 * (The donor behaves the same way: `enabledWidgets` is whatever was decoded.)
 */
export function reconcileHomeWidgets(
  widgets: readonly string[],
  known?: readonly string[]
): string[] {
  const seen = new Set<string>();
  const kept = widgets.filter((key) => {
    if (known && !known.includes(key)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return kept.length > 0 ? kept : [...DEFAULT_HOME_LAYOUT.widgets];
}

/**
 * The list helpers, re-exported from the Weight tab's layout module.
 *
 * `moveWidget` shifts one slot and no-ops out of range; `toggleWidget` refuses
 * to hide the LAST remaining card. Both are pure and already carry the Weight
 * tab's behaviour — Home reusing them is the point.
 */
export { moveWidget, toggleWidget };
