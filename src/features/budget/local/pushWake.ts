import { Platform } from 'react-native';

import { apiClient } from '@api/client';
import { notificationService } from '@services/notifications';

import { budgetHouseholdIsOnControlPlane } from './controlPlaneClient';
import { isLocalBudgetSessionOpen, listLocalBudgetHouseholds } from './engine';
import { isBudgetLocalFirst } from './flag';
import { runBudgetLocalSyncFor } from './sync/orchestrator';

const LF_HEADERS = { 'X-Budget-Local-First': '1' };
export const BUDGET_SYNC_WAKE_TYPE = 'budget_sync_wake';

/**
 * Register this device's Expo push token on the Budget V2 control plane so
 * peers can send opaque sync wakes after mailbox deposits.
 *
 * Once per household (BR-016), not once per device: a wake is addressed to a
 * (householdId, deviceId) pair, and a peer can only wake this device for the
 * household it shares with it. Registering only the active one left every other
 * household unreachable by push — its peers deposited and nothing here ever
 * learned about it until the member happened to switch to it by hand.
 *
 * Callers must re-run this after a household is created, joined or removed:
 * the registration set is a snapshot of the list at the moment it ran.
 */
export async function registerBudgetLocalPushToken(): Promise<void> {
  if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) return;

  const hasPermission = await notificationService.hasPermission();
  if (!hasPermission) return;

  const token = await notificationService.initialize();
  if (!token) return;

  for (const household of listLocalBudgetHouseholds()) {
    // Only the households the control plane actually holds. A wake is addressed
    // to a (householdId, deviceId) pair, so a solo local household has nobody to
    // be woken by — and registering one would ask the server for a row this
    // device deliberately never created.
    if (!(await budgetHouseholdIsOnControlPlane(household.householdId))) continue;
    try {
      await apiClient.post(
        '/v2/push/register',
        {
          householdId: household.householdId,
          // The same device id in every row — one device, one identity,
          // registered once per membership.
          deviceId: household.deviceId,
          token,
          platform: Platform.OS as 'ios' | 'android',
        },
        { headers: LF_HEADERS },
      );
    } catch (error) {
      // One household's registration failing must not cost the others theirs.
      console.warn(
        '[budget.local] control-plane push register failed',
        household.householdId,
        error,
      );
    }
  }
}

/**
 * Handle opaque `budget_sync_wake` push — triggers foreground/on-open sync.
 * Returns true when the notification was consumed.
 */
export function handleBudgetSyncWakeNotification(
  data: Record<string, unknown> | undefined,
): boolean {
  if (!isBudgetLocalFirst()) return false;
  if (data?.type !== BUDGET_SYNC_WAKE_TYPE) return false;

  const householdId = data.householdId;
  if (typeof householdId !== 'string' || !householdId) return false;

  if (!isLocalBudgetSessionOpen()) return false;
  // Sync the household the wake NAMES, not whichever one is active. The old
  // code returned false for anything but the active household, so a peer's
  // deposit into a background household woke nothing at all; syncing the active
  // household instead would be both wrong and wasteful — it is not the one that
  // has ops waiting.
  const known = listLocalBudgetHouseholds().some(
    (household) => household.householdId === householdId,
  );
  if (!known) return false;

  void runBudgetLocalSyncFor(householdId, 'push-wake');
  return true;
}
