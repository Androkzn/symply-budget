import { HealthFoodLibraryScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health food library section (starts in the "More" hub).
 *
 * Redirects Home when `foods` is switched off.
 */
export default function HealthFoodTab() {
  return (
    <HealthFeatureRoute feature="foods">
      <HealthFoodLibraryScreen />
    </HealthFeatureRoute>
  );
}
