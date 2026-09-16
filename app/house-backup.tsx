/**
 * `simplehouse://house-backup` — Backup & Restore, as a route.
 *
 * The Settings row is how a member finds this; the deep link is how everything
 * else reaches it. The one that matters is the overdue-backup notification: the
 * scheduler can only run in the foreground (Argon2 will not finish in an iOS
 * background window), so when a home has been due for days the only way to say
 * so is a local push — and a push that lands on Home has made the member
 * navigate for something they were already interrupted for.
 *
 * Registering the same component in both places is the established pattern here
 * (`app/device-sync.tsx`, `app/aihousekeeper-settings.tsx`), and it works
 * because `HouseBackupScreen` takes no props and only ever calls `goBack()`.
 *
 * The brand guard matters: this screen archives a local-first ledger, which does
 * not exist on a brand that is not running one.
 */
import { Redirect } from 'expo-router';

import { isHouseBrand } from '@brand';
import { isHouseLocalFirst } from '@features/house/local/flag';
import { HouseBackupScreen } from '@screens/house-v2/backup';

export default function HouseBackupRoute() {
  if (!isHouseBrand() || !isHouseLocalFirst()) {
    return <Redirect href="/" />;
  }
  return <HouseBackupScreen />;
}
