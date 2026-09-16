import { Redirect } from 'expo-router';

import { HealthOtherDeviceScreen, isHealthBrand } from '@features/health';

/**
 * Symply Health second-device enrolment, pushed from the "More" hub.
 *
 * A root-level pushed route rather than a `(tabs)` entry (compare
 * `app/health-features.tsx`): it is a one-off setup surface, so it must never
 * occupy a slot in the customizable bar or appear in the tab pool.
 *
 * The same screen is reachable at `/lf-invite`, which is where the
 * `simplehealth://lf-invite?…` link the other device scans lands.
 */
export default function HealthOtherDeviceRoute() {
  if (!isHealthBrand()) {
    return <Redirect href="/" />;
  }
  return <HealthOtherDeviceScreen />;
}
