import { HealthScanScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Scan section (starts in the "More" hub).
 *
 * Redirects Home when `scan` is switched off.
 */
export default function HealthScanTab() {
  return (
    <HealthFeatureRoute feature="scan">
      <HealthScanScreen />
    </HealthFeatureRoute>
  );
}
