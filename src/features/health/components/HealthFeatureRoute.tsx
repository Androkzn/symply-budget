import { Redirect } from 'expo-router';
import React, { type ReactNode } from 'react';

import type { HealthFeatureKey } from '@config/healthFeatures';
import { useHealthFeature } from '@hooks/useHealthFeature';

import { isHealthBrand } from '../brandGuard';

export interface HealthFeatureRouteProps {
  /** The catalog entry that owns this screen (see @config/healthFeatures). */
  feature: HealthFeatureKey;
  children: ReactNode;
}

/**
 * Route guard for every Symply Health section tab.
 *
 * Two gates, one component, so the 15 `app/(tabs)/health-*.tsx` files stay
 * three lines each instead of forking the same `if` fifteen ways:
 *
 *  1. Wrong brand → Home (the routes are compiled into every brand's bundle).
 *  2. Feature switched off → Home.
 *
 * Gate 2 is what makes "off" mean off. Hiding a tab from the bar and the "More"
 * hub is only cosmetic: `router.push('/health-cycle')` from a notification, a
 * deep link, a restored navigation state, or a stale in-app link would still
 * mount a screen for a feature this user is not supposed to have. A common user
 * always resolves to the default-on trackers, so every optional route redirects
 * for them regardless of what is cached in the toggle store.
 */
export function HealthFeatureRoute({ feature, children }: HealthFeatureRouteProps) {
  // Called unconditionally — the brand check must NOT short-circuit the hook.
  const enabled = useHealthFeature(feature);

  if (!isHealthBrand() || !enabled) {
    return <Redirect href="/" />;
  }
  return <>{children}</>;
}
