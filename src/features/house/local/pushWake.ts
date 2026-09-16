import { Platform } from 'react-native';

import { apiClient } from '@api/client';
import { notificationService } from '@services/notifications';

import { isLocalHouseSessionOpen, listLocalHouseProperties } from './engine';
import { isHouseLocalFirst } from './flag';
import { runHouseLocalSyncFor } from './sync/orchestrator';

const LF_HEADERS = { 'X-House-Local-First': '1' };

/**
 * The opaque wake type for House. The Worker's
 * `local-first-sync-wake-service.ts` was generalized in H0 to accept
 * `'budget_sync_wake' | 'house_sync_wake'`, with `validateOpaqueWakePayload()`
 * and `PROHIBITED_WAKE_PAYLOAD_KEYS` unchanged — the payload schema was NOT
 * widened, because the wake must stay content-free for the relay to remain
 * zero-knowledge.
 */
export const HOUSE_SYNC_WAKE_TYPE = 'house_sync_wake';

/**
 * Register this device's Expo push token on the control plane so peers can send
 * opaque sync wakes after mailbox deposits.
 */
export async function registerHouseLocalPushToken(): Promise<void> {
  if (!isHouseLocalFirst() || !isLocalHouseSessionOpen()) return;

  const hasPermission = await notificationService.hasPermission();
  if (!hasPermission) return;

  const token = await notificationService.initialize();
  if (!token) return;

  // Once per property: each one has its own peer set, and a peer can only wake
  // this device for a property it shares with it. Registering only the active
  // property would silently stop background properties from ever being woken.
  for (const property of listLocalHouseProperties()) {
    try {
      await apiClient.post(
        '/v2/push/register',
        {
          householdId: property.householdId,
          deviceId: property.deviceId,
          token,
          platform: Platform.OS as 'ios' | 'android',
        },
        { headers: LF_HEADERS },
      );
    } catch (error) {
      console.warn('[house.local] control-plane push register failed', property.householdId, error);
    }
  }
}

/**
 * Handle an opaque `house_sync_wake` push — triggers a foreground sync.
 * Returns true when the notification was consumed, so the caller does not also
 * route it as a domain notification.
 */
export function handleHouseSyncWakeNotification(
  data: Record<string, unknown> | undefined,
): boolean {
  if (!isHouseLocalFirst()) return false;
  if (data?.type !== HOUSE_SYNC_WAKE_TYPE) return false;

  const householdId = data.householdId;
  if (typeof householdId !== 'string' || !householdId) return false;

  // Route the wake to the property it names (plan §7 rule 5) — NOT to whichever
  // one is active. A member looking at property A must still converge property B
  // when B's peer deposits, and syncing A because B was poked would be both
  // wrong and wasteful.
  if (!isLocalHouseSessionOpen()) return false;
  const known = listLocalHouseProperties().some(
    (property) => property.householdId === householdId,
  );
  if (!known) return false;

  void runHouseLocalSyncFor(householdId, 'push-wake');
  return true;
}
