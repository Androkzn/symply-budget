import { x25519 } from '@noble/curves/ed25519';
import { argon2id } from '@noble/hashes/argon2';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

import type { DeviceIdentity, HouseholdKeys, UnlockMaterial } from '../types';

import { aeadDecrypt, aeadEncrypt } from './aead';
import { randomBytes, utf8Encode } from './bytes';
import { generateSigningKeyPair } from './sign';

/** Lightweight Argon2id params for mobile-friendly unlock (tune before GA). */
const ARGON2_OPTS = {
  t: 2,
  m: 19_456,
  p: 1,
  dkLen: 32,
} as const;

/** Recovery-phrase KDF profiles (stored on backup archives when present). */
export type RecoveryKdfParams = {
  t: number;
  m: number;
  p: number;
  dkLen: number;
};

/** Pre-v2 archives / migration files sealed before mobile tuning. */
export const RECOVERY_KDF_LEGACY: RecoveryKdfParams = {
  t: 3,
  m: 65_536,
  p: 1,
  dkLen: 32,
};

/** Default for new backups — Hermès-friendly (~2s on desktop, OK on phone). */
export const RECOVERY_KDF_MOBILE: RecoveryKdfParams = {
  ...ARGON2_OPTS,
};

export function generateDeviceIdentity(deviceId: string): DeviceIdentity {
  const signing = generateSigningKeyPair();
  const agreementPrivateKey = randomBytes(32);
  const agreementPublicKey = x25519.getPublicKey(agreementPrivateKey);
  return {
    deviceId,
    signingPrivateKey: signing.privateKey,
    signingPublicKey: signing.publicKey,
    agreementPrivateKey,
    agreementPublicKey,
  };
}

export function generateHouseholdKeys(householdId: string, keyEpoch = 1): HouseholdKeys {
  return {
    householdId,
    hdk: randomBytes(32),
    keyEpoch,
  };
}

export function createUnlockMaterial(): UnlockMaterial {
  return {
    localDatabaseKey: randomBytes(32),
    pinSalt: randomBytes(16),
  };
}

export function deriveUnlockKeyFromPin(pin: string, salt: Uint8Array): Uint8Array {
  return argon2id(utf8Encode(pin), salt, ARGON2_OPTS);
}

/** Wrap local DB key under PIN-derived key. */
export function wrapLocalDatabaseKey(pin: string, material: UnlockMaterial): Uint8Array {
  const unlockKey = deriveUnlockKeyFromPin(pin, material.pinSalt);
  try {
    return aeadEncrypt(unlockKey, material.localDatabaseKey, utf8Encode('local-db-key-v1'));
  } finally {
    unlockKey.fill(0);
  }
}

export function unwrapLocalDatabaseKey(
  pin: string,
  pinSalt: Uint8Array,
  wrapped: Uint8Array,
): Uint8Array {
  const unlockKey = deriveUnlockKeyFromPin(pin, pinSalt);
  try {
    return aeadDecrypt(unlockKey, wrapped, utf8Encode('local-db-key-v1'));
  } finally {
    unlockKey.fill(0);
  }
}

/** Wrap HDK for a peer device using ECDH + HKDF + AEAD (enrolment path). */
export function wrapHouseholdDataKey(
  hdk: Uint8Array,
  senderAgreementPrivateKey: Uint8Array,
  recipientAgreementPublicKey: Uint8Array,
  aadContext: string,
): Uint8Array {
  const shared = x25519.getSharedSecret(senderAgreementPrivateKey, recipientAgreementPublicKey);
  const wrapKey = hkdf(sha256, shared, undefined, utf8Encode(`hdk-wrap-v1:${aadContext}`), 32);
  shared.fill(0);
  try {
    return aeadEncrypt(wrapKey, hdk, utf8Encode(aadContext));
  } finally {
    wrapKey.fill(0);
  }
}

export function unwrapHouseholdDataKey(
  envelope: Uint8Array,
  recipientAgreementPrivateKey: Uint8Array,
  senderAgreementPublicKey: Uint8Array,
  aadContext: string,
): Uint8Array {
  const shared = x25519.getSharedSecret(recipientAgreementPrivateKey, senderAgreementPublicKey);
  const wrapKey = hkdf(sha256, shared, undefined, utf8Encode(`hdk-wrap-v1:${aadContext}`), 32);
  shared.fill(0);
  try {
    return aeadDecrypt(wrapKey, envelope, utf8Encode(aadContext));
  } finally {
    wrapKey.fill(0);
  }
}

export function deriveRecoveryKey(
  recoverySecretUtf8: string,
  salt: Uint8Array,
  params: RecoveryKdfParams = RECOVERY_KDF_MOBILE,
): Uint8Array {
  return argon2id(utf8Encode(recoverySecretUtf8), salt, params);
}
