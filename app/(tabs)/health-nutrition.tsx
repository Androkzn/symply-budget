import { HealthNutritionScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Nutrition section as a first-class (customizable) tab.
 *
 * Redirects Home when `calories` is switched off.
 */
export default function HealthNutritionTab() {
  return (
    <HealthFeatureRoute feature="calories">
      <HealthNutritionScreen />
    </HealthFeatureRoute>
  );
}
