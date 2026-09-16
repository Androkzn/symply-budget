import { Redirect } from 'expo-router';

import { HealthWidgetSettingsScreen, isHealthBrand } from '@features/health';

/**
 * Symply Health widget settings, pushed from the "More" hub.
 *
 * Same registration story as `health-notifications`: routable, but not a member
 * of the brand's tab pool — a preferences page has no business being pinnable
 * to the bottom bar.
 */
export default function HealthWidgetSettingsTab() {
  if (!isHealthBrand()) {
    return <Redirect href="/" />;
  }
  return <HealthWidgetSettingsScreen />;
}
