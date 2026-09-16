/**
 * PlatformBridgeApi session resolve gates (logic mirrored without WorkerEntrypoint host).
 */
import { describe, expect, it, beforeAll } from 'vitest';

import { getAppBrand } from '../../src/config/brand';
import { JOINED_PLATFORM_BRANDS, audienceForBrand } from '../../src/config/platform-brands';
import type { Env } from '../../src/types';
import {
  signProductAccessToken,
  verifyProductAccessToken,
  hasPlatformJwtPublicKeys,
} from '../../src/utils/platform-jwt';

import { baseEnv, generatePlatformKeyPair } from './helpers';



/**
 * Same gate sequence as PlatformBridgeApi.resolveSession — kept in sync for unit coverage
 * without needing a WorkerEntrypoint host in vitest-pool-workers.
 */
async function resolveSession(
  env: Env,
  args: { accessToken: string; callerBrand: string }
): Promise<{ sub: string; ent_ver: number; sid: string } | null> {
  const brand = getAppBrand(env);
  if (brand !== 'symply-house') {
    throw new Error('resolveSession is House-only');
  }
  if (!(JOINED_PLATFORM_BRANDS as readonly string[]).includes(args.callerBrand)) {
    return null;
  }
  if (!hasPlatformJwtPublicKeys(env)) {
    return null;
  }
  const payload = await verifyProductAccessToken(
    args.accessToken,
    env,
    audienceForBrand(args.callerBrand as 'symply-budget' | 'symply-kaizen' | 'symply-house')
  );
  if (!payload?.sub || typeof payload.sid !== 'string') return null;
  const entVer =
    typeof payload.ent_ver === 'number' ? payload.ent_ver : Number(payload.ent_ver ?? 0);
  return { sub: payload.sub, ent_ver: entVer, sid: payload.sid };
}

describe('PlatformBridgeApi.resolveSession gates', () => {
  let houseEnv: Env;
  let budgetEnv: Env;
  let accessToken: string;

  beforeAll(async () => {
    const keys = await generatePlatformKeyPair();
    houseEnv = baseEnv({
      APP_BRAND: 'symply-house',
      PLATFORM_JWT_PRIVATE_JWK: JSON.stringify(keys.privateJwk),
      PLATFORM_JWT_PUBLIC_KEYS: keys.publicKeysJson,
    });
    budgetEnv = baseEnv({
      APP_BRAND: 'symply-budget',
      PLATFORM_JWT_PUBLIC_KEYS: keys.publicKeysJson,
    });
    accessToken = await signProductAccessToken(
      {
        sub: 'user_bridge',
        email: 'u@example.com',
        email_verified: true,
        client_id: 'symply-budget-app',
        sid: 'sid_bridge',
        ent_ver: 3,
        scope: 'openid profile',
      },
      'symply-budget',
      houseEnv
    );
  });

  it('resolves Budget-audience token on House', async () => {
    const session = await resolveSession(houseEnv, {
      accessToken,
      callerBrand: 'symply-budget',
    });
    expect(session).toEqual({ sub: 'user_bridge', ent_ver: 3, sid: 'sid_bridge' });
  });

  it('throws when called on Budget Worker', async () => {
    await expect(
      resolveSession(budgetEnv, { accessToken, callerBrand: 'symply-budget' })
    ).rejects.toThrow(/House-only/);
  });

  it('returns null for Health caller brand', async () => {
    await expect(
      resolveSession(houseEnv, { accessToken, callerBrand: 'symply-health' })
    ).resolves.toBeNull();
  });

  it('returns null when JWKS missing', async () => {
    const bare = baseEnv({ APP_BRAND: 'symply-house' });
    await expect(
      resolveSession(bare, { accessToken, callerBrand: 'symply-budget' })
    ).resolves.toBeNull();
  });
});
