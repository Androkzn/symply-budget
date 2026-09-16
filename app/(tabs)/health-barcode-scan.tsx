import { HealthBarcodeScanScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health barcode scanner (donor `BarcodeScannerView`, parity P5).
 *
 * Pushed from Scan's quick-add, not pinned to the bar (`href: null` — see
 * `tabRegistry.ts`), same as `health-notifications` / `health-widget`.
 * Gated on the `scan` feature flag, same surface it is reached from.
 */
export default function HealthBarcodeScanTab() {
  return (
    <HealthFeatureRoute feature="scan">
      <HealthBarcodeScanScreen />
    </HealthFeatureRoute>
  );
}
