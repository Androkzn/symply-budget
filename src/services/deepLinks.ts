import { router } from 'expo-router';

/** Deep links that were already handled — prevents tab remounts from re-navigating. */
const consumedKeys = new Set<string>();

const MAX_CONSUMED_KEYS = 50;

/**
 * Returns true the first time a deep-link key is seen. Subsequent calls with
 * the same key return false so stale URL params cannot re-open a screen when
 * the user revisits a tab without tapping a notification again.
 */
export function consumeDeepLinkOnce(key: string): boolean {
  if (consumedKeys.has(key)) return false;
  consumedKeys.add(key);
  if (consumedKeys.size > MAX_CONSUMED_KEYS) {
    const oldest = consumedKeys.values().next().value;
    if (oldest) consumedKeys.delete(oldest);
  }
  return true;
}

/** Strip settings-tab deep-link params from the expo-router URL. */
export function clearSettingsDeepLinkParams() {
  try {
    router.setParams({
      screen: undefined,
      householdId: undefined,
      navNonce: undefined,
      floorPlanId: undefined,
      initialZoneType: undefined,
      initialZoneIndex: undefined,
    });
  } catch {
    // Route may be unmounted.
  }
}
