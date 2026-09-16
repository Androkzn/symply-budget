import { HealthCycleScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Women's Health section (starts in the "More" hub).
 *
 * Redirects Home when `cycle` is switched off.
 */
export default function HealthCycleTab() {
  return (
    <HealthFeatureRoute feature="cycle">
      <HealthCycleScreen />
    </HealthFeatureRoute>
  );
}
