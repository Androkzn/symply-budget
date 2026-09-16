/**
 * `simplehouse://device-sync` — the House V2 local-first surface, as a route.
 *
 * The Settings row is the way a member finds this; the deep link is the way
 * everything else reaches it. Both matter: an invite link handed to a partner,
 * a push that says a device is waiting for approval, and the two-device E2E
 * suite all open a URL rather than walking the Settings stack.
 *
 * Registering the same component in both places is the established pattern
 * here (`app/aihousekeeper-settings.tsx` does exactly this), and it works
 * because `HouseDeviceSyncScreen` takes no props and only ever calls
 * `goBack()` — so it behaves identically inside the Settings stack's
 * independent navigation tree and inside the expo-router stack.
 *
 * The brand guard matters more than usual here: this screen talks about a
 * household key and enrolled devices, which do not exist on a brand that is not
 * running the House ledger.
 */
import { Redirect } from 'expo-router';

import { isHouseBrand } from '@brand';
import { isHouseLocalFirst } from '@features/house/local/flag';
import { HouseDeviceSyncScreen } from '@screens/house-v2/enrolment';

export default function DeviceSyncRoute() {
  if (!isHouseBrand() || !isHouseLocalFirst()) {
    return <Redirect href="/" />;
  }
  return <HouseDeviceSyncScreen />;
}
