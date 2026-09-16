import { Redirect } from 'expo-router';

import { HealthGoalsScreen, isHealthBrand } from '@features/health';

/** Symply Health goals editor (starts in the "More" hub). */
export default function HealthGoalsTab() {
  if (!isHealthBrand()) {
    return <Redirect href="/" />;
  }
  return <HealthGoalsScreen />;
}
