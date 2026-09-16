/**
 * BUDGET-CORNER-022 — `resolveBrandOffering` cross-brand paywall fallback.
 *
 * All five Symply brands share ONE RevenueCat project, so `offerings.current`
 * is project-wide and not brand-specific. `resolveBrandOffering` looks up
 * `offerings.all['<brand>-default']` and falls back to `current` — meaning a
 * missing or mis-keyed `budget-default` silently serves whichever brand's
 * offering happens to be current. These tests pin both halves: the fallback IS
 * reached, and it is logged so a mis-key is detectable rather than invisible.
 */
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    setLogLevel: jest.fn(),
    setLogHandler: jest.fn(),
    getOfferings: jest.fn(),
    logIn: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(),
  },
  LOG_LEVEL: { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));

jest.mock('@api/subscription', () => ({ subscriptionApi: { sync: jest.fn() } }));
jest.mock('@services/analytics', () => ({
  trackEvent: jest.fn(),
  AnalyticsEvent: { SUBSCRIPTION_STARTED: 'x', SUBSCRIPTION_RESTORED: 'y' },
}));
jest.mock('@services/monitoring', () => ({ captureException: jest.fn() }));
jest.mock('@stores/featureFlagStore', () => ({ isFeatureEnabled: () => true }));

let mockAppBrand: string | undefined = 'symply-budget';
jest.mock('@config/env', () => ({
  get ENV() {
    return { APP_BRAND: mockAppBrand };
  },
}));

import type { PurchasesOffering, PurchasesOfferings } from 'react-native-purchases';

import { resolveBrandOffering } from '../purchases';

function mkOffering(identifier: string): PurchasesOffering {
  return { identifier, availablePackages: [] } as unknown as PurchasesOffering;
}

function mkOfferings(
  all: Record<string, PurchasesOffering>,
  current: PurchasesOffering | null = null
): PurchasesOfferings {
  return { all, current } as unknown as PurchasesOfferings;
}

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  mockAppBrand = 'symply-budget';
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('resolveBrandOffering — brand key present', () => {
  it('BUDGET-CORNER-022: picks budget-default over the project-wide current offering', () => {
    const budget = mkOffering('budget-default');
    const house = mkOffering('house-default');
    const resolved = resolveBrandOffering(mkOfferings({ 'budget-default': budget }, house));
    expect(resolved).toBe(budget);
  });

  it('BUDGET-CORNER-022: does not warn when the brand offering resolves', () => {
    const budget = mkOffering('budget-default');
    resolveBrandOffering(mkOfferings({ 'budget-default': budget }, budget));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('BUDGET-CORNER-022: strips the symply- prefix to build the offering id', () => {
    mockAppBrand = 'symply-kaizen';
    const kaizen = mkOffering('kaizen-default');
    expect(
      resolveBrandOffering(mkOfferings({ 'kaizen-default': kaizen, 'symply-kaizen': mkOffering('wrong') }))
    ).toBe(kaizen);
  });
});

describe('resolveBrandOffering — brand key absent (cross-brand leak)', () => {
  it('BUDGET-CORNER-022: falls back to another brand\'s current offering when budget-default is missing', () => {
    const house = mkOffering('house-default');
    const resolved = resolveBrandOffering(mkOfferings({ 'house-default': house }, house));
    // This is the leak the row is about: Budget's paywall serves House's offering.
    expect(resolved).toBe(house);
    expect(resolved?.identifier).toBe('house-default');
  });

  it('BUDGET-CORNER-022: logs the missing key AND the offering it fell back to', () => {
    const house = mkOffering('house-default');
    resolveBrandOffering(mkOfferings({ 'house-default': house }, house));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = String(warnSpy.mock.calls[0][0]);
    expect(line).toContain('[RevenueCat]');
    expect(line).toContain('budget-default');
    expect(line).toContain('house-default');
  });

  it('BUDGET-CORNER-022: a mis-keyed offering (typo) is detectable, not silent', () => {
    const typo = mkOffering('bugdet-default');
    const current = mkOffering('language-default');
    const resolved = resolveBrandOffering(mkOfferings({ 'bugdet-default': typo }, current));
    expect(resolved).toBe(current);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('budget-default');
  });

  it('BUDGET-CORNER-022: returns null and still warns when nothing is current', () => {
    expect(resolveBrandOffering(mkOfferings({}, null))).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('none');
  });

  it('BUDGET-CORNER-022: an unset APP_BRAND skips the lookup entirely and warns', () => {
    mockAppBrand = undefined;
    const current = mkOffering('house-default');
    expect(resolveBrandOffering(mkOfferings({ 'budget-default': mkOffering('budget-default') }, current))).toBe(
      current
    );
    expect(String(warnSpy.mock.calls[0][0])).toContain('<unknown brand>');
  });
});
