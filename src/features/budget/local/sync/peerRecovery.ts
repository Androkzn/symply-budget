import { fetchControlPlaneState, type ControlPlaneState } from '../controlPlaneClient';
import { getLocalBudgetSession, isHouseholdBootstrapPending } from '../engine';

import { maybePublishCheckpoint } from './checkpoints';
import { depositHdkForDevice } from './hdkTransfer';

const RETRY_AFTER_MS = 6 * 60 * 60_000;

/** Recover a registered device of an existing member without requiring a backup.
 * Only a fully bootstrapped device with the current household key may help.
 * The authenticated roster must authorize both endpoints in this household.
 */
export async function recoverExistingMemberDevices(state: ControlPlaneState): Promise<number> {
  const householdId = state.householdId;
  const session = await getLocalBudgetSession(householdId);
  if (session.awaitingEnrolment || session.householdKeys.keyEpoch !== state.keyEpoch ||
      await isHouseholdBootstrapPending(householdId)) return 0;

  const activeMembers = new Set(state.members.filter(m => m.status === 'active').map(m => m.userId));
  const self = state.devices.find(d => d.deviceId === session.identity.deviceId);
  if (!self || self.status !== 'active' || !activeMembers.has(self.userId)) return 0;

  const candidates = [];
  const now = Date.now();
  for (const device of state.devices) {
    if (device.deviceId === self.deviceId || device.status !== 'active' ||
        !activeMembers.has(device.userId) || !/^[a-fA-F0-9]{64}$/.test(device.agreementPublicKey)) continue;
    const progress = await session.store.getSyncPeerState(householdId, device.deviceId);
    if (progress && Object.keys(progress.knownVv ?? {}).length > 0) continue;
    // Device + public key + epoch: reinstalling or rotating must not reuse an old receipt.
    const marker = `lf.peerRecovery:${householdId}:${device.deviceId}:${device.agreementPublicKey}:${state.keyEpoch}`;
    const lastSent = Number(await session.store.getMeta(marker));
    if (lastSent > 0 && now >= lastSent && now - lastSent < RETRY_AFTER_MS) continue;
    candidates.push({ device, marker });
  }
  if (candidates.length === 0) return 0;

  // Publish history before handing over the key. A failed upload is retried;
  // it must not turn a new device into an apparently complete empty budget.
  if (!await maybePublishCheckpoint(householdId, { force: true })) return 0;
  const fresh = await fetchControlPlaneState(householdId);
  const freshSelf = fresh.devices.find(d => d.deviceId === self.deviceId && d.status === 'active');
  if (!freshSelf || !fresh.members.some(m => m.userId === freshSelf.userId && m.status === 'active')) return 0;
  if (fresh.keyEpoch !== state.keyEpoch || fresh.securityRevision !== state.securityRevision) return 0;
  let delivered = 0;
  for (const { device, marker } of candidates) {
    try {
      const authorized = fresh.devices.find(d => d.deviceId === device.deviceId && d.status === 'active' && d.agreementPublicKey === device.agreementPublicKey);
      if (!authorized || !fresh.members.some(m => m.userId === authorized.userId && m.status === 'active')) continue;
      await depositHdkForDevice({
        householdId,
        recipientDeviceId: device.deviceId,
        recipientAgreementPublicKeyHex: device.agreementPublicKey,
      });
      await session.store.setMeta(marker, String(now));
      delivered += 1;
    } catch (error) {
      console.warn('[BudgetLocal] peer recovery delivery failed', householdId, device.deviceId, error);
    }
  }
  console.log(`[BudgetLocal] peer recovery hh=${householdId} delivered=${delivered}`);
  return delivered;
}
