import { useMemo } from 'react';

import { HEALTH_FEATURE_KEYS, type HealthFeatureKey } from '@config/healthFeatures';
import { useIsAdmin, isAdminUser } from '@hooks/useIsAdmin';
import { useAuthStore } from '@stores/authStore';
import {
  resolveHealthFeature,
  resolveHealthFeatures,
  useHealthFeatureStore,
} from '@stores/healthFeatureStore';

/**
 * Reactive per-feature check for Symply Health.
 *
 *   const showHabits = useHealthFeature('habits');
 *   if (!showHabits) return null;
 *
 * Screens use this hook and never read the store directly, so the admin gate
 * lives in exactly one place. For a common user this always returns the
 * feature's default — the default-on trackers on, everything else off.
 */
export function useHealthFeature(key: HealthFeatureKey): boolean {
  const isAdmin = useIsAdmin();
  return useHealthFeatureStore((state) => resolveHealthFeature(state, key, isAdmin));
}

/**
 * The whole resolved map in one subscription — for screens that gate several
 * surfaces at once (Home, the settings switchboard). Calling `useHealthFeature`
 * in a loop is not an option: hook count must stay stable across renders.
 */
export function useHealthFeatures(): Record<HealthFeatureKey, boolean> {
  const isAdmin = useIsAdmin();
  const overrides = useHealthFeatureStore((state) => state.overrides);
  // Memoized for IDENTITY, not for cost. `useEffectiveTabs` feeds this map into
  // its own `useMemo` dependency array, so returning a fresh object each render
  // would rebuild the whole tab pool on every render of every screen that
  // hosts the bar.
  return useMemo(() => resolveHealthFeatures({ overrides }, isAdmin), [overrides, isAdmin]);
}

/**
 * Non-reactive read for navigation guards, services, and other non-React code.
 * React components must use `useHealthFeature` so they re-render on change.
 */
export function isHealthFeatureEnabled(key: HealthFeatureKey): boolean {
  return resolveHealthFeature(
    useHealthFeatureStore.getState(),
    key,
    isAdminUser(useAuthStore.getState().user),
  );
}

export { HEALTH_FEATURE_KEYS };
export type { HealthFeatureKey };
