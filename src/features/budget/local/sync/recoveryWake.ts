import { apiClient } from '@api/client';

import { getLocalBudgetSession } from '../engine';

const RETRY_MS = 15 * 60_000;

/** A key-less device has no op to deposit, so it must explicitly wake its peers. */
export async function requestRecoveryWake(householdId: string): Promise<void> {
  const session = await getLocalBudgetSession(householdId);
  if (!session.awaitingEnrolment) return;
  const marker = `lf.recoveryWake:${householdId}:${session.identity.deviceId}`;
  const now = Date.now();
  const previous = Number(await session.store.getMeta(marker));
  if (previous > 0 && now >= previous && now - previous < RETRY_MS) return;
  // Persist before the request: a push can re-enter sync or wake a cold process.
  await session.store.setMeta(marker, String(now));
  try {
    const response = await apiClient.post<{ wake: { attempted: number; sent: number } }>(
      `/v2/households/${encodeURIComponent(householdId)}/sync-wake`,
      { sourceDeviceId: session.identity.deviceId },
      { headers: { 'X-Budget-Local-First': '1' } },
    );
    console.log('[BudgetLocal] recovery wake requested', { householdId, ...response.data.wake });
  } catch (error) {
    // Retry sooner after a failed transport, while still preventing a tight loop.
    await session.store.setMeta(marker, String(now - RETRY_MS + 60_000));
    console.warn('[BudgetLocal] recovery wake deferred', error);
  }
}
