import { aeadDecrypt, aeadEncrypt } from '../crypto/aead';
import { utf8Encode } from '../crypto/bytes';
import type { Bytes, HouseholdId } from '../types';

export const ROW_NONCE_LENGTH = 12;

/**
 * Per-row AEAD under the device DEK (Stage 2).
 *
 * Nonce is 96-bit random per write (`aeadEncrypt`); never derived from
 * encryptor-chosen fields. Store `(nonce, ciphertext||tag)` as separate
 * columns so a later counter-nonce "optimization" cannot silently land.
 */
export function rowAad(
  householdId: HouseholdId,
  table: string,
  rowKey: string,
  keyEpoch: number,
): Bytes {
  return utf8Encode(`lf-row:${householdId}:${table}:${rowKey}:${keyEpoch}`);
}

export function sealRowBody(
  dek: Bytes,
  plaintext: Bytes,
  aad: Bytes,
): { nonce: Bytes; ciphertext: Bytes } {
  const envelope = aeadEncrypt(dek, plaintext, aad);
  return {
    nonce: envelope.subarray(0, ROW_NONCE_LENGTH),
    ciphertext: envelope.subarray(ROW_NONCE_LENGTH),
  };
}

export function openRowBody(
  dek: Bytes,
  nonce: Bytes,
  ciphertext: Bytes,
  aad: Bytes,
): Bytes {
  const envelope = new Uint8Array(nonce.length + ciphertext.length);
  envelope.set(nonce, 0);
  envelope.set(ciphertext, nonce.length);
  return aeadDecrypt(dek, envelope, aad);
}
