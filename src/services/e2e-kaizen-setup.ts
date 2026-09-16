import * as Linking from 'expo-linking';
import { router } from 'expo-router';

import { hasBrandCapability } from '@brand';
import { LifeSystem } from '@features/kaizen/constants';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAuthStore } from '@stores/authStore';

let pendingSetup = false;
let setupRetryTimer: ReturnType<typeof setTimeout> | null = null;

function isE2ESetupUrl(parsed: Linking.ParsedURL): boolean {
  return (
    parsed.hostname === 'e2e-setup' ||
    parsed.path === '/e2e-setup' ||
    parsed.path === 'e2e-setup'
  );
}

export function buildE2ESetupUrl(): string {
  return 'kaizen://e2e-setup';
}

/** Dev-only: mark Kaizen onboarding complete so Maestro can reach hub screens. */
export async function applyE2EKaizenSetup(): Promise<void> {
  if (!__DEV__ || !hasBrandCapability('kaizenApi')) return;
  if (!useAuthStore.getState().isAuthenticated) {
    pendingSetup = true;
    return;
  }

  const store = useKaizenStore.getState();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await store.hydrate();
    if (store.profile?.user_id) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await store.setOnboardingComplete([LifeSystem.Career]);
  await store.finishOnboarding();
  await store.saveCareerSetup({
    targetRoles: ['Software Engineer'],
    goalTypes: ['interview'],
    step: 'complete',
  });

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await store.hydrate();
    if (store.profile?.onboarding_complete) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // OnboardingScreen does not re-gate when the store flips — leave the setup
  // route so KaizenTodayScreen can render Today.
  try {
    router.replace('/');
  } catch {
    // Router may not be mounted yet; Maestro openLink covers that case.
  }

  pendingSetup = false;
}

function scheduleE2ESetupRetry(): void {
  if (setupRetryTimer) return;
  setupRetryTimer = setTimeout(() => {
    setupRetryTimer = null;
    void flushPendingE2EKaizenSetup().then(applied => {
      if (!applied && pendingSetup) scheduleE2ESetupRetry();
    });
  }, 1000);
}

export function tryQueueE2ESetupFromUrl(url: string | null | undefined): boolean {
  if (!__DEV__ || !url || !hasBrandCapability('kaizenApi')) return false;

  const parsed = Linking.parse(url);
  if (!isE2ESetupUrl(parsed)) return false;

  pendingSetup = true;
  scheduleE2ESetupRetry();
  return true;
}

export async function flushPendingE2EKaizenSetup(): Promise<boolean> {
  if (!pendingSetup || !__DEV__ || !hasBrandCapability('kaizenApi')) return false;
  if (!useAuthStore.getState().isAuthenticated) return false;
  await applyE2EKaizenSetup();
  return !pendingSetup;
}

export function hasPendingE2EKaizenSetup(): boolean {
  return pendingSetup;
}

/** @internal test helper */
export function __resetE2EKaizenSetupStateForTests(): void {
  pendingSetup = false;
  if (setupRetryTimer) {
    clearTimeout(setupRetryTimer);
    setupRetryTimer = null;
  }
}
