import { gcm } from '@noble/ciphers/aes';

import { concatBytes, randomBytes } from './bytes';

const NONCE_LENGTH = 12;
const KEY_LENGTH = 32;

export function assertAesKey(key: Uint8Array): void {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`AES-GCM key must be ${KEY_LENGTH} bytes`);
  }
}

/** Encrypt plaintext; returns nonce || ciphertext||tag (noble gcm appends tag). */
export function aeadEncrypt(key: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  assertAesKey(key);
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = gcm(key, nonce, aad);
  const sealed = cipher.encrypt(plaintext);
  return concatBytes(nonce, sealed);
}

export function aeadDecrypt(key: Uint8Array, envelope: Uint8Array, aad?: Uint8Array): Uint8Array {
  assertAesKey(key);
  if (envelope.length < NONCE_LENGTH + 16) {
    throw new Error('aeadDecrypt: envelope too short');
  }
  const nonce = envelope.subarray(0, NONCE_LENGTH);
  const sealed = envelope.subarray(NONCE_LENGTH);
  const cipher = gcm(key, nonce, aad);
  return cipher.decrypt(sealed);
}
