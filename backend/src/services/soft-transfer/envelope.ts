/**
 * Soft Transfer signed envelopes (ES256 Compact JWS over canonical JSON payload).
 */
import * as jose from 'jose';

import type { Env } from '../../types';
import { hasPlatformJwtPrivateKey, hasPlatformJwtPublicKeys } from '../../utils/platform-jwt';

import { canonicalize, sha256Hex } from './canonical-json';

export type TransferEnvelopeBody = {
  package_id: string;
  schema_version: number;
  schema_hash: string;
  field_manifest: string[];
  purpose: string;
  user_id: string;
  source_brand_id: string;
  destination_brand_id: string;
  operation_id: string;
  consent_id: string;
  consent_version: number;
  context_id: string;
  exported_at: string;
  expires_at: string;
  payload: Record<string, unknown>;
};

function envelopePrivateJwk(env: Env): jose.JWK | null {
  if (env.TRANSFER_ENVELOPE_PRIVATE_JWK?.trim()) {
    return JSON.parse(env.TRANSFER_ENVELOPE_PRIVATE_JWK) as jose.JWK;
  }
  // House may fall back to platform mint key when envelope key not yet provisioned.
  if (hasPlatformJwtPrivateKey(env) && env.PLATFORM_JWT_PRIVATE_JWK) {
    return JSON.parse(env.PLATFORM_JWT_PRIVATE_JWK) as jose.JWK;
  }
  return null;
}

function envelopePublicKeysJson(env: Env): string | null {
  if (env.TRANSFER_ENVELOPE_PUBLIC_KEYS?.trim()) {
    return env.TRANSFER_ENVELOPE_PUBLIC_KEYS;
  }
  if (hasPlatformJwtPublicKeys(env) && env.PLATFORM_JWT_PUBLIC_KEYS) {
    return env.PLATFORM_JWT_PUBLIC_KEYS;
  }
  return null;
}

export async function schemaHashForManifest(
  packageId: string,
  version: number,
  fieldManifest: readonly string[]
): Promise<string> {
  return sha256Hex(canonicalize({ packageId, version, fieldManifest: [...fieldManifest] }));
}

export async function signTransferEnvelope(
  body: TransferEnvelopeBody,
  env: Env
): Promise<string> {
  const jwk = envelopePrivateJwk(env);
  if (!jwk) {
    throw new Error('TRANSFER_ENVELOPE_PRIVATE_JWK (or House platform key) required to sign');
  }
  const key = await jose.importJWK(jwk, 'ES256');
  const bytes = new TextEncoder().encode(canonicalize(body));
  return new jose.CompactSign(bytes)
    .setProtectedHeader({ alg: 'ES256', typ: 'transfer-envelope+jws', kid: jwk.kid })
    .sign(key);
}

export async function verifyTransferEnvelope(
  jws: string,
  env: Env
): Promise<TransferEnvelopeBody | null> {
  const keysJson = envelopePublicKeysJson(env);
  if (!keysJson) return null;
  try {
    const jwks = jose.createLocalJWKSet(JSON.parse(keysJson) as jose.JSONWebKeySet);
    const { payload, protectedHeader } = await jose.compactVerify(jws, jwks);
    if (protectedHeader.alg !== 'ES256') return null;
    if (protectedHeader.typ && protectedHeader.typ !== 'transfer-envelope+jws') return null;
    const body = JSON.parse(new TextDecoder().decode(payload)) as TransferEnvelopeBody;
    if (!body?.package_id || !body?.operation_id || !body?.payload) return null;
    if (body.expires_at && Date.parse(body.expires_at) < Date.now()) return null;
    return body;
  } catch (error) {
    console.error('[soft-transfer] envelope verify failed', (error as Error).message);
    return null;
  }
}

export async function envelopeIdHash(jws: string): Promise<string> {
  return sha256Hex(jws);
}

/** Unverified peek of destination brand for import routing (verify still required). */
export function peekTransferEnvelopeDestination(jws: string): string | null {
  try {
    const mid = jws.split('.')[1];
    if (!mid) return null;
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(mid.replace(/-/g, '+').replace(/_/g, '/')),
          (c) => c.charCodeAt(0)
        )
      )
    ) as { destination_brand_id?: string };
    return typeof json.destination_brand_id === 'string'
      ? json.destination_brand_id
      : null;
  } catch {
    return null;
  }
}
