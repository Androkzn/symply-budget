/**
 * wrong_token_class surfaces as 401 on product auth middleware.
 */
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, it, expect, beforeAll } from 'vitest';

import { authMiddleware } from '../../src/middleware/auth';
import type { Env } from '../../src/types';
import { signTransferExportToken } from '../../src/utils/platform-jwt';

import { apiErrorHandler, baseEnv, generatePlatformKeyPair } from './helpers';

const testEnv = env as unknown as Env;

describe('authMiddleware wrong_token_class', () => {
  let houseEnv: Env;
  let transferToken: string;

  beforeAll(async () => {
    const keys = await generatePlatformKeyPair();
    houseEnv = {
      ...testEnv,
      ...baseEnv({
        APP_BRAND: 'symply-house',
        PLATFORM_JWT_PRIVATE_JWK: JSON.stringify(keys.privateJwk),
        PLATFORM_JWT_PUBLIC_KEYS: keys.publicKeysJson,
      }),
    };
    transferToken = await signTransferExportToken(
      {
        sub: 'u1',
        operation_id: 'op',
        package_id: 'profile.core.v1',
        source_brand_id: 'symply-house',
        destination_brand_id: 'symply-budget',
        context_id: 'ctx',
      },
      houseEnv
    );
  });

  it('rejects transfer+jwt on a product route with wrong_token_class', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.get('/secure', authMiddleware(), (c) => c.json({ ok: true }));
    app.onError(apiErrorHandler() as never);

    const res = await app.request(
      '/secure',
      { headers: { Authorization: `Bearer ${transferToken}` } },
      houseEnv
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('wrong_token_class');
  });
});
