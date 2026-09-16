import { HealthFridgeScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Smart Fridge section (starts in the "More" hub).
 *
 * Redirects Home when `fridge` is switched off.
 */
export default function HealthFridgeTab() {
  return (
    <HealthFeatureRoute feature="fridge">
      <HealthFridgeScreen />
    </HealthFeatureRoute>
  );
}
