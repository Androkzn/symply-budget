/**
 * Soft Transfer package registry tests + platform brand audience checks.
 */
import { describe, expect, it } from 'vitest';

import {
  PLATFORM_BRANDS,
  PLATFORM_JWT_ISSUER,
  audienceForBrand,
  requireJoinedAudience,
} from '../platform-brands';
import { TRANSFER_PACKAGES, getTransferPackage } from '../transfer-package-registry';

describe('PLATFORM_BRANDS', () => {
  it('uses symply-ecosystem issuer constant', () => {
    expect(PLATFORM_JWT_ISSUER).toBe('symply-ecosystem');
  });

  it('maps joined audiences', () => {
    expect(audienceForBrand('symply-house')).toBe('symply-house-app');
    expect(requireJoinedAudience('symply-budget-app')).toBe('symply-budget');
    expect(requireJoinedAudience('legacy-local')).toBeNull();
    expect(requireJoinedAudience('symply-language-app')).toBe('symply-language');
  });

  it('joins Health and Language Soft Transfer brands', () => {
    expect(PLATFORM_BRANDS['symply-health'].platformAuth).toBe('joined');
    expect(PLATFORM_BRANDS['symply-health'].bridgeV1).toBe('joined');
    expect(PLATFORM_BRANDS['symply-language'].platformAuth).toBe('joined');
    expect(PLATFORM_BRANDS['symply-language'].bridgeV1).toBe('joined');
  });
});

describe('TRANSFER_PACKAGES', () => {
  it('covers House↔Budget/Health/Language Soft Transfer directions', () => {
    expect(getTransferPackage('profile.core.v1')?.destinationBrandId).toBe('symply-budget');
    expect(getTransferPackage('budget.summary.v1')?.sourceBrandId).toBe('symply-budget');
    expect(getTransferPackage('profile.core.language.v1')?.destinationBrandId).toBe(
      'symply-language'
    );
    expect(Object.keys(TRANSFER_PACKAGES)).toHaveLength(8);
  });
});
