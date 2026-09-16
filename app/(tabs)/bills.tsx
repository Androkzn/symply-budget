import { Redirect } from 'expo-router';

/**
 * Bills is a House-domain feature (utilities/bills) backed by a House-only API
 * (see `gateHomeApiPaths`), so it was removed from Budget — no brand pins a Bills
 * tab. This route is retired: any lingering `/bills` deep link bounces home.
 */
export default function BillsTab() {
  return <Redirect href="/" />;
}
