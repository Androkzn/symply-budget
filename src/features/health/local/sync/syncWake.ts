/**
 * Explicit `POST /v2/households/:id/sync-wake` for Health (plan §2 item 4c).
 *
 * WHY HEALTH HAS THIS AND HOUSE DOES NOT
 * --------------------------------------
 * House never calls the route: its wakes ride the `wake: true` flag on the last
 * chunk of a mailbox deposit, which is enough for a household that always has
 * something to deposit. Health kept an explicit call because a personal ledger
 * has to be able to poke its own other devices without one.
 *
 * The exclusion itself is no longer brand-specific: every brand now excludes the
 * depositing DEVICE and nothing else, so a member's own second device is woken
 * on House and Budget too. Health is only the brand with no FALLBACK — where the
 * others can degrade to excluding the caller's `user_id`, a personal household
 * holds ONE user with N devices (§1.2), so `user_id != <the only user>` matches
 * zero rows and the wake would reach nobody.
 *
 * That makes `sourceDeviceId` load-bearing rather than optional here. A wake sent
 * without one excludes NOTHING and the caller wakes itself: `syncOnce` → deposit
 * → wake → `syncOnce`, forever, on a background push. The route refuses it with
 * 400 `source_device_required`; this module refuses to send it at all, which is
 * the same decision one hop earlier and one round trip cheaper.
 *
 * The wake payload stays content-free — `{ type, householdId }` only. It is an
 * opaque "come and look", never data: the relay is zero-knowledge and a health
 * push notification that carried a value would leak on a lock screen.
 */
import { apiClient } from '@api/client';

import { getLocalHealthHouseholdKeys, getLocalHealthIdentity, isLocalHealthSessionOpen } from '../engine';
import { isHealthLocalFirst } from '../flag';

import { HEALTH_LOCAL_FIRST_HEADERS } from './headers';

/** The Worker's refusal code when a device-excluding brand sends no source device. */
export const SYNC_WAKE_SOURCE_DEVICE_REQUIRED = 'source_device_required';

export function healthSyncWakePath(householdId: string): string {
  return `/v2/households/${householdId}/sync-wake`;
}

/**
 * Ask the relay to push an opaque wake to this user's OTHER devices.
 *
 * Returns whether the request was actually sent. Never throws: a wake is an
 * optimization over the next foreground pull, and a failed one must not turn a
 * successful sync into a failed one.
 */
export async function requestHealthSyncWake(input?: {
  householdId?: string;
  sourceDeviceId?: string;
}): Promise<boolean> {
  if (!isHealthLocalFirst() || !isLocalHealthSessionOpen()) return false;

  const householdId = input?.householdId ?? getLocalHealthHouseholdKeys().householdId;
  const sourceDeviceId = input?.sourceDeviceId ?? getLocalHealthIdentity().deviceId;

  if (!householdId || !sourceDeviceId) {
    // Not an error worth surfacing, but it must never be sent: see the header
    // note — an unexcluded self-wake is a push loop, not a degraded sync.
    console.warn('[health.local] sync wake skipped: no source device id');
    return false;
  }

  try {
    await apiClient.post(
      healthSyncWakePath(householdId),
      { sourceDeviceId },
      { headers: HEALTH_LOCAL_FIRST_HEADERS },
    );
    return true;
  } catch (error) {
    console.warn('[health.local] sync wake failed', error);
    return false;
  }
}
