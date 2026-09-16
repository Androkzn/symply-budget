/**
 * Platform ES256 JWT classes (Data Bridge v1.16).
 * House holds PLATFORM_JWT_PRIVATE_JWK; joined Workers verify with PLATFORM_JWT_PUBLIC_KEYS.
 */
import * as jose from 'jose';

import { tryGetAppBrand } from '../config/brand';
import {
  isJoinedPlatformBrandId,
} from '../config/brand-capabilities';
import {
  HOUSE_COMPANION_AUDIENCE,
  PLATFORM_JWT_ISSUER,
  TRANSFER_EXPORT_AUDIENCE,
  audienceForBrand,
  type JoinedRuntimeBrandId,
} from '../config/platform-brands';
import { platformMetric } from '../services/observability/platform-metrics';
import type { Env } from '../types';

export type ProductTokenTyp = 'at+jwt';
export type TransferTokenTyp = 'transfer+jwt';
export type CompanionTokenTyp = 'companion+jwt';

export type PlatformProductClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  client_id: string;
  sid: string;
  ent_ver: number;
  scope: string;
  jti: string;
};

export type PlatformTransferClaims = {
  sub: string;
  operation_id: string;
  package_id: string;
  source_brand_id: string;
  destination_brand_id: string;
  context_id: string;
  jti: string;
};

export type PlatformCompanionClaims = {
  sub: string;
  household_id: string;
  scope: string;
  jti: string;
};

export class WrongTokenClassError extends Error {
  readonly status = 401;
  readonly code = 'wrong_token_class';

  constructor(expected: string, actual: string | undefined) {
    super(`Expected typ=${expected}, got ${actual ?? '(missing)'}`);
    this.name = 'WrongTokenClassError';
  }
}

function parsePublicKeysJson(raw: string | undefined): jose.JWK[] {
  if (!raw?.trim()) return [];
  const parsed = JSON.parse(raw) as { keys?: jose.JWK[] } | jose.JWK[];
  if (Array.isArray(parsed)) return parsed;
  if (parsed.keys && Array.isArray(parsed.keys)) return parsed.keys;
  return [];
}

export function hasPlatformJwtPublicKeys(env: Env): boolean {
  return parsePublicKeysJson(env.PLATFORM_JWT_PUBLIC_KEYS).length > 0;
}

export function hasPlatformJwtPrivateKey(env: Env): boolean {
  return Boolean(env.PLATFORM_JWT_PRIVATE_JWK?.trim());
}

async function importPrivateKey(env: Env): Promise<CryptoKey | Uint8Array> {
  const raw = env.PLATFORM_JWT_PRIVATE_JWK;
  if (!raw?.trim()) {
    throw new Error('PLATFORM_JWT_PRIVATE_JWK is not configured');
  }
  const jwk = JSON.parse(raw) as jose.JWK;
  return jose.importJWK(jwk, 'ES256');
}

function buildJwks(env: Env): jose.FlattenedJWSInput extends never ? never : jose.JWTVerifyGetKey {
  const keys = parsePublicKeysJson(env.PLATFORM_JWT_PUBLIC_KEYS);
  if (keys.length === 0) {
    throw new Error('PLATFORM_JWT_PUBLIC_KEYS is not configured');
  }
  return jose.createLocalJWKSet({ keys });
}

function assertNoRemoteHeader(header: jose.ProtectedHeaderParameters): void {
  if (header.jku || header.x5u) {
    throw new Error('Remote key headers are forbidden');
  }
  if (header.crit && Array.isArray(header.crit) && header.crit.length > 0) {
    throw new Error('Unknown crit extensions are forbidden');
  }
}

function newJti(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signProductAccessToken(
  claims: Omit<PlatformProductClaims, 'jti'> & { jti?: string },
  brandId: JoinedRuntimeBrandId,
  env: Env,
  expiresInSeconds = 900
): Promise<string> {
  const key = await importPrivateKey(env);
  const privateJwk = JSON.parse(env.PLATFORM_JWT_PRIVATE_JWK!) as jose.JWK;
  const jti = claims.jti ?? newJti();
  const aud = audienceForBrand(brandId);

  return new jose.SignJWT({
    email: claims.email,
    email_verified: claims.email_verified ?? false,
    client_id: claims.client_id,
    sid: claims.sid,
    ent_ver: claims.ent_ver,
    scope: claims.scope,
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: privateJwk.kid })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .setIssuer(PLATFORM_JWT_ISSUER)
    .setAudience(aud)
    .setJti(jti)
    .sign(key);
}

export async function verifyProductAccessToken(
  token: string,
  env: Env,
  expectedAudience?: string
): Promise<(PlatformProductClaims & jose.JWTPayload) | null> {
  try {
    const typ = peekJwtTyp(token);
    if (typ && typ !== 'at+jwt') {
      throw new WrongTokenClassError('at+jwt', typ);
    }
    const brand = tryGetJoinedBrand(env);
    const aud =
      expectedAudience ??
      (brand ? audienceForBrand(brand) : undefined) ??
      env.JWT_AUDIENCE;
    const getKey = buildJwks(env);
    const { payload, protectedHeader } = await jose.jwtVerify(token, getKey, {
      issuer: PLATFORM_JWT_ISSUER,
      audience: aud,
      algorithms: ['ES256'],
    });
    assertNoRemoteHeader(protectedHeader);
    if (protectedHeader.typ !== 'at+jwt') {
      throw new WrongTokenClassError('at+jwt', protectedHeader.typ);
    }
    if (!payload.sub || !payload.jti || typeof payload.sid !== 'string') {
      return null;
    }
    return payload as PlatformProductClaims & jose.JWTPayload;
  } catch (error) {
    if (error instanceof WrongTokenClassError) {
      platformMetric(env, 'platform_jwt_verify_failure', 1, {
        class: 'product',
        reason: 'wrong_token_class',
      });
      throw error;
    }
    console.error('[platform-jwt] product verify failed:', (error as Error).message);
    platformMetric(env, 'platform_jwt_verify_failure', 1, {
      class: 'product',
      reason: 'verify_failed',
    });
    return null;
  }
}

function tryGetJoinedBrand(env: Env): JoinedRuntimeBrandId | null {
  const brand = tryGetAppBrand(env);
  if (brand && isJoinedPlatformBrandId(brand)) {
    return brand;
  }
  return null;
}

export async function signTransferExportToken(
  claims: Omit<PlatformTransferClaims, 'jti'> & { jti?: string },
  env: Env,
  expiresInSeconds = 120
): Promise<string> {
  const key = await importPrivateKey(env);
  const privateJwk = JSON.parse(env.PLATFORM_JWT_PRIVATE_JWK!) as jose.JWK;
  const jti = claims.jti ?? newJti();

  return new jose.SignJWT({
    operation_id: claims.operation_id,
    package_id: claims.package_id,
    source_brand_id: claims.source_brand_id,
    destination_brand_id: claims.destination_brand_id,
    context_id: claims.context_id,
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'transfer+jwt', kid: privateJwk.kid })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .setIssuer(PLATFORM_JWT_ISSUER)
    .setAudience(TRANSFER_EXPORT_AUDIENCE)
    .setJti(jti)
    .sign(key);
}

export async function verifyTransferExportToken(
  token: string,
  env: Env
): Promise<(PlatformTransferClaims & jose.JWTPayload) | null> {
  try {
    const typ = peekJwtTyp(token);
    if (typ && typ !== 'transfer+jwt') {
      throw new WrongTokenClassError('transfer+jwt', typ);
    }
    const getKey = buildJwks(env);
    const { payload, protectedHeader } = await jose.jwtVerify(token, getKey, {
      issuer: PLATFORM_JWT_ISSUER,
      audience: TRANSFER_EXPORT_AUDIENCE,
      algorithms: ['ES256'],
    });
    assertNoRemoteHeader(protectedHeader);
    if (protectedHeader.typ !== 'transfer+jwt') {
      throw new WrongTokenClassError('transfer+jwt', protectedHeader.typ);
    }
    return payload as PlatformTransferClaims & jose.JWTPayload;
  } catch (error) {
    if (error instanceof WrongTokenClassError) {
      platformMetric(env, 'platform_jwt_verify_failure', 1, {
        class: 'transfer',
        reason: 'wrong_token_class',
      });
      throw error;
    }
    console.error('[platform-jwt] transfer verify failed:', (error as Error).message);
    platformMetric(env, 'platform_jwt_verify_failure', 1, {
      class: 'transfer',
      reason: 'verify_failed',
    });
    return null;
  }
}

export async function signCompanionToken(
  claims: Omit<PlatformCompanionClaims, 'jti'> & { jti?: string },
  env: Env,
  expiresInSeconds = 3600
): Promise<string> {
  const key = await importPrivateKey(env);
  const privateJwk = JSON.parse(env.PLATFORM_JWT_PRIVATE_JWK!) as jose.JWK;
  const jti = claims.jti ?? newJti();

  return new jose.SignJWT({
    household_id: claims.household_id,
    scope: claims.scope,
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'companion+jwt', kid: privateJwk.kid })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .setIssuer(PLATFORM_JWT_ISSUER)
    .setAudience(HOUSE_COMPANION_AUDIENCE)
    .setJti(jti)
    .sign(key);
}

export async function verifyCompanionToken(
  token: string,
  env: Env
): Promise<(PlatformCompanionClaims & jose.JWTPayload) | null> {
  try {
    const getKey = buildJwks(env);
    const { payload, protectedHeader } = await jose.jwtVerify(token, getKey, {
      issuer: PLATFORM_JWT_ISSUER,
      audience: HOUSE_COMPANION_AUDIENCE,
      algorithms: ['ES256'],
    });
    assertNoRemoteHeader(protectedHeader);
    if (protectedHeader.typ !== 'companion+jwt') {
      throw new WrongTokenClassError('companion+jwt', protectedHeader.typ);
    }
    return payload as PlatformCompanionClaims & jose.JWTPayload;
  } catch (error) {
    if (error instanceof WrongTokenClassError) {
      platformMetric(env, 'platform_jwt_verify_failure', 1, {
        class: 'companion',
        reason: 'wrong_token_class',
      });
      throw error;
    }
    console.error('[platform-jwt] companion verify failed:', (error as Error).message);
    platformMetric(env, 'platform_jwt_verify_failure', 1, {
      class: 'companion',
      reason: 'verify_failed',
    });
    return null;
  }
}

/** Decode typ without verifying — used only to emit wrong_token_class before verify. */
export function peekJwtTyp(token: string): string | undefined {
  try {
    const header = jose.decodeProtectedHeader(token);
    return typeof header.typ === 'string' ? header.typ : undefined;
  } catch {
    return undefined;
  }
}
