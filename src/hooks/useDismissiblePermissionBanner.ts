import { useCallback, useState } from 'react';

export interface UseDismissiblePermissionBannerResult {
  /** Whether the card should render right now. */
  visible: boolean;
  dismiss: () => void;
}

/**
 * "Show while there's still something to grant, unless the member just said
 * not now" — the Home-tab variant of a permission card, shared by every
 * brand's Home screen (and, for Apple Health, `HealthKitConnectCard` too).
 *
 * Takes a plain boolean rather than a `PermissionState` because the two
 * callers don't share one enum: `useNotificationPermission` calls it
 * `'granted'`, `useHealthKitConnection` calls the same fact `'connected'`.
 * The caller already knows which one it has; this hook only needs to know
 * whether there is still something worth asking about.
 *
 * The dismissal is in-memory only, on purpose: it resets on the next cold
 * launch. A permission that is STILL missing deserves to be seen again next
 * session — this is a gentle recurring reminder, not a one-time toast a
 * member could dismiss once and never be told again.
 */
export function useDismissiblePermissionBanner(
  hasSomethingToAsk: boolean,
): UseDismissiblePermissionBannerResult {
  const [dismissed, setDismissed] = useState(false);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { visible: hasSomethingToAsk && !dismissed, dismiss };
}
