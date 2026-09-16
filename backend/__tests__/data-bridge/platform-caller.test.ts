/**
 * Caller brand + edge service token negatives.
 */
import { describe, expect, it } from 'vitest';

import { resolveTrustedCallerBrand } from '../../src/middleware/platform-caller';
import type { Env } from '../../src/types';
import { ForbiddenError } from '../../src/utils/errors';

import { baseEnv } from './helpers';

function fakeContext(env: Env, headers: Record<string, string | undefined>) {
  return {
    env,
    req: {
      header: (name: string) => headers[name] ?? headers[name.toLowerCase()],
    },
  } as Parameters<typeof resolveTrustedCallerBrand>[0];
}

describe('resolveTrustedCallerBrand', () => {
  it('returns null when caller header absent', () => {
    const env = baseEnv({ APP_BRAND: 'symply-house', ENVIRONMENT: 'production' });
    expect(resolveTrustedCallerBrand(fakeContext(env, {}))).toBeNull();
  });

  it('rejects unknown caller brand', () => {
    const env = baseEnv({ APP_BRAND: 'symply-house', ENVIRONMENT: 'production' });
    expect(() =>
      resolveTrustedCallerBrand(
        fakeContext(env, { 'X-Platform-Caller-Brand': 'symply-health' })
      )
    ).toThrow(ForbiddenError);
  });

  it('requires service token in production when expected secret exists', () => {
    const env = baseEnv({
      APP_BRAND: 'symply-house',
      ENVIRONMENT: 'production',
      PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE: 'expected-token',
    });
    expect(() =>
      resolveTrustedCallerBrand(
        fakeContext(env, { 'X-Platform-Caller-Brand': 'symply-budget' })
      )
    ).toThrow(/service_token_required|invalid_service_token/);
  });

  it('accepts matching Budget→House service token', () => {
    const env = baseEnv({
      APP_BRAND: 'symply-house',
      ENVIRONMENT: 'production',
      PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE: 'budget-secret',
    });
    expect(
      resolveTrustedCallerBrand(
        fakeContext(env, {
          'X-Platform-Caller-Brand': 'symply-budget',
          'X-Platform-Service-Token': 'budget-secret',
        })
      )
    ).toBe('symply-budget');
  });

  it('rejects mismatched service token', () => {
    const env = baseEnv({
      APP_BRAND: 'symply-house',
      ENVIRONMENT: 'production',
      PLATFORM_SERVICE_TOKEN_KAIZEN_TO_HOUSE: 'kaizen-secret',
    });
    expect(() =>
      resolveTrustedCallerBrand(
        fakeContext(env, {
          'X-Platform-Caller-Brand': 'symply-kaizen',
          'X-Platform-Service-Token': 'wrong',
        })
      )
    ).toThrow(/invalid_service_token/);
  });

  it('fails closed in production when House has no inbound token provisioned', () => {
    const env = baseEnv({
      APP_BRAND: 'symply-house',
      ENVIRONMENT: 'production',
    });
    expect(() =>
      resolveTrustedCallerBrand(
        fakeContext(env, { 'X-Platform-Caller-Brand': 'symply-budget' })
      )
    ).toThrow(/service_token_required/);
  });

  it('fails closed in staging when caller header alone is sent', () => {
    const env = baseEnv({
      APP_BRAND: 'symply-house',
      ENVIRONMENT: 'staging',
    });
    expect(() =>
      resolveTrustedCallerBrand(
        fakeContext(env, { 'X-Platform-Caller-Brand': 'symply-budget' })
      )
    ).toThrow(/service_token_required/);
  });

  it('requires matching service token in staging when expected secret exists', () => {
    const env = baseEnv({
      APP_BRAND: 'symply-house',
      ENVIRONMENT: 'staging',
      PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE: 'budget-secret',
    });
    expect(
      resolveTrustedCallerBrand(
        fakeContext(env, {
          'X-Platform-Caller-Brand': 'symply-budget',
          'X-Platform-Service-Token': 'budget-secret',
        })
      )
    ).toBe('symply-budget');
  });

  it('allows caller header without token only in development', () => {
    const env = baseEnv({
      APP_BRAND: 'symply-house',
      ENVIRONMENT: 'development',
    });
    expect(
      resolveTrustedCallerBrand(
        fakeContext(env, { 'X-Platform-Caller-Brand': 'symply-budget' })
      )
    ).toBe('symply-budget');
  });
});
