import { Redirect, useLocalSearchParams } from 'expo-router';

import { isHouseBrand } from '@brand';
import { HealthOtherDeviceScreen, isHealthBrand } from '@features/health';
import { captureHouseInviteLink } from '@features/house/local/inviteLinkStore';

/**
 * Where a `…://lf-invite?id=…&secret=…&code=…` link lands.
 *
 * That link is what the QR on the inviting device encodes, and each brand builds
 * it client-side — the shared Worker hardcodes the Budget scheme in its own
 * payload, so `invite.qrPayload` is deliberately ignored.
 *
 * expo-router derives the linking config from this file tree, so the route path
 * IS the link path: renaming this file silently breaks the scan.
 *
 * **Health** renders its enrolment screen here, which reads `id` / `secret` /
 * `code` off the query itself and offers the claim.
 *
 * **House** cannot: its enrolment screens live in the Settings stack, which sits
 * in a `NavigationIndependentTree` that nothing outside it can navigate into,
 * and the link routinely arrives before there is anywhere to put it (a cold
 * start opens on sign-in). So the invite is parked in the same store the root
 * layout uses, and the layout forwards it to Join once the authenticated shell
 * is up. Redirecting to `/` rather than rendering anything is the point: the
 * member lands in the app, and the join screen opens on top of it a moment
 * later. Nothing is claimed by any of that — the confirmation on the Join screen
 * is what enrols, so a link forwarded into a group chat cannot enrol whoever
 * taps it first.
 */
export default function EnrolmentLinkRoute() {
  // Read as params rather than as a URL: expo-router has already parsed the link
  // by the time this renders, and `Linking.getInitialURL` is not guaranteed to
  // still hand it back on every platform.
  const params = useLocalSearchParams<{ code?: string; secret?: string; id?: string }>();

  if (isHealthBrand()) {
    return <HealthOtherDeviceScreen />;
  }

  if (isHouseBrand()) {
    // Rebuilt rather than passed field by field so there is ONE parser for a
    // tapped link, wherever it entered from — the root layout's listener and
    // this route hand the same shape to the same function.
    const code = typeof params.code === 'string' ? params.code : '';
    const secret = typeof params.secret === 'string' ? params.secret : '';
    if (code && secret) {
      captureHouseInviteLink(
        `simplehouse://lf-invite?code=${encodeURIComponent(code)}&secret=${encodeURIComponent(secret)}`,
      );
    }
    return <Redirect href="/" />;
  }

  return <Redirect href="/" />;
}
