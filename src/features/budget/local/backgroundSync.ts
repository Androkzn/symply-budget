import NetInfo from '@react-native-community/netinfo';

import { loadProductTokens } from '@services/secure-token-storage';
import { useAuthStore } from '@stores/authStore';

import {
  getLocalBudgetSession,
  isLocalBudgetSessionOpen,
  listLocalBudgetHouseholds,
  openLocalBudgetSession,
} from './engine';
import { isBudgetLocalFirst } from './flag';
import { loadDbKeyHex } from './persistence';
import { runBudgetLocalSyncFor } from './sync/orchestrator';

export type BackgroundSyncOutcome = 'new-data' | 'no-data' | 'failed';

async function backgroundConnectivity() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Connectivity callbacks can be delayed while iOS resumes the JS runtime.
    // Unknown connectivity must not consume the entire background execution window.
    return await Promise.race([
      NetInfo.fetch().catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1500); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A wake can open existing ledgers, but must never create a household or sign out. */
export async function runBudgetBackgroundSync(householdId?: string): Promise<BackgroundSyncOutcome> {
  if (!isBudgetLocalFirst()) return 'no-data';
  try {
    const started = Date.now();
    console.log(`[BudgetLocal] background start t=${started}`);
    const network = await backgroundConnectivity();
    console.log(`[BudgetLocal] background connectivity t=${Date.now()} elapsed=${Date.now() - started} known=${network !== null}`);
    if (network && (network.isConnected === false || network.isInternetReachable === false)) return 'no-data';
    if (!useAuthStore.persist.hasHydrated()) await useAuthStore.persist.rehydrate();
    let auth = useAuthStore.getState();
    if (!auth.isAuthenticated || !auth.user?.id) return 'no-data';
    const userId = auth.user.id;
    if (!auth.token || !auth.refreshToken) {
      const tokens = await loadProductTokens();
      // Keychain may be unavailable before first unlock. Retry later; no clearing.
      if (!tokens.accessToken || !tokens.refreshToken) return 'no-data';
      if (useAuthStore.getState().user?.id !== userId) return 'no-data';
      useAuthStore.setState({ token: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: tokens.expiresAt });
    }
    if (!isLocalBudgetSessionOpen()) {
      if (!await loadDbKeyHex()) return 'no-data';
      await openLocalBudgetSession({
        userId,
        // Throw before minting if no ledger exists. A background wake is not onboarding.
        decideEmptyDevice: async () => { throw new Error('background_no_existing_ledger'); },
      });
    }
    auth = useAuthStore.getState();
    if (!auth.isAuthenticated || auth.user?.id !== userId) return 'no-data';
    const households = listLocalBudgetHouseholds().filter(h => !householdId || h.householdId === householdId);
    let changed = false;
    for (const household of households) {
      if (useAuthStore.getState().user?.id !== userId || !useAuthStore.getState().isAuthenticated) break;
      const session = await getLocalBudgetSession(household.householdId);
      if (session.ledger.memberId !== userId) continue;
      console.log(`[BudgetLocal] background ledger ready t=${Date.now()} hh=${household.householdId}`);
      const before = JSON.stringify(await session.store.getVersionVector(household.householdId));
      await runBudgetLocalSyncFor(household.householdId, 'background-wake');
      const after = JSON.stringify(await session.store.getVersionVector(household.householdId));
      changed ||= before !== after;
    }
    console.log(`[BudgetLocal] background sync finished households=${households.length} changed=${changed}`);
    return changed ? 'new-data' : 'no-data';
  } catch (error) {
    console.warn('[BudgetLocal] background sync deferred', error);
    return 'failed';
  }
}
