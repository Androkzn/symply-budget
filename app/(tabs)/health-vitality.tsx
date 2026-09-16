import { HealthVitalityScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Men's Health section (starts in the "More" hub).
 *
 * Redirects Home when `vitality` is switched off.
 */
export default function HealthVitalityTab() {
  return (
    <HealthFeatureRoute feature="vitality">
      <HealthVitalityScreen />
    </HealthFeatureRoute>
  );
}
