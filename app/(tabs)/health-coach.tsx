import { HealthCoachScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health AI Coach section (starts in the "More" hub).
 *
 * Redirects Home when `coach` is switched off.
 */
export default function HealthCoachTab() {
  return (
    <HealthFeatureRoute feature="coach">
      <HealthCoachScreen />
    </HealthFeatureRoute>
  );
}
