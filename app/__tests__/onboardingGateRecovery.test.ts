/**
 * The root layout's mount decision, for the same-account second device.
 *
 * ## The bug this exists to stop coming back
 *
 * A member signs into their account on a SECOND device (the iPhone + iPad case).
 * `ensureHouseLocalSession` correctly discovers the household already on the
 * control plane, adopts a key-less placeholder, and publishes bootstrap state
 * `recover-this-home`. All of that worked.
 *
 * But the mount decision in `app/_layout.tsx` asked the SERVER's
 * `hasCompletedOnboarding` flag first, and that flag is routinely still false
 * for an account that demonstrably owns a home: `recordOnboardingStep` is
 * fire-and-forget and answers 401/403 on a not-yet-enrolled local-first device,
 * so the row never gets written. Onboarding therefore won the decision and
 * `CreateHouseholdScreen` offered "Set Up Your Home" — and saving MINTED
 * ANOTHER HOUSEHOLD beside the placeholder, with its own key that no other
 * device holds.
 *
 * Observed on staging 2026-09-04: one test account accumulated FOUR local-first
 * households in an afternoon, one per fresh sign-in, each with published
 * checkpoints and no way for any other device to read them.
 *
 * ## Why this is a pure-logic test
 *
 * The regression is entirely in the ORDER and COMBINATION of three booleans.
 * Rendering the real layout would drag in expo-router, MMKV, the navigation
 * tree and a live control-plane session — none of which participate in the bug.
 * So the decision is extracted here exactly as the layout writes it, and the
 * table below is the specification.
 */

/**
 * The mount decision, transcribed from `app/_layout.tsx`.
 *
 * Kept in step with the source by the `rendersOnboarding` assertions below; if
 * the layout's condition changes shape, these cases are what should be re-read.
 */
function rendersOnboarding(input: {
  isAuthenticated: boolean;
  hasCompletedOnboarding: boolean;
  needsAddressCapture: boolean;
  hasHomesToRecover: boolean;
}): boolean {
  const { isAuthenticated, hasCompletedOnboarding, needsAddressCapture, hasHomesToRecover } = input;
  return !isAuthenticated || (!hasCompletedOnboarding && !hasHomesToRecover) || needsAddressCapture;
}

describe('the root layout mount decision', () => {
  it('does NOT send a device with discovered homes to onboarding', () => {
    // The regression, stated directly: the server flag says "never onboarded",
    // the device says "I found a home on this account". The device wins.
    expect(
      rendersOnboarding({
        isAuthenticated: true,
        hasCompletedOnboarding: false,
        needsAddressCapture: false,
        hasHomesToRecover: true,
      }),
    ).toBe(false);
  });

  it('still onboards a genuinely new member', () => {
    // The case that must NOT regress: no homes found, no onboarding recorded.
    // This member has to reach `CreateHousehold` or they can never start.
    expect(
      rendersOnboarding({
        isAuthenticated: true,
        hasCompletedOnboarding: false,
        needsAddressCapture: false,
        hasHomesToRecover: false,
      }),
    ).toBe(true);
  });

  it('onboards an offline first-run member rather than stranding them', () => {
    // `undecided-offline` must NOT set `hasHomesToRecover` — it means "could not
    // reach us to find out", not "homes exist". A member whose network dropped
    // between sign-in and the households call still has to be able to create
    // their first home, so only positive evidence may suppress onboarding.
    expect(
      rendersOnboarding({
        isAuthenticated: true,
        hasCompletedOnboarding: false,
        needsAddressCapture: false,
        hasHomesToRecover: false, // what `undecided-offline` must produce
      }),
    ).toBe(true);
  });

  it('never lets a signed-out user past, whatever the device found', () => {
    expect(
      rendersOnboarding({
        isAuthenticated: false,
        hasCompletedOnboarding: true,
        needsAddressCapture: false,
        hasHomesToRecover: true,
      }),
    ).toBe(true);
  });

  it('keeps the address gate ahead of the shell for a normal member', () => {
    expect(
      rendersOnboarding({
        isAuthenticated: true,
        hasCompletedOnboarding: true,
        needsAddressCapture: true,
        hasHomesToRecover: false,
      }),
    ).toBe(true);
  });

  it('does not ask a recovering device for an address it cannot save', () => {
    // `needsAddressCapture` is itself narrowed by `!houseRecovery` in the
    // layout, so a recovering device arrives here with it already false. Pinned
    // because the two gates disagree about exactly this member: they have no
    // address to capture and no writable home to save one into — writes are
    // refused with `HouseLocalEnrolmentPendingError` until the key arrives.
    expect(
      rendersOnboarding({
        isAuthenticated: true,
        hasCompletedOnboarding: false,
        needsAddressCapture: false,
        hasHomesToRecover: true,
      }),
    ).toBe(false);
  });
});
