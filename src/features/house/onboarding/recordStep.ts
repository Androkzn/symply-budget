/**
 * Record an onboarding step on the server WITHOUT making the member wait for it.
 *
 * ## The bug this exists for
 *
 * "Skip & Finish Setup" did nothing for thirty seconds. Not figuratively — the
 * device log has `hasCompletedOnboarding: false` at 10:36:59 and `true` at
 * 10:37:23, with no busy state on the button in between, because the handler
 * read:
 *
 *     try { await userApi.updateOnboardingStep('complete'); } catch { … }
 *     completeOnboarding();
 *
 * Every one of those handlers already carried a comment saying this call is
 * "bookkeeping, not a gate" — and each one handled the call THROWING while
 * still waiting for it to settle. A rejection is instant; a hang is not.
 * `ENV.TIMEOUTS.API_REQUEST` is 30 000ms, and a 401 adds a refresh plus a retry
 * on top of it, so the worst case is minutes of a button that looks broken.
 *
 * The endpoint is exactly the one most likely to stall on a local-first House
 * build: the device may not be enrolled, so `/users/me/...` answers 401 or 403
 * rather than quickly succeeding.
 *
 * ## Why fire-and-forget is the correct shape, not a shortcut
 *
 * `hasCompletedOnboarding` is CLIENT state (`authStore`). The server's copy is a
 * convenience for a future sign-in on another device and gates nothing. So the
 * ordering that matters is "finish onboarding, then tell the server if we can" —
 * never the reverse. Nothing downstream reads the response, which is why no
 * caller needs the promise back.
 *
 * The rejection is swallowed on purpose: an un-caught floating promise is an
 * unhandled rejection, and there is nothing to tell the member. Setup IS
 * finished; the only casualty is a record the member never sees.
 */
import { userApi } from '@api/user';

export type HouseOnboardingStepName = Parameters<
  typeof userApi.updateOnboardingStep
>[0];

export function recordOnboardingStep(step: HouseOnboardingStepName): void {
  void userApi.updateOnboardingStep(step).catch(error => {
    console.warn(`Could not record onboarding step "${step}" remotely`, error);
  });
}
