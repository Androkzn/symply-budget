/**
 * Platform JWT classes — ES256 product / transfer / companion + wrong-class negatives.
 */
import { describe, expect, it, beforeAll } from 'vitest';

import type { Env } from '../../src/types';
import { generateAccessToken, verifyAccessToken } from '../../src/utils/jwt';
import {
  signProductAccessToken,
  verifyProductAccessToken,
  signTransferExportToken,
  verifyTransferExportToken,
  signCompanionToken,
  verifyCompanionToken,
  peekJwtTyp,
  WrongTokenClassError,
} from '../../src/utils/platform-jwt';

import { baseEnv, generatePlatformKeyPair } from './helpers';


describe('platform JWT classes', () => {
  let houseEnv: Env;
  let budgetEnv: Env;
  let privateJwkJson: string;

  beforeAll(async () => {
    const keys = await generatePlatformKeyPair();
    privateJwkJson = JSON.stringify(keys.privateJwk);
    houseEnv = baseEnv({
      APP_BRAND: 'symply-house',
      PLATFORM_JWT_PRIVATE_JWK: privateJwkJson,
      PLATFORM_JWT_PUBLIC_KEYS: keys.publicKeysJson,
    });
    budgetEnv = baseEnv({
      APP_BRAND: 'symply-budget',
      PLATFORM_JWT_PUBLIC_KEYS: keys.publicKeysJson,
    });
  });

  it('signs and verifies at+jwt for House audience', async () => {
    const token = await signProductAccessToken(
      {
        sub: 'user_1',
        email: 'a@example.com',
        email_verified: true,
        client_id: 'symply-house-app',
        sid: 'sid_1',
        ent_ver: 1,
        scope: 'openid profile',
      },
      'symply-house',
      houseEnv
    );
    expect(peekJwtTyp(token)).toBe('at+jwt');
    const payload = await verifyProductAccessToken(token, houseEnv);
    expect(payload?.sub).toBe('user_1');
    expect(payload?.sid).toBe('sid_1');
    expect(payload?.client_id).toBe('symply-house-app');
  });

  it('mints Budget audience from House private key', async () => {
    const token = await signProductAccessToken(
      {
        sub: 'user_2',
        email: 'b@example.com',
        email_verified: true,
        client_id: 'symply-budget-app',
        sid: 'sid_2',
        ent_ver: 1,
        scope: 'openid profile',
      },
      'symply-budget',
      houseEnv
    );
    const payload = await verifyProductAccessToken(token, budgetEnv);
    expect(payload?.sub).toBe('user_2');
    expect(payload?.aud).toBe('symply-budget-app');
  });

  it('rejects transfer+jwt on product verifier with wrong_token_class', async () => {
    const transfer = await signTransferExportToken(
      {
        sub: 'user_1',
        operation_id: 'op_1',
        package_id: 'profile.core.v1',
        source_brand_id: 'symply-house',
        destination_brand_id: 'symply-budget',
        context_id: 'ctx_1',
      },
      houseEnv
    );
    expect(peekJwtTyp(transfer)).toBe('transfer+jwt');
    await expect(verifyProductAccessToken(transfer, houseEnv)).rejects.toMatchObject({
      code: 'wrong_token_class',
    });
  });

  it('rejects at+jwt on transfer verifier', async () => {
    const access = await signProductAccessToken(
      {
        sub: 'user_1',
        client_id: 'symply-house-app',
        sid: 'sid_1',
        ent_ver: 1,
        scope: 'openid',
      },
      'symply-house',
      houseEnv
    );
    await expect(verifyTransferExportToken(access, houseEnv)).rejects.toBeInstanceOf(
      WrongTokenClassError
    );
  });

  it('signs and verifies companion+jwt', async () => {
    const token = await signCompanionToken(
      {
        sub: 'user_1',
        household_id: 'hh_1',
        scope: 'tasks:read home-insight:read',
      },
      houseEnv
    );
    expect(peekJwtTyp(token)).toBe('companion+jwt');
    const payload = await verifyCompanionToken(token, houseEnv);
    expect(payload?.household_id).toBe('hh_1');
    expect(payload?.scope).toContain('tasks:read');
  });

  it('child Worker cannot mint when only public JWKS is present', async () => {
    await expect(
      generateAccessToken(
        { sub: 'u', email: 'c@example.com', email_verified: true },
        budgetEnv
      )
    ).rejects.toThrow(/must not mint/);
  });

  it('verifyAccessToken rejects transfer typ via WrongTokenClassError', async () => {
    const transfer = await signTransferExportToken(
      {
        sub: 'user_1',
        operation_id: 'op_2',
        package_id: 'profile.core.v1',
        source_brand_id: 'symply-house',
        destination_brand_id: 'symply-budget',
        context_id: 'ctx_2',
      },
      houseEnv
    );
    await expect(verifyAccessToken(transfer, houseEnv)).rejects.toMatchObject({
      code: 'wrong_token_class',
    });
  });
});
