import { describe, expect, it } from 'vitest';

import { verifyCheckpointPublisher, type SignedCheckpoint } from '../checkpoint-authorization';
import type { HouseholdState } from '../local-first-control-service';

async function fixture() {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const exported = await crypto.subtle.exportKey('raw', keys.publicKey);
  if (!(exported instanceof ArrayBuffer)) throw new Error('Expected raw public key');
  const bytes = new Uint8Array(exported);
  const unsigned = { v: 1 as const, householdId: 'h', generation: 7,
    versionVector: { a: 1, z: 2 }, chunkCount: 1, rootHash: 'root', signerDeviceId: 'device' };
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey,
    new TextEncoder().encode(JSON.stringify(unsigned))));
  const manifest: SignedCheckpoint = { ...unsigned, signatureB64: btoa(String.fromCharCode(...sig)) };
  const state = { householdId: 'h', members: [{userId: 'member', status:'active', role:'ADULT'}],
    devices:[{ deviceId:'device', userId:'member', status:'active',
      signingPublicKey: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') }] } as HouseholdState;
  return {manifest, state};
}

describe('checkpoint publisher authorization', () => {
  it('accepts a signed snapshot from an active ordinary member', async () => {
    const {state, manifest} = await fixture();
    expect(await verifyCheckpointPublisher(state, 'member', manifest)).toBe(true);
    expect(await verifyCheckpointPublisher(state, 'member', {...manifest, versionVector:{z:2,a:1}})).toBe(true);
  });
  it.each(['other-account', 'revoked-device', 'revoked-member', 'other-household', 'tampered', 'malformed'])('rejects %s', async reason => {
    const {state, manifest} = await fixture();
    if (reason === 'revoked-device') state.devices[0]!.status = 'revoked';
    if (reason === 'revoked-member') state.members[0]!.status = 'revoked';
    if (reason === 'other-household') manifest.householdId = 'other';
    if (reason === 'tampered') manifest.chunkCount = 2;
    if (reason === 'malformed') manifest.signatureB64 = '?';
    expect(await verifyCheckpointPublisher(state, reason === 'other-account' ? 'stranger' : 'member', manifest)).toBe(false);
  });
});
