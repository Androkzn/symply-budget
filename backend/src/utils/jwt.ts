import * as jose from 'jose';

import {
  isJoinedPlatformBrandId,
  resolveMintAudienceBrand,
} from '../config/brand-capabilities';
import { isPlatformAuthorityEnabled } from '../config/brand-capabilities';
import { audienceForBrand, type JoinedRuntimeBrandId } from '../config/platform-brands';
import type { AccessTokenPayload, Env } from '../types';

import {
  hasPlatformJwtPrivateKey,
  hasPlatformJwtPublicKeys,
  peekJwtTyp,
  signProductAccessToken,
  verifyProductAccessToken,
  WrongTokenClassError,
} from './platform-jwt';


/**
 * Generate an access token (JWT).
 * ES256 at+jwt: House only (PLATFORM_JWT_PRIVATE_JWK).
 * Children with PLATFORM_JWT_PUBLIC_KEYS must not mint — proxy to House.
 * Pre-cutover (no platform keys): HS256 local.
 */
export async function generateAccessToken(
  payload: Omit<AccessTokenPayload, 'iat' | 'exp'>,
  env: Env,
  options?: { audienceBrand?: JoinedRuntimeBrandId }
): Promise<string> {
  const expiresIn = parseInt(env.ACCESS_TOKEN_EXPIRY, 10) || 900;

  if (hasPlatformJwtPublicKeys(env) && !hasPlatformJwtPrivateKey(env)) {
    throw new Error('Child Worker must not mint tokens — proxy auth to House');
  }

  if (hasPlatformJwtPrivateKey(env)) {
    if (!isPlatformAuthorityEnabled(env)) {
      throw new Error('PLATFORM_JWT_PRIVATE_JWK is House-only');
    }
    const audienceBrand = resolveMintAudienceBrand(options?.audienceBrand);
    if (!isJoinedPlatformBrandId(audienceBrand)) {
      throw new Error('Invalid audience brand for platform mint');
    }
    return signProductAccessToken(
      {
        sub: payload.sub,
        email: payload.email,
        email_verified: payload.email_verified,
        client_id: audienceForBrand(audienceBrand),
        sid: payload.sid ?? crypto.randomUUID(),
        ent_ver: payload.ent_ver ?? 1,
        scope: payload.scope ?? 'openid profile',
      },
      audienceBrand,
      env,
      expiresIn
    );
  }

  const secret = new TextEncoder().encode(env.JWT_SECRET);

  return new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .sign(secret);
}

/**
 * Verify and decode an access token.
 * When PLATFORM_JWT_PUBLIC_KEYS is present, ES256 at+jwt only (no HS256 grace).
 *
 * `options.audienceBrand` overrides the expected audience. Needed when House
 * verifies a token minted for a child brand (e.g. a Kaizen/Budget login proxied
 * to House mints a child-audience token; an authenticated route proxied back to
 * House — accept-terms, change-password, delete-account — must verify against
 * that child brand's audience, not House's own).
 */
export async function verifyAccessToken(
  token: string,
  env: Env,
  options?: { audienceBrand?: JoinedRuntimeBrandId }
): Promise<AccessTokenPayload | null> {
  try {
    const typ = peekJwtTyp(token);
    if (typ && typ !== 'at+jwt' && typ !== 'JWT') {
      throw new WrongTokenClassError('at+jwt', typ);
    }

    if (hasPlatformJwtPublicKeys(env)) {
      const expectedAudience = options?.audienceBrand
        ? audienceForBrand(options.audienceBrand)
        : undefined;
      const platform = await verifyProductAccessToken(token, env, expectedAudience);
      if (!platform?.sub) return null;
      return {
        sub: platform.sub,
        email: (platform.email as string) ?? '',
        email_verified: Boolean(platform.email_verified),
        iat: platform.iat as number,
        exp: platform.exp as number,
        sid: platform.sid,
        ent_ver: typeof platform.ent_ver === 'number' ? platform.ent_ver : undefined,
        scope: typeof platform.scope === 'string' ? platform.scope : undefined,
        jti: platform.jti,
        client_id: platform.client_id,
      };
    }

    const secret = new TextEncoder().encode(env.JWT_SECRET);

    const { payload } = await jose.jwtVerify(token, secret, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
    });

    return payload as unknown as AccessTokenPayload;
  } catch (error) {
    if (error instanceof WrongTokenClassError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`[jwt] Token verification failed:`, {
      error: errorMessage,
      errorName,
      hasJWTSecret: !!env.JWT_SECRET,
      jwtIssuer: env.JWT_ISSUER,
      jwtAudience: env.JWT_AUDIENCE,
    });
    return null;
  }
}

/**
 * Generate a refresh token (random string, not JWT)
 */
export function generateRefreshToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Calculate refresh token expiration date
 */
export function getRefreshTokenExpiry(env: Env): Date {
  const expiresIn = parseInt(env.REFRESH_TOKEN_EXPIRY, 10) || 2592000; // 30 days default
  return new Date(Date.now() + expiresIn * 1000);
}

/**
 * Verify Apple identity token
 */
export async function verifyAppleToken(
  identityToken: string,
  env: Env
): Promise<{
  sub: string;
  email?: string;
  email_verified?: boolean;
} | null> {
  try {
    // Fetch Apple's public keys
    const JWKS = jose.createRemoteJWKSet(
      new URL('https://appleid.apple.com/auth/keys')
    );

    // Native Sign in with Apple: the identity token's `aud` is the app's bundle ID.
    // Accept every ecosystem app so one backend serves all brands, plus
    // APPLE_SERVICES_ID for the legacy/web client and migration compatibility.
    const appleAudiences = [
      env.APPLE_SERVICES_ID,
      'com.symply.house',
      'com.symply.budget',
      'com.symply.kaizen',
      'com.symply.language',
      'com.symply.health',
    ].filter((a): a is string => Boolean(a));

    const { payload } = await jose.jwtVerify(identityToken, JWKS, {
      issuer: 'https://appleid.apple.com',
      audience: appleAudiences,
    });

    return {
      sub: payload.sub as string,
      email: payload.email as string | undefined,
      email_verified: payload.email_verified === 'true' || payload.email_verified === true,
    };
  } catch (error) {
    console.error('Apple token verification failed:', error);
    return null;
  }
}

/**
 * Verify Google ID token
 */
export async function verifyGoogleToken(
  idToken: string,
  env: Env
): Promise<{
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
} | null> {
  try {
    // Fetch Google's public keys
    const JWKS = jose.createRemoteJWKSet(
      new URL('https://www.googleapis.com/oauth2/v3/certs')
    );

    // The ID token's `aud` is the platform OAuth client that minted it
    // (iOS / Android / Web), so we must accept ALL of our app's client IDs.
    // GOOGLE_SIGNIN_CLIENT_IDS is a comma-separated allow-list; we fall back to
    // the single configured client ids. Verifying audience is required — without
    // it, a token minted for any unrelated Google app would be accepted.
    const allowedAudiences = [
      ...(env.GOOGLE_SIGNIN_CLIENT_IDS?.split(',') ?? []),
      env.GOOGLE_CLIENT_ID,
    ]
      .map((a) => a?.trim())
      .filter((a): a is string => !!a);

    if (allowedAudiences.length === 0) {
      console.error('verifyGoogleToken: no Google client IDs configured');
      return null;
    }

    const { payload } = await jose.jwtVerify(idToken, JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: allowedAudiences,
    });

    return {
      sub: payload.sub as string,
      email: payload.email as string,
      email_verified: payload.email_verified as boolean,
      name: payload.name as string | undefined,
      picture: payload.picture as string | undefined,
    };
  } catch (error) {
    console.error('Google token verification failed:', error);
    return null;
  }
}
