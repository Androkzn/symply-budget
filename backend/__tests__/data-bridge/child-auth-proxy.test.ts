/**
 * Child auth proxy helpers — Budget/Kaizen never mint; House HTTP target.
 */
import { describe, expect, it } from 'vitest';

import {
  houseApiBaseUrl,
  mustProxyAuthToHouse,
} from '../../src/services/child-auth-proxy';
import type { Env } from '../../src/types';

function env(partial: Partial<Env> & { APP_BRAND: string; ENVIRONMENT?: string }): Env {
  return partial as Env;
}

describe('mustProxyAuthToHouse', () => {
  it('is false for House and Health', () => {
    expect(
      mustProxyAuthToHouse(env({ APP_BRAND: 'symply-house', PLATFORM_JWT_PUBLIC_KEYS: '[]' }))
    ).toBe(false);
    expect(
      mustProxyAuthToHouse(env({ APP_BRAND: 'symply-health', PLATFORM_JWT_PUBLIC_KEYS: '[]' }))
    ).toBe(false);
  });

  it('is true for Budget/Kaizen when platform JWKS is present', () => {
    const keys = JSON.stringify([{ kid: 'k1', kty: 'EC' }]);
    expect(
      mustProxyAuthToHouse(env({ APP_BRAND: 'symply-budget', PLATFORM_JWT_PUBLIC_KEYS: keys }))
    ).toBe(true);
    expect(
      mustProxyAuthToHouse(env({ APP_BRAND: 'symply-kaizen', PLATFORM_JWT_PUBLIC_KEYS: keys }))
    ).toBe(true);
  });

  it('is false for Budget when no platform keys installed', () => {
    expect(mustProxyAuthToHouse(env({ APP_BRAND: 'symply-budget' }))).toBe(false);
  });
});

describe('houseApiBaseUrl', () => {
  it('uses staging House by default', () => {
    expect(houseApiBaseUrl(env({ APP_BRAND: 'symply-budget', ENVIRONMENT: 'staging' }))).toBe(
      'https://simple-house-api-staging.a-tekhtelev.workers.dev'
    );
  });

  it('uses production House when ENVIRONMENT=production', () => {
    expect(houseApiBaseUrl(env({ APP_BRAND: 'symply-budget', ENVIRONMENT: 'production' }))).toBe(
      'https://simple-house-api.a-tekhtelev.workers.dev'
    );
  });

  it('honors HOUSE_API_FALLBACK_URL override', () => {
    expect(
      houseApiBaseUrl(
        env({
          APP_BRAND: 'symply-budget',
          ENVIRONMENT: 'production',
          HOUSE_API_FALLBACK_URL: 'https://example.test/',
        })
      )
    ).toBe('https://example.test');
  });
});
