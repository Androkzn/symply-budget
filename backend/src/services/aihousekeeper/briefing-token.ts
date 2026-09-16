/**
 * Aihousekeeper public-briefing token — plan §B11.
 *
 * HMAC-SHA256 signed token for the web-briefing URL (E3). 7-day TTL. Signing
 * key lives in CONFIG_KV under `aihousekeeper_briefing_signing_key_v1`; the current
 * version is stored in `aihousekeeper_briefing_signing_key_version` (string).
 *
 * Revocation: verify fails if the household_member (hid, uid) has
 * deleted_at IS NOT NULL AND iat < deleted_at.
 */

import { and, eq } from 'drizzle-orm';

import { householdMembers } from '../../db/schema';
import type { Env } from '../../types';

const TOKEN_TTL_SECONDS = 7 * 24 * 3600;
const DEFAULT_KEY_VERSION = 'v1';

export interface BriefingTokenPayload {
  hid: string;
  date: string;
  uid: string;
  iat: number;
}

export type VerifyBriefingTokenResult =
  | { ok: true; hid: string; date: string; uid: string; iat: number; revoked: false }
  | { ok: true; hid: string; date: string; uid: string; iat: number; revoked: true }
  | { ok: false; reason: 'bad_signature' | 'expired' | 'malformed' };

/**
 * Mint a signed token. Format: `<version>.<base64url(payload)>.<base64url(sig)>`.
 */
export async function mintBriefingToken(
  payload: BriefingTokenPayload,
  env: Env
): Promise<string> {
  const version =
    (await env.CONFIG_KV.get('aihousekeeper_briefing_signing_key_version')) ??
    DEFAULT_KEY_VERSION;
  const key = await loadSigningKey(env, version);
  const payloadB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const toSign = `${version}.${payloadB64}`;
  const signature = await hmacSign(key, toSign);
  const sigB64 = base64UrlEncode(signature);
  return `${version}.${payloadB64}.${sigB64}`;
}

/**
 * Verify a token. Checks signature, TTL, then revocation against the
 * householdMembers soft-delete flag.
 */
export async function verifyBriefingToken(
  token: string,
  env: Env,
  db?: import('../../types').Database
): Promise<VerifyBriefingTokenResult> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, reason: 'malformed' };
  }
  const [version, payloadB64, sigB64] = parts;

  let key: CryptoKey;
  try {
    key = await loadSigningKey(env, version);
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  const toSign = `${version}.${payloadB64}`;
  const expectedSig = await hmacSign(key, toSign);
  const providedSig = base64UrlDecode(sigB64);
  if (!timingSafeEqual(expectedSig, providedSig)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: BriefingTokenPayload;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadB64));
    payload = JSON.parse(json) as BriefingTokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    typeof payload.hid !== 'string' ||
    typeof payload.date !== 'string' ||
    typeof payload.uid !== 'string' ||
    typeof payload.iat !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.iat < nowSec - TOKEN_TTL_SECONDS) {
    return { ok: false, reason: 'expired' };
  }

  // Revocation check: if the member was removed from the household AND
  // the token was issued before that removal, treat as revoked.
  if (db) {
    const member = await db
      .select({
        deleted_at: householdMembers.deleted_at,
      })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, payload.hid),
          eq(householdMembers.user_id, payload.uid)
        )
      )
      .get();
    if (member?.deleted_at) {
      const deletedSec = Math.floor(Date.parse(member.deleted_at) / 1000);
      if (payload.iat < deletedSec) {
        return {
          ok: true,
          hid: payload.hid,
          date: payload.date,
          uid: payload.uid,
          iat: payload.iat,
          revoked: true,
        };
      }
    }
  }

  return {
    ok: true,
    hid: payload.hid,
    date: payload.date,
    uid: payload.uid,
    iat: payload.iat,
    revoked: false,
  };
}

// ---------- internals ----------

async function loadSigningKey(env: Env, version: string): Promise<CryptoKey> {
  const keyName = `aihousekeeper_briefing_signing_key_${version}`;
  const raw = await env.CONFIG_KV.get(keyName);
  if (!raw) {
    throw new Error(`Briefing signing key missing: ${keyName}`);
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function hmacSign(key: CryptoKey, data: string): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(data)
  );
  return new Uint8Array(sig);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/[=]+$/, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  const full = padded + '='.repeat(pad);
  const binary = atob(full);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
