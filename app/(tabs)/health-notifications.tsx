import { Redirect } from 'expo-router';

import { HealthNotificationSettingsScreen, isHealthBrand } from '@features/health';

/**
 * Symply Health notification settings, pushed from the "More" hub.
 *
 * Registered in `ROUTABLE_TAB_SCREENS` so expo-router mounts it, but
 * deliberately NOT in the brand's `tabs` pool: it is a settings page, not a
 * section, so it must never be offered as something to pin to the bottom bar.
 * A route outside the pool resolves to `href: null` — reachable by push and by
 * deep link, invisible to the bar and to "Customize Tabs".
 */
export default function HealthNotificationSettingsTab() {
  if (!isHealthBrand()) {
    return <Redirect href="/" />;
  }
  return <HealthNotificationSettingsScreen />;
}
