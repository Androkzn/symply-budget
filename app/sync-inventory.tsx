/**
 * `simplehouse://sync-inventory` — the per-category breakdown behind the sync
 * card's total.
 *
 * A route rather than a Settings-stack screen, and the reason is the constraint
 * `app/device-sync.tsx` documents about its own screen: `HouseDeviceSyncScreen`
 * is registered in BOTH trees — the Settings stack and this expo-router one —
 * and behaves identically in each only because it "takes no props and only ever
 * calls `goBack()`".
 *
 * The moment that screen needs to push a NEW surface, a
 * `navigation.navigate('HouseSyncInventory')` typed against
 * `SettingsStackParamList` throws `The action 'NAVIGATE' … was not handled by
 * any navigator` for every member who arrived by deep link, because the Settings
 * stack is not mounted in that tree. Registering the destination here and
 * pushing it with expo-router's global router is the one call that works from
 * either tree, which is what keeps the dual registration honest.
 *
 * The brand guard is `device-sync`'s, for its reason: this screen counts rows in
 * a household ledger, which does not exist on a brand that is not running it.
 */
import { Redirect } from 'expo-router';

import { isHouseBrand } from '@brand';
import { isHouseLocalFirst } from '@features/house/local/flag';
import { HouseSyncInventoryScreen } from '@screens/house-v2/enrolment';

export default function SyncInventoryRoute() {
  if (!isHouseBrand() || !isHouseLocalFirst()) {
    return <Redirect href="/" />;
  }
  return <HouseSyncInventoryScreen />;
}
