import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useCallback, useSyncExternalStore } from 'react';

import { isHouseBrand } from '@brand';
import { ENV } from '@config/env';
import { isHouseAddressCaptureEligible } from '@features/house/local/addressCaptureEligibility';
import { subscribeToHouseLedgerChanges } from '@features/house/local/engine';
import { AcceptInviteScreen } from '@screens/auth/AcceptInviteScreen';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { householdNeedsAddressCapture } from '@utils/region-gating';

import { AuthNavigator } from './AuthNavigator';
import { OnboardingNavigator } from './OnboardingNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Does THIS DEVICE hold a home that still needs its address captured?
 *
 * The onboarding gate everything else uses — `hasCompletedOnboarding` — is an
 * ACCOUNT-level server flag, and that is the wrong question for an address.
 * House local-first auto-mints a household on any device with no local ledger,
 * seeding `country` and leaving city / province / every address line null. A
 * member who reinstalls the app is already onboarded on the server, so no
 * onboarding step ever runs again, and `CreateHouseholdScreen` — the only screen
 * in the app that collects those fields — is never shown. The home is then
 * permanently jurisdiction-less: `isPropertyAssessmentSupported` resolves the
 * jurisdiction from country + state_province, so the whole property assessment
 * and tax surface stays shut behind "Add your province or state to your property
 * address…" with no route to any address form. Seventeen such homes on staging,
 * every one of them `country=null, state_province=null, city=null`.
 *
 * Deliberately a PURE derivation with no latch, no timer and no one-shot flag:
 *
 *   - It cannot loop or re-prompt. It is not a prompt that fires; it is a
 *     question the navigator asks on each render and answers from store state.
 *   - It closes the instant the household gains a region — which is the same
 *     act that fixes the bug — and never re-opens for that home.
 *   - A home that already has an address answers false on the very first render,
 *     so a healthy member sees no extra screen and no flash of onboarding.
 *
 * The four narrowing clauses each prevent a specific misfire:
 *
 *   - `isHouseBrand()` — Health, Kaizen and Language have no household domain at
 *     all and never register `CreateHousehold`, so routing them here would land
 *     on a screen their onboarding stack does not contain.
 *   - `isHouseAddressCaptureEligible` — a home this device JOINED is not this
 *     member's to describe. An invitee who has accepted but is still waiting on
 *     the owner's approval holds a placeholder household with every address
 *     field null, and would otherwise be walled out of the app and asked for an
 *     address that is already on its way. See that function for the full case.
 *   - a null household is NOT treated as "needs capture" (see
 *     `householdNeedsAddressCapture`) — that is the store not loaded yet, not a
 *     home missing an address.
 *   - an unsupported-but-complete address (a US household in an unseeded state)
 *     answers false, because no address the member types would seed a
 *     jurisdiction we have not modelled.
 *
 * Exported because the mount decision is not made here: `app/_layout.tsx` is
 * what chooses between this navigator and the authenticated expo-router shell,
 * and it must ask the same question this navigator answers or the two disagree
 * about which screen the member is looking at.
 */
/**
 * There is deliberately NO dismissal here.
 *
 * This gate used to keep a per-process set of homes whose prompt the member had
 * waved away, fed by a "Not now" link on the form, on the reasoning that a
 * full-screen block with no back button locks somebody out of a working app.
 *
 * The premise was wrong, and it was wrong at the product level: a member must
 * hold at least one home before ANY of this app means something, and a home
 * with no address is not one yet. Dismissing therefore did not let the member
 * into an app they could use — it let them into an app whose property surfaces
 * were all shut, with the same prompt waiting on the next cold start.
 *
 * The block still needs a second answer for the member who cannot supply an
 * address, and it now has the right one: `CreateHouseholdScreen` offers
 * **Accept Invite** beside Save Address. That is not a dismissal — joining a
 * home ADOPTS one, `isHouseAddressCaptureEligible` then answers false for a
 * home this device is awaiting enrolment on, and the gate closes because the
 * member now has a home rather than because they asked it to stop asking.
 */

/**
 * Eligibility moves on LEDGER changes, not on store changes, so it needs its own
 * subscription.
 *
 * Enrolment completing is the transition that matters, and it is invisible to
 * the household store: `startPropertySetWatch` recomputes `inStep` from id, name
 * and property count, none of which enrolment changes, so it returns early
 * without republishing `currentHousehold`. A gate reading eligibility off store
 * state alone would therefore stay suppressed after the keys landed. Reading it
 * off the ledger stream closes that gap — the same event that installs the keys
 * re-answers the question.
 *
 * Non-House brands never subscribe: they hold no ledger, and touching the engine
 * would pull the local-first graph into a brand that has no household domain.
 */
function subscribeToHouseAddressCaptureEligibility(listener: () => void): () => void {
  if (!isHouseBrand()) return () => {};
  return subscribeToHouseLedgerChanges(() => listener());
}

export function usePropertyAddressCaptureGate(): boolean {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasCompletedOnboarding = useAuthStore(
    (state) => state.hasCompletedOnboarding
  );
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  // Recomputed on every ledger change rather than remembered: enrolment
  // completing must re-open the question, and it publishes nothing the household
  // store notices.
  const eligibleSnapshot = useSyncExternalStore(
    subscribeToHouseAddressCaptureEligibility,
    useCallback(
      () => (isHouseBrand() ? isHouseAddressCaptureEligible(currentHousehold?.id) : true),
      [currentHousehold]
    )
  );

  const open =
    isAuthenticated &&
    hasCompletedOnboarding &&
    isHouseBrand() &&
    eligibleSnapshot &&
    householdNeedsAddressCapture(currentHousehold);

  // TEMPORARY diagnostic — remove once the staging "Add Your Address" report is
  // closed. The deciding values live in the device's encrypted ledger, so no
  // server query can answer why this gate opened on a given phone.
  if (__DEV__ && isHouseBrand()) {
    // console.error, not log/warn: measured on this device, only `error` is
    // forwarded to the NATIVE logger and so reaches the device syslog. `log`
    // and `warn` reach Metro's terminal only, which is not this session.
    console.error('[AddressGate]', {
      open,
      householdId: currentHousehold?.id ?? null,
      name: currentHousehold?.name ?? null,
      country: currentHousehold?.country ?? null,
      state_province: currentHousehold?.state_province ?? null,
      my_role: (currentHousehold as { my_role?: string } | null)?.my_role ?? null,
      eligible: eligibleSnapshot,
      isAuthenticated,
      hasCompletedOnboarding,
      // Which BACKEND this build is talking to. A dev build resolves staging
      // from `__DEV__` unless SIMPLEHOUSE_API_ENV overrides it, and two devices
      // on different environments cannot see each other's invites at all — the
      // failure surfaces as "Could not join", which reads as a bad code.
      apiEnv: ENV.IS_PRODUCTION ? 'production' : 'staging',
      apiBase: ENV.API_BASE_URL,
    });
  }

  return open;
}

/**
 * Unauthenticated / onboarding-only navigator.
 *
 * Mounted from `app/_layout.tsx` when `!isAuthenticated ||
 * !hasCompletedOnboarding`. Authenticated users render expo-router instead —
 * the legacy Main branch + `MainNavigator` were removed in A7 (MOB-3).
 */
export function RootNavigator() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const needsAddressCapture = usePropertyAddressCaptureGate();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'fade',
      }}
    >
      {!isAuthenticated ? (
        <>
          <Stack.Screen name="Auth" component={AuthNavigator} />
          <Stack.Screen name="AcceptInvite" component={AcceptInviteScreen} />
        </>
      ) : (
        <>
          {/*
            One screen, two entry points, chosen by the device-level gate above.

            A brand-new account gets `undefined` params, so the onboarding stack
            opens on its own initial route (`Welcome`) exactly as before — the
            first-run flow is untouched.

            An already-onboarded member whose home has no province opens straight
            on the address form instead. `{ screen }` with `initial` left unset
            makes `CreateHousehold` the ONLY route in the nested stack rather
            than pushing it on top of `Welcome` (see `getStateFromParams` in
            @react-navigation/core), so there is no back button to a terms screen
            an onboarded member has already accepted, and no flash of Welcome on
            the way in.

            Reusing `CreateHousehold` rather than adding a second address form is
            deliberate: it already owns the Places autocomplete, the CA/US country
            split and the single `householdsApi.create` call, and a second copy of
            that form is a second place for the country code to be wrong.
          */}
          <Stack.Screen
            name="Onboarding"
            component={OnboardingNavigator}
            initialParams={
              needsAddressCapture ? { screen: 'CreateHousehold' } : undefined
            }
          />
          <Stack.Screen name="AcceptInvite" component={AcceptInviteScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}
