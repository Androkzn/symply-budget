/**
 * Opaque push wake for Health — the client half of plan §2 item 4.
 *
 * A Health household is **one user with N devices** (§1.2), so the wake path has
 * a failure mode its siblings do not: the Worker's peer query excludes
 * `excludeUserId`, which for Budget/House means "everyone but me" and for Health
 * means "everyone but the only user" — i.e. nobody. The backend fix (dropping
 * `excludeUserId` and excluding by `sourceDeviceId` instead) lives in
 * `backend/src/routes/local-first-v2.ts`; this file is the receiving end.
 *
 * The payload is content-free by design: `{ type, householdId }` and nothing
 * else. The relay never learns what changed, only that something did.
 */
import { Platform } from 'react-native';

import { apiClient } from '@api/client';
import { notificationService } from '@services/notifications';

import { getLocalHealthLedger, isLocalHealthSessionOpen } from './engine';
import { isHealthLocalFirst } from './flag';

const LF_HEADERS = { 'X-Health-Local-First': '1' };

/**
 * Health's wake type. Hard equality against this string is the whole filter —
 * matching the Budget/House clients — so it must stay byte-identical to the
 * backend constant `HEALTH_SYNC_WAKE_TYPE` in
 * `backend/src/services/local-first-sync-wake-service.ts:9`.
 *
 * ⚠️ Health's `budgetMode` is `'minimal'`, so before plan §2 item 4b the shared
 * Worker's `isFullBudget(env) ? BUDGET : HOUSE` selector emitted
 * `house_sync_wake` for Health. Under hard equality that is not a degraded
 * wake — it is no wake at all, silently, forever.
 */
export const HEALTH_SYNC_WAKE_TYPE = 'health_sync_wake';

/**
 * Register this device's Expo push token so the user's OTHER device can wake it
 * after a mailbox deposit.
 *
 * One household, so one call — no per-property loop (House needs one; Health
 * has exactly one personal ledger).
 */
export async function registerHealthLocalPushToken(): Promise<void> {
  if (!isHealthLocalFirst() || !isLocalHealthSessionOpen()) return;

  const hasPermission = await notificationService.hasPermission();
  if (!hasPermission) return;

  const token = await notificationService.initialize();
  if (!token) return;

  const ledger = getLocalHealthLedger();
  try {
    await apiClient.post(
      '/v2/push/register',
      {
        householdId: ledger.household.id,
        deviceId: ledger.deviceId,
        token,
        platform: Platform.OS as 'ios' | 'android',
      },
      { headers: LF_HEADERS },
    );
  } catch (error) {
    console.warn('[health.local] control-plane push register failed', error);
  }
}

/**
 * The He4 seam.
 *
 * `TODO(He4)`: the Health sync client (mailbox pull + apply, no SSE, no
 * EventSource — plan §5) does not exist yet. Rather than invent its internals
 * here, this module holds a one-function registration slot with the shape the
 * orchestrator will have. He4's `runHealthLocalSync` calls
 * `registerHealthSyncRunner(runHealthLocalSync)` at module load, exactly as
 * Budget/House wire `runBudgetLocalSync` / `runHouseLocalSync` by direct import.
 *
 * Until then a wake is a loud no-op: the warning below is the only thing
 * standing between "sync silently never happens" and someone noticing.
 */
export type HealthSyncRunner = () => Promise<void>;

let healthSyncRunner: HealthSyncRunner | null = null;

export function registerHealthSyncRunner(runner: HealthSyncRunner | null): void {
  healthSyncRunner = runner;
}

/** One convergence pass. Resolves once the runner (He4) has finished. */
export async function syncHealthOnce(): Promise<void> {
  if (!healthSyncRunner) {
    console.warn(
      '[health.local] TODO(He4): sync wake received but no sync runner is registered — ' +
        'the ledger will only converge on the next foreground pull.',
    );
    return;
  }
  try {
    await healthSyncRunner();
  } catch (error) {
    console.warn('[health.local] sync wake run failed', error);
  }
}

/**
 * Handle an opaque `health_sync_wake` push.
 *
 * Returns true when the notification was consumed, so the caller does not also
 * route it as a domain notification (a wake carries no user-facing content —
 * routing it as one would surface an empty notification).
 */
export function handleHealthSyncWakeNotification(
  data: Record<string, unknown> | undefined,
): boolean {
  if (!isHealthLocalFirst()) return false;
  // Hard equality, deliberately: a prefix/`includes` match here would swallow
  // `house_sync_wake` on a Health build and vice versa.
  if (data?.type !== HEALTH_SYNC_WAKE_TYPE) return false;

  const householdId = data.householdId;
  if (typeof householdId !== 'string' || !householdId) return false;

  // One personal household: a wake naming any other id is not ours. Checked only
  // when the session is open — a wake that arrives before the ledger opens is
  // still consumed, because the session open runs its own sync anyway.
  if (isLocalHealthSessionOpen() && getLocalHealthLedger().household.id !== householdId) {
    return false;
  }

  void syncHealthOnce();
  return true;
}
