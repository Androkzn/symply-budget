import { HealthFeaturesScreen } from '@features/health';

/**
 * Admin-only Symply Health feature switchboard (reached from "More").
 *
 * A full-screen pushed route rather than a tab: it is staff tooling, so it must
 * not occupy a slot in the customizable bar. `HealthFeaturesScreen` owns both
 * gates (brand + admin) and redirects Home for anyone else, so this route is
 * safe to leave registered in every brand's bundle.
 */
export default function HealthFeaturesRoute() {
  return <HealthFeaturesScreen />;
}
