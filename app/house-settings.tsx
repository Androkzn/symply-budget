/**
 * `/house-settings` — House's settings hub, as a root route.
 *
 * The gear sits on EVERY House tab header now, and a gear on the Garden tab
 * cannot push into the Settings stack: that stack is hosted by the More tab
 * (`app/(tabs)/settings.tsx`) inside its own `NavigationIndependentTree`, and
 * the only door into another tab is a tab switch — which would answer "open
 * settings" by moving the member off the screen they were on.
 *
 * So the hub is pushed ABOVE the tabs instead, the same way `/house-backup` and
 * `/device-sync` are, and back returns to whichever tab opened it.
 *
 * It mounts the WHOLE Settings navigator rather than the hub screen alone,
 * because every row on the hub pushes a sibling of it — Appearance, Currency,
 * Region, Calendar Sync, Floor Plans, the AI screens, Data sharing. Mounting the
 * screen bare would leave each of those a dead tap. `registerStack={false}`
 * keeps this mount out of `settingsNavigationStore`: exactly one navigator may
 * answer a queued notification tap, and that is the tab host, which outlives
 * this route.
 */
import { Redirect } from 'expo-router';
import { NavigationContainer, NavigationIndependentTree } from 'expo-router/react-navigation';

import { isHouseBrand } from '@brand';
import { SettingsNavigator } from '@navigation/SettingsNavigator';

export default function HouseSettingsRoute() {
  // Child apps have their own settings hub (full Budget's is `BudgetSettings`,
  // behind the same gear), so this route is House's alone.
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }

  return (
    <NavigationIndependentTree>
      <NavigationContainer>
        <SettingsNavigator initialRouteName="HouseSettings" registerStack={false} />
      </NavigationContainer>
    </NavigationIndependentTree>
  );
}
