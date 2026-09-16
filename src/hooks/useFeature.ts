import type { FeatureFlagKey } from '@config/features';
import { useFeatureFlagStore, resolveFlag } from '@stores/featureFlagStore';

/**
 * Reactive feature-flag check. Returns whether `key` is currently enabled and
 * re-renders the component when the resolved value changes.
 *
 *   const showGarden = useFeature('gardening');
 *   if (!showGarden) return null;
 *
 * This hook is the only API screens should use to read flags — call sites never
 * touch the store, transport, or KV directly (FlagProvider abstraction).
 */
export function useFeature(key: FeatureFlagKey): boolean {
  return useFeatureFlagStore((state) => resolveFlag(state, key));
}

export { isFeatureEnabled } from '@stores/featureFlagStore';
