import { useMemo } from 'react';

import { brand } from '@brand';
import { healthFeatureForRoute, type HealthFeatureKey } from '@config/healthFeatures';
import { useDeviceType } from '@hooks/useDeviceType';
import { useHealthFeatures } from '@hooks/useHealthFeature';
import { useTabCustomizationStore, type TabOverride } from '@stores/tabCustomizationStore';

import { buildTabConfig, type TabConfigEntry } from './tabRegistry';

export interface EffectiveTabs {
  /** Tabs pinned to the bottom bar / sidebar, in order (includes More last). */
  pinned: TabConfigEntry[];
  /** Tabs living in the "More" hub (hidden from the bar), in order. */
  overflow: TabConfigEntry[];
}

const DEFAULT_MAX_VISIBLE = 5;
/**
 * Ceiling for the iPad sidebar when a brand names no tablet cap of its own. The
 * sidebar is a tall column, so the constraint is the pool's length rather than
 * the chrome's width.
 */
const DEFAULT_MAX_VISIBLE_TABLET = 15;
/** The route that is always the last pinned slot (the "More" hub). */
const MORE_ROUTE = 'settings';

/**
 * Resolve the effective bottom bar from a brand tab POOL and the user's saved
 * overrides.
 *
 * Rules:
 *  - Pool order + each entry's `defaultHidden` give the starting layout.
 *  - User overrides (order + visible) win per-route; pool routes with no
 *    override keep their defaults; override routes not in the pool are ignored.
 *  - `locked` entries are always visible (e.g. Home, More).
 *  - "More" (`settings`) is forced into the LAST pinned slot.
 *  - At most `maxVisible` tabs are pinned (More included); any visible tabs past
 *    that cap, plus all non-visible tabs, overflow into "More".
 *  - `ignoreDefaultHidden` starts every un-overridden tab VISIBLE. `defaultHidden`
 *    is a phone-bar concession — five slots for a pool of eleven — and it has no
 *    reason to apply to the iPad sidebar, which is a tall column capped at
 *    `DEFAULT_MAX_VISIBLE_TABLET`. On tablet the whole House pool fits, so
 *    burying Mira, Garden, Spaces, Pros and Reports one tap into "More" hid them
 *    for no gain. Explicit user overrides still win either way: a tab the member
 *    turned off stays off, on both form factors.
 */
export function resolveEffectiveTabs(
  pool: TabConfigEntry[],
  overrides: TabOverride[] | null,
  maxVisible: number = DEFAULT_MAX_VISIBLE,
  ignoreDefaultHidden = false,
): EffectiveTabs {
  const overrideByRoute = new Map<string, TabOverride>(
    (overrides ?? []).map((o) => [o.route, o]),
  );

  const resolved = pool.map((entry, index) => {
    const override = overrideByRoute.get(entry.route);
    return {
      entry,
      order: override ? override.order : index,
      visible: entry.locked
        ? true
        : override
          ? override.visible
          : ignoreDefaultHidden || !entry.defaultHidden,
    };
  });

  resolved.sort((a, b) => a.order - b.order);

  const more = resolved.find((r) => r.entry.route === MORE_ROUTE);
  const visibleNonMore = resolved.filter(
    (r) => r.visible && r.entry.route !== MORE_ROUTE,
  );
  const hiddenNonMore = resolved.filter(
    (r) => !r.visible && r.entry.route !== MORE_ROUTE,
  );

  // Reserve the final slot for More when the brand has one.
  const pinnedCap = more ? Math.max(1, maxVisible - 1) : maxVisible;
  const pinnedNonMore = visibleNonMore.slice(0, pinnedCap);
  const overflowVisible = visibleNonMore.slice(pinnedCap);

  const pinned = [
    ...pinnedNonMore.map((r) => r.entry),
    ...(more ? [more.entry] : []),
  ];
  const overflow = [
    ...overflowVisible.map((r) => r.entry),
    ...hiddenNonMore.map((r) => r.entry),
  ];

  return { pinned, overflow };
}

/**
 * Drop the tabs whose owning Symply Health feature is switched off.
 *
 * Applied BEFORE `resolveEffectiveTabs` so a disabled feature is gone from the
 * bar AND from the "More" hub AND from the tab customizer — hiding it from only
 * the bar would leave it one tap away in More, which is not "off". Routes that
 * belong to no feature (Home, More, every other brand's tabs) pass through
 * untouched, so this is a no-op outside Symply Health.
 */
export function filterTabsByHealthFeatures(
  pool: TabConfigEntry[],
  features: Partial<Record<HealthFeatureKey, boolean>>,
): TabConfigEntry[] {
  return pool.filter((entry) => {
    const feature = healthFeatureForRoute(entry.route);
    return feature === null || features[feature] !== false;
  });
}

/**
 * Hook form: the effective bar for the active brand, reacting to the user's
 * saved customization. For brands that have NOT opted in (`customizableTabs`
 * falsy) this is the legacy static bar (`buildTabConfig`) with no overflow.
 */
/**
 * How many tabs may be pinned on THIS device.
 *
 * The phone bar and the iPad sidebar are different shapes with different
 * limits, and until now both used the phone's. On a 13-inch iPad that left a
 * column of four icons and a "More" button with most of the pool one tap out of
 * sight, in a rail with room for three times as many.
 */
export function useMaxVisibleTabs(): number {
  const { shouldUseSidebar } = useDeviceType();
  const phoneCap = brand.maxVisibleTabs ?? DEFAULT_MAX_VISIBLE;
  if (!shouldUseSidebar) return phoneCap;
  return brand.maxVisibleTabsTablet ?? Math.max(phoneCap, DEFAULT_MAX_VISIBLE_TABLET);
}

export function useEffectiveTabs(options: { showTasks: boolean }): EffectiveTabs {
  const { showTasks } = options;
  const overrides = useTabCustomizationStore((s) => s.overrides);
  const healthFeatures = useHealthFeatures();
  const maxVisible = useMaxVisibleTabs();
  // Same signal `useMaxVisibleTabs` branches on, so the cap and the defaults
  // always describe the same device.
  const { shouldUseSidebar } = useDeviceType();

  return useMemo(() => {
    const pool = filterTabsByHealthFeatures(buildTabConfig({ showTasks }), healthFeatures);
    if (!brand.customizableTabs) {
      return { pinned: pool, overflow: [] };
    }
    return resolveEffectiveTabs(pool, overrides, maxVisible, shouldUseSidebar);
  }, [showTasks, overrides, healthFeatures, maxVisible, shouldUseSidebar]);
}
