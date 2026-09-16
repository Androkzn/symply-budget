import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import {
  capabilitiesForBrand,
  getBrandCapabilities,
  hasBrandCapability,
  isAuthProxyToHouseEnabled,
  isAuthProxyBrandId,
  isFullBudgetBrand,
  isHealthApiBrand,
  isHealthApiEnabled,
  isHomeApiBrand,
  isHouseBudgetBidirectionalPair,
  isHouseBudgetTransferPair,
  isKaizenApiBrand,
  isJoinedPlatformBrand,
  isJoinedPlatformBrandId,
  isPlatformAuthorityBrand,
  isSmartEngineBrand,
  shouldProxyHouseTransferExport,
  resolveMintAudienceBrand,
  DEFAULT_MINT_AUDIENCE_BRAND,
  isHomeApiEnabled,
  isKaizenApiEnabled,
  isPlatformAuthorityEnabled,
  isSmartEngineEnabled,
} from '../brand-capabilities';

const mkEnv = (brand: string): Env => ({ APP_BRAND: brand } as Env);

describe('brand-capabilities', () => {
  it('maps House to home + platform authority + local-first', () => {
    const caps = capabilitiesForBrand('symply-house');
    expect(caps.homeApi).toBe(true);
    expect(caps.localFirstApi).toBe(true);
    expect(caps.platformAuthority).toBe(true);
    expect(caps.kaizenApi).toBe(false);
    expect(caps.budgetMode).toBe('minimal');
    expect(caps.authProxyToHouse).toBe(false);
  });

  it('maps Budget to full budget + auth proxy + local-first', () => {
    const caps = capabilitiesForBrand('symply-budget');
    expect(caps.homeApi).toBe(false);
    expect(caps.localFirstApi).toBe(true);
    expect(caps.budgetMode).toBe('full');
    expect(caps.authProxyToHouse).toBe(true);
  });

  it('maps Kaizen to kaizen API + budget off + no local-first', () => {
    const caps = capabilitiesForBrand('symply-kaizen');
    expect(caps.kaizenApi).toBe(true);
    expect(caps.localFirstApi).toBe(false);
    expect(caps.budgetMode).toBe('off');
    expect(caps.authProxyToHouse).toBe(true);
  });

  it('joins Health Soft Transfer (POC) without House domain APIs', () => {
    const env = mkEnv('symply-health');
    expect(isSmartEngineEnabled(env)).toBe(true);
    expect(isAuthProxyToHouseEnabled(env)).toBe(true);
    expect(isPlatformAuthorityEnabled(env)).toBe(false);
    expect(isHomeApiEnabled(env)).toBe(false);
    expect(isKaizenApiEnabled(env)).toBe(false);
  });

  it('maps Health to the healthApi tracking surface', () => {
    const caps = capabilitiesForBrand('symply-health');
    expect(caps.healthApi).toBe(true);
    expect(caps.homeApi).toBe(false);
    expect(caps.kaizenApi).toBe(false);
    expect(caps.budgetMode).toBe('minimal');
    expect(caps.authProxyToHouse).toBe(true);
  });

  it('keeps healthApi OFF everywhere else in the fleet', () => {
    // The health tables carry personal medical data and the routes ship in the
    // SAME Worker binary as House/Budget/Kaizen — this flag is the only thing
    // 404ing that surface on the other three brands.
    expect(capabilitiesForBrand('symply-house').healthApi).toBe(false);
    expect(capabilitiesForBrand('symply-budget').healthApi).toBe(false);
    expect(capabilitiesForBrand('symply-kaizen').healthApi).toBe(false);
    expect(isHealthApiEnabled(mkEnv('symply-house'))).toBe(false);
    expect(isHealthApiEnabled(mkEnv('symply-budget'))).toBe(false);
    expect(isHealthApiEnabled(mkEnv('symply-kaizen'))).toBe(false);
    expect(isHealthApiEnabled(mkEnv('symply-health'))).toBe(true);
    expect(hasBrandCapability(mkEnv('symply-health'), 'healthApi')).toBe(true);
  });

  it('isHealthApiBrand resolves runtime brand ids and fails closed', () => {
    expect(isHealthApiBrand('symply-health')).toBe(true);
    expect(isHealthApiBrand('symply-house')).toBe(false);
    expect(isHealthApiBrand('symply-language')).toBe(false); // not in the AppBrand table
    expect(isHealthApiBrand('unknown')).toBe(false);
  });

  it('resolves env through getBrandCapabilities', () => {
    const env = mkEnv('symply-house');
    expect(getBrandCapabilities(env).joinedPlatform).toBe(true);
    expect(hasBrandCapability(env, 'platformRefreshSpine')).toBe(true);
    expect(isAuthProxyToHouseEnabled(mkEnv('symply-budget'))).toBe(true);
    expect(isAuthProxyToHouseEnabled(mkEnv('symply-house'))).toBe(false);
  });

  it('isHomeApiBrand resolves runtime brand ids', () => {
    expect(isHomeApiBrand('symply-house')).toBe(true);
    expect(isHomeApiBrand('symply-budget')).toBe(false);
    expect(isHomeApiBrand('unknown')).toBe(false);
  });

  it('isPlatformAuthorityBrand resolves runtime brand ids', () => {
    expect(isPlatformAuthorityBrand('symply-house')).toBe(true);
    expect(isPlatformAuthorityBrand('symply-budget')).toBe(false);
  });

  it('isJoinedPlatformBrandId gates joined fleet brands', () => {
    expect(isJoinedPlatformBrandId('symply-house')).toBe(true);
    expect(isJoinedPlatformBrandId('symply-kaizen')).toBe(true);
    expect(isJoinedPlatformBrandId('symply-health')).toBe(true);
    expect(isJoinedPlatformBrandId('bogus')).toBe(false);
    expect(isJoinedPlatformBrand('symply-budget')).toBe(true);
    expect(isJoinedPlatformBrand('symply-health')).toBe(true);
  });

  it('isHouseBudgetTransferPair and bidirectional profile helpers', () => {
    expect(isFullBudgetBrand('symply-budget')).toBe(true);
    expect(isFullBudgetBrand('symply-house')).toBe(false);
    expect(
      isHouseBudgetTransferPair('symply-house', 'symply-budget'),
    ).toBe(true);
    expect(
      isHouseBudgetTransferPair('symply-kaizen', 'symply-budget'),
    ).toBe(false);
    expect(
      isHouseBudgetBidirectionalPair('symply-budget', 'symply-house'),
    ).toBe(true);
    expect(
      isHouseBudgetBidirectionalPair('symply-kaizen', 'symply-health'),
    ).toBe(false);
  });

  it('resolveMintAudienceBrand defaults to House', () => {
    expect(resolveMintAudienceBrand()).toBe(DEFAULT_MINT_AUDIENCE_BRAND);
    expect(resolveMintAudienceBrand('symply-budget')).toBe('symply-budget');
    expect(resolveMintAudienceBrand('symply-health')).toBe('symply-health');
  });

  it('brand-id helpers mirror capability table', () => {
    expect(isKaizenApiBrand('symply-kaizen')).toBe(true);
    expect(isKaizenApiBrand('symply-house')).toBe(false);
    expect(isSmartEngineBrand('symply-health')).toBe(true);
    expect(isSmartEngineBrand('symply-budget')).toBe(true);
    expect(isAuthProxyBrandId('symply-budget')).toBe(true);
    expect(isAuthProxyBrandId('symply-house')).toBe(false);
  });

  it('shouldProxyHouseTransferExport is true on child Workers for House source', () => {
    expect(
      shouldProxyHouseTransferExport('symply-house', mkEnv('symply-budget')),
    ).toBe(true);
    expect(
      shouldProxyHouseTransferExport('symply-house', mkEnv('symply-house')),
    ).toBe(false);
  });
});
