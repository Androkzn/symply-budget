import type { HouseholdState } from './local-first-control-service';

export type SignedCheckpoint = {
  v: 1;
  householdId: string;
  generation: number;
  versionVector: Record<string, number>;
  chunkCount: number;
  rootHash: string;
  signerDeviceId: string;
  signatureB64: string;
};

/** Any active member may supply history, but may only sign as their own device. */
export async function verifyCheckpointPublisher(
  state: HouseholdState,
  userId: string,
  manifest: SignedCheckpoint,
): Promise<boolean> {
  const signer = state.devices.find(d => d.deviceId === manifest.signerDeviceId &&
    d.userId === userId && d.status === 'active');
  if (manifest.householdId !== state.householdId || !signer ||
      !state.members.some(m => m.userId === userId && m.status === 'active') ||
      !/^[0-9a-f]{64}$/i.test(signer.signingPublicKey)) return false;
  try {
    const key = await crypto.subtle.importKey('raw',
      Uint8Array.from(signer.signingPublicKey.match(/../g)!, h => parseInt(h, 16)),
      { name: 'Ed25519' }, false, ['verify']);
    const payload = new TextEncoder().encode(JSON.stringify({
      v: manifest.v,
      householdId: manifest.householdId,
      generation: manifest.generation,
      versionVector: Object.fromEntries(Object.entries(manifest.versionVector)
        .sort(([a], [b]) => a < b ? -1 : 1)),
      chunkCount: manifest.chunkCount,
      rootHash: manifest.rootHash,
      signerDeviceId: manifest.signerDeviceId,
    }));
    return await crypto.subtle.verify('Ed25519', key,
      Uint8Array.from(atob(manifest.signatureB64), c => c.charCodeAt(0)), payload);
  } catch { return false; }
}
