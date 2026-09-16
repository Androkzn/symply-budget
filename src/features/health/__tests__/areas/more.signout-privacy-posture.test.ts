/**
 * Symply Health — the two PROMISES the More tab makes in words.
 *
 * `HealthMoreScreen` has one destructive control and one explainer, and both
 * make claims that only hold if code elsewhere behaves:
 *
 *   1. **Sign out** — `HealthMoreScreen.test.tsx` proves the row confirms and
 *      then calls `logout()`. It mocks the store, so what `logout()` actually
 *      DOES is untested from Health's side, and the "Where your data lives"
 *      alert ends with "Signing out clears the copy cached on this device". On
 *      a shared handset that sentence is the whole privacy story: if the health
 *      snapshots survive sign-out, the next person to sign in sees the previous
 *      person's weight, cycle and injury log.
 *      `healthCacheKeys.test.ts` proves the LIST is complete; nothing proved the
 *      list is actually used.
 *
 *   2. **"Where your data lives"** — four claims, asserted as copy by
 *      `HEALTH-MORE-038`. This file checks them against the shipped posture
 *      instead of against themselves, because a privacy explainer that has
 *      drifted from the code is worse than no explainer: it is a false
 *      statement a member relied on. One of the four is ALREADY false — see
 *      HEALTH-MORE-083.
 *
 * The screen source is read as text (the pattern `healthCacheKeys.test.ts`
 * uses) so the copy is checked exactly as it ships, without mounting the tree.
 */

/* Node built-ins below are read at module scope; the jest.mock factories above are hoisted. */
import fs from 'fs';
import path from 'path';

const mockClearProductTokens = jest.fn().mockResolvedValue(undefined);
const mockClearCompanionToken = jest.fn().mockResolvedValue(undefined);

jest.mock('@services/secure-token-storage', () => ({
  loadProductTokens: jest.fn().mockResolvedValue({ accessToken: null, refreshToken: null }),
  saveProductTokens: jest.fn().mockResolvedValue(undefined),
  clearProductTokens: (...a: unknown[]) => mockClearProductTokens(...a),
  clearCompanionToken: (...a: unknown[]) => mockClearCompanionToken(...a),
}));

jest.mock('@services/biometric', () => ({
  biometricService: {
    disableBiometric: jest.fn().mockResolvedValue(undefined),
    updateStoredRefreshToken: jest.fn().mockResolvedValue(undefined),
    rememberEmail: jest.fn(),
    hasStoredCredentials: jest.fn(async () => false),
  },
}));

jest.mock('@services/analytics', () => ({
  trackEvent: jest.fn(),
  AnalyticsEvent: { SIGNED_IN: 'signed_in', SIGNED_OUT: 'signed_out', ONBOARDING_COMPLETED: 'ob' },
}));

jest.mock('@services/settings-sync', () => ({
  settingsSync: { flushNow: jest.fn(), queueSync: jest.fn() },
}));

// The Health API client is never reached here, but importing it pulls in the
// axios instance and the env config; stub it so this file stays a pure
// storage/session test.
jest.mock('@api/health');

import { healthApi } from '@api/health';
import { healthAiApi } from '@api/healthAi';
import { asyncStorage } from '@services/storage';
import { useAuthStore } from '@stores/authStore';

import { HEALTH_CACHE_KEYS } from '../../healthCacheKeys';

const SIGNED_IN_STATE = {
  user: { id: 'u_health' } as never,
  token: 'access-token',
  refreshToken: 'refresh-token',
  isAuthenticated: true,
  isLoading: false,
  hasCompletedOnboarding: true,
  biometricEnabled: false,
  biometricPromptShown: false,
};

/** Keys `asyncStorage.removeItem` was asked to drop during the last logout. */
function removedKeys(spy: jest.SpyInstance): string[] {
  return spy.mock.calls.map((c) => String(c[0]));
}

describe('HEALTH-MORE-080 — Sign out clears the session AND the Health cache', () => {
  let removeItem: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // `StateStorage.removeItem` is declared `=> void | Promise<void>`, so the
    // resolved value is typed `never`; an async no-op satisfies both arms.
    removeItem = jest.spyOn(asyncStorage, 'removeItem').mockImplementation(async () => undefined);
    useAuthStore.setState({ ...SIGNED_IN_STATE });
  });

  afterEach(() => {
    removeItem.mockRestore();
  });

  it('flips the session off — token, refresh token and user all gone', async () => {
    await expect(useAuthStore.getState().logout()).resolves.toBeUndefined();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
    expect(mockClearProductTokens).toHaveBeenCalledTimes(1);
    expect(mockClearCompanionToken).toHaveBeenCalledTimes(1);
  });

  it('removes EVERY Symply Health cache key, not a subset', async () => {
    // Named individually rather than "some health.* key was cleared": the leak
    // that matters is one key surviving, and a `.some()` assertion passes with
    // twenty-five of twenty-six cleared.
    await useAuthStore.getState().logout();

    const removed = new Set(removedKeys(removeItem));
    const survivors = HEALTH_CACHE_KEYS.filter((key) => !removed.has(key));
    expect(survivors).toEqual([]);
    expect(HEALTH_CACHE_KEYS.length).toBeGreaterThan(20); // the scan itself must not go empty
  });

  it('still clears them when part of the teardown fails', async () => {
    // `resetAppStores()` runs BEFORE `clearPersistedStores()` and imports ~14
    // store modules dynamically. If one of them throwing could abort the
    // sequence, the health snapshots would survive a sign-out on exactly the
    // handsets where something is already going wrong.
    const failing = jest
      .spyOn(asyncStorage, 'removeItem')
      .mockImplementation(async (key: string) => {
        if (key === 'household-storage') throw new Error('TEST: storage backend gone');
      });
    useAuthStore.setState({ ...SIGNED_IN_STATE });

    await expect(useAuthStore.getState().logout()).resolves.toBeUndefined();

    const removed = new Set(removedKeys(failing));
    expect(HEALTH_CACHE_KEYS.filter((key) => !removed.has(key))).toEqual([]);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    failing.mockRestore();
  });
});

/* ------------------------------------------------------------------ *
 * The explainer, checked against the code rather than against itself.
 * ------------------------------------------------------------------ */

const MORE_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'screens', 'HealthMoreScreen.tsx'),
  'utf8',
);

/** The body of the "Where your data lives" alert, exactly as it ships. */
function privacyBody(): string {
  const match = MORE_SOURCE.match(/'Where your data lives',\s*\n\s*'([^']+)'/);
  if (!match) throw new Error('Could not find the "Where your data lives" alert body');
  return match[1];
}

describe('HEALTH-MORE-081 — the explainer is checked against the shipped posture', () => {
  it('claims a private per-account record, and the Health cache is namespaced per app', async () => {
    // "never shared with other Symply apps" is enforceable at the key level:
    // every Health snapshot lives under `health.`, so no sibling brand's store
    // can read one by name, and sign-out clears them by that same prefix list.
    expect(privacyBody()).toMatch(/never shared with other Symply apps/i);
    const foreign = HEALTH_CACHE_KEYS.filter((key) => !key.startsWith('health.'));
    expect(foreign).toEqual([]);
  });

  it('claims sign-out clears the local copy, and HEALTH-MORE-080 proves it does', () => {
    expect(privacyBody()).toMatch(/signing out clears the copy cached on this device/i);
    // The proof is the suite above; this pins the sentence to it so a reworded
    // claim ("we keep a copy for offline use") cannot pass silently.
    expect(HEALTH_CACHE_KEYS.length).toBeGreaterThan(0);
  });

  it('does NOT claim the data stays on the device — P1 moved it to the Worker', () => {
    // The retired lie. Left as a negative because it was true copy once, which
    // is exactly how it would come back in a "restore the old wording" edit.
    const body = privacyBody();
    expect(body).not.toMatch(/on this device only/i);
    expect(body).not.toMatch(/no cloud sync/i);
    expect(body).not.toMatch(/never leaves (this|your) (device|phone|iPhone)/i);
  });
});

describe('HEALTH-MORE-082 — More LINKS to the preference screens, it does not BE them', () => {
  it('renders no toggle of its own — every control here navigates, expands or confirms', () => {
    // The Worker ships a full activity-notification-preference surface
    // (`GET|PUT /health/activity-preferences`, ten flags) with a real client on
    // `healthApi`, and a `Notifications` row landed on More on 2026-07-26. The
    // row NAVIGATES: the flags themselves are edited on
    // `HealthNotificationSettingsScreen` (`/health-notifications`), and the same
    // is true of Goals and Widget.
    //
    // That split is the posture this guards. A `Switch` appearing on More would
    // mean a flag can be written from a screen whose tests, matrix rows and
    // Maestro flow are all built around "this tab navigates and confirms" — and
    // a half-tapped toggle behind a scrolling settings list is the easiest
    // possible way to silently change someone's notifications.
    //
    // Every mutation this tab performs goes through a two-step affordance
    // instead: an inline picker (units), an inventory panel plus a system Alert
    // (clear all), or a system Alert (sign out).
    expect(MORE_SOURCE).not.toMatch(/<Switch\b/);
    // …and it does not talk to the preference route directly either.
    expect(MORE_SOURCE).not.toMatch(/activity-preferences/i);
    expect(MORE_SOURCE).not.toMatch(/saveNotificationPreferences|saveWidgetPreferences/);

    // It DOES link to the screen that owns those flags.
    expect(MORE_SOURCE).toMatch(/'\/health-notifications'/);

    // The clients themselves are real and non-empty — this guard must not be
    // passing because a module failed to load.
    expect([...Object.keys(healthApi), ...Object.keys(healthAiApi)].length).toBeGreaterThan(20);
  });
});

describe('HEALTH-MORE-083 — DEFECT: the "never sent to an AI provider" claim is false', () => {
  it('pins the contradiction between the privacy copy and the shipped AI surfaces', () => {
    // ── READ THIS BEFORE "FIXING" THE TEST ──────────────────────────────────
    // The alert tells the member their health entries are "never sent to an AI
    // provider". That was true in the P1 shell. It is NOT true now:
    //
    //   * `healthAiApi.coachTurn` (src/api/healthAi.ts) POSTs to
    //     `/health/ai/coach/turn`, called from `healthCoachStorage.sendCoachMessage`.
    //   * The Worker's `HealthCoachService` then reads the member's OWN rows —
    //     calories, protein, water and their goals — builds a context block from
    //     them and puts it in the system prompt it hands to the AI provider
    //     (backend/src/services/health-ai/coach-service.ts, "2 — the user's own
    //     figures" → `buildHealthCoachContextBlock` → `provider.generate`).
    //   * Scan does the same with a photograph of a meal or a label.
    //
    // Both are consent-gated and both are opt-in, so the honest sentence is
    // "…and are only sent to an AI provider when you ask the Coach or the
    // scanner for help" — not "never". Rewriting user-facing privacy copy is a
    // product decision, so this pass REPORTS it rather than editing it.
    //
    // This test passes today by asserting BOTH halves of the contradiction, so
    // it fails the moment either one changes — which is the point. When the
    // copy is corrected, delete this case and update HEALTH-MORE-038.
    expect(privacyBody()).toMatch(/never sent to an AI provider/i);

    // The other half: an AI path that carries the member's own health figures
    // exists and is reachable from the shipped app.
    expect(typeof healthAiApi.coachTurn).toBe('function');
    expect(typeof healthAiApi.setCoachConsent).toBe('function');
  });
});
