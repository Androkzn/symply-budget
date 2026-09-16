import { HealthWeightScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Weight section — the donor Weight tab (starts in "More").
 *
 * Redirects Home when `weight` is switched off.
 */
export default function HealthWeightTab() {
  return (
    <HealthFeatureRoute feature="weight">
      <HealthWeightScreen />
    </HealthFeatureRoute>
  );
}
