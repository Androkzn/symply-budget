import { HealthWaterScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health water section (starts in the "More" hub).
 *
 * Redirects Home when `water` is switched off.
 */
export default function HealthWaterTab() {
  return (
    <HealthFeatureRoute feature="water">
      <HealthWaterScreen />
    </HealthFeatureRoute>
  );
}
