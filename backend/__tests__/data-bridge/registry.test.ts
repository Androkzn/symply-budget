/**
 * Data Bridge unit/smoke tests (no Miniflare full mesh yet).
 */
import { describe, expect, it } from 'vitest';

import { PLATFORM_BRANDS, audienceForBrand } from '../../src/config/platform-brands';
import { TRANSFER_PACKAGES } from '../../src/config/transfer-package-registry';
import { peekJwtTyp, WrongTokenClassError } from '../../src/utils/platform-jwt';

describe('data-bridge registry', () => {
  it('Health and Language are joined for Soft Transfer', () => {
    expect(PLATFORM_BRANDS['symply-health'].platformAuth).toBe('joined');
    expect(PLATFORM_BRANDS['symply-health'].bridgeV1).toBe('joined');
    expect(PLATFORM_BRANDS['symply-language'].platformAuth).toBe('joined');
    expect(PLATFORM_BRANDS['symply-language'].bridgeV1).toBe('joined');
  });

  it('joined audiences are symply-*-app', () => {
    expect(audienceForBrand('symply-house')).toBe('symply-house-app');
    expect(audienceForBrand('symply-budget')).toBe('symply-budget-app');
    expect(audienceForBrand('symply-health')).toBe('symply-health-app');
    expect(audienceForBrand('symply-language')).toBe('symply-language-app');
  });

  it('transfer packages include Health and Language stubs', () => {
    expect(Object.keys(TRANSFER_PACKAGES)).toEqual([
      'profile.core.v1',
      'house.property.v1',
      'budget.summary.v1',
      'home_project_cost_summary.v1',
      'profile.core.health.v1',
      'health.summary.v1',
      'profile.core.language.v1',
      'language.summary.v1',
    ]);
  });
});

describe('token class peek', () => {
  it('decodes typ from compact JWT header', () => {
    // {"alg":"ES256","typ":"transfer+jwt"} base64url
    const header = Buffer.from(
      JSON.stringify({ alg: 'ES256', typ: 'transfer+jwt' })
    ).toString('base64url');
    const token = `${header}.e30.sig`;
    expect(peekJwtTyp(token)).toBe('transfer+jwt');
  });

  it('WrongTokenClassError carries code', () => {
    const err = new WrongTokenClassError('at+jwt', 'transfer+jwt');
    expect(err.code).toBe('wrong_token_class');
    expect(err.status).toBe(401);
  });
});
