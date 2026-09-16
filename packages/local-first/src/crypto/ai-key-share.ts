/**
 * Sealing an AI provider API key so the rest of the household can use it.
 *
 * The control plane stores the envelope this produces and cannot read it: the
 * subkey comes from the Household Data Key, which only enrolled member devices
 * hold. That is the whole point — a BYOK key fanned out to several people is
 * exactly the secret you do not want a server-side vault to be able to open,
 * even though `user_ai_credentials` (the owner's PERSONAL copy) is deliberately
 * server-readable so the Worker can probe and lease it.
 *
 * Same shape as `deriveBlobContentKey` in the House blob store: HKDF-SHA256 over
 * the HDK with no salt (the HDK is already uniform, so Extract has nothing to
 * condense) and all domain separation carried in the `info` string.
 *
 * `keyEpoch` is bound into BOTH the derivation and the AAD, and travels with the
 * stored row, because the HDK rotates whenever a device is revoked. A reader
 * that assumed the current epoch would silently fail to open every share sealed
 * before the last rotation.
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';

import { aeadDecrypt, aeadEncrypt } from './aead';
import { base64ToBytes, bytesToBase64 } from './base64';

/** Bumped when the derivation or AAD changes; stored as `envelope_version`. */
export const AI_KEY_SHARE_VERSION = 1;

const SHARE_KEY_LENGTH = 32;

export interface AiKeyShareContext {
  householdId: string;
  /** The HDK epoch that sealed (or must open) this share. */
  keyEpoch: number;
  /** `openai` | `anthropic` | `gemini` — kept as a string so the package stays brand-agnostic. */
  provider: string;
  /** The member whose key this is. Binds the envelope to one sharer. */
  ownerUserId: string;
}

/** `HKDF(HDK, info="lf-ai-key-share:v1:{hh}:{epoch}:{provider}")`. */
export function deriveAiKeyShareKey(hdk: Uint8Array, ctx: AiKeyShareContext): Uint8Array {
  return hkdf(
    sha256,
    hdk,
    undefined,
    `lf-ai-key-share:v${AI_KEY_SHARE_VERSION}:${ctx.householdId}:${ctx.keyEpoch}:${ctx.provider}`,
    SHARE_KEY_LENGTH,
  );
}

/**
 * AAD for one share.
 *
 * `ownerUserId` is in here rather than only in the derivation so that two
 * members who share a key for the SAME provider cannot have their rows swapped
 * by whoever controls the database: the envelope only opens against the owner
 * the row claims. Without it, a relay could re-point Ann's row at Bob and the
 * recipient would decrypt it happily and bill the wrong person.
 */
export function aiKeyShareAad(ctx: AiKeyShareContext): Uint8Array {
  return new TextEncoder().encode(
    `lf-ai-key-share:v${AI_KEY_SHARE_VERSION}:${ctx.householdId}:${ctx.keyEpoch}:${ctx.provider}:${ctx.ownerUserId}:A256GCM`,
  );
}

/**
 * Seal an API key for the household. Returns base64 `nonce || ciphertext||tag`,
 * which is what the `household_ai_key_shares.ciphertext` column holds.
 *
 * Call this once per share and store what it returns; re-sharing the same key
 * mints a fresh nonce, which is fine because it also replaces the row. Never
 * hold two envelopes for one (key, slot) — see the warning on `sealBlobChunk`.
 */
export function sealAiKeyShare(input: {
  hdk: Uint8Array;
  ctx: AiKeyShareContext;
  apiKey: string;
}): string {
  const shareKey = deriveAiKeyShareKey(input.hdk, input.ctx);
  const sealed = aeadEncrypt(
    shareKey,
    new TextEncoder().encode(input.apiKey),
    aiKeyShareAad(input.ctx),
  );
  return bytesToBase64(sealed);
}

/**
 * Open a share sealed by another member's device. Throws when the HDK is for a
 * different household, the epoch is wrong, or the row was tampered with — all
 * of which surface to the caller as "this shared key can't be used here"
 * rather than a silent wrong-key call to the provider.
 */
export function openAiKeyShare(input: {
  hdk: Uint8Array;
  ctx: AiKeyShareContext;
  ciphertextB64: string;
}): string {
  const shareKey = deriveAiKeyShareKey(input.hdk, input.ctx);
  const plaintext = aeadDecrypt(
    shareKey,
    base64ToBytes(input.ciphertextB64),
    aiKeyShareAad(input.ctx),
  );
  return new TextDecoder().decode(plaintext);
}

/** Last four characters — the only part of a key that may be shown or stored in clear. */
export function aiKeyHint(apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed.length <= 4 ? '****' : trimmed.slice(-4);
}
