import { describe, expect, it } from 'vitest';

import {
  aeadDecrypt,
  aeadEncrypt,
  bytesEqual,
  createUnlockMaterial,
  generateDeviceIdentity,
  generateHouseholdKeys,
  unwrapHouseholdDataKey,
  unwrapLocalDatabaseKey,
  wrapHouseholdDataKey,
  wrapLocalDatabaseKey,
} from '../src/index';

describe('crypto', () => {
  it('round-trips AES-GCM', () => {
    const key = new Uint8Array(32).fill(7);
    const plain = new TextEncoder().encode('secret-ledger-op');
    const sealed = aeadEncrypt(key, plain);
    const opened = aeadDecrypt(key, sealed);
    expect(bytesEqual(opened, plain)).toBe(true);
  });

  it('wraps local DB key under PIN', () => {
    const material = createUnlockMaterial();
    const wrapped = wrapLocalDatabaseKey('2468', material);
    const opened = unwrapLocalDatabaseKey('2468', material.pinSalt, wrapped);
    expect(bytesEqual(opened, material.localDatabaseKey)).toBe(true);
    expect(() => unwrapLocalDatabaseKey('0000', material.pinSalt, wrapped)).toThrow();
  });

  it('wraps HDK between devices via X25519', () => {
    const a = generateDeviceIdentity('device-a');
    const b = generateDeviceIdentity('device-b');
    const hh = generateHouseholdKeys('hh-1');
    const wrapped = wrapHouseholdDataKey(
      hh.hdk,
      a.agreementPrivateKey,
      b.agreementPublicKey,
      'enrol:hh-1:device-b',
    );
    const opened = unwrapHouseholdDataKey(
      wrapped,
      b.agreementPrivateKey,
      a.agreementPublicKey,
      'enrol:hh-1:device-b',
    );
    expect(bytesEqual(opened, hh.hdk)).toBe(true);
  });
});
