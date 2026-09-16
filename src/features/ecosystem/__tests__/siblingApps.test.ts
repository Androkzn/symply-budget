/**
 * siblingApps — the "Get the Symply apps" catalog logic: which siblings to list,
 * their store links, and the baseline profile Soft Transfer consent per pair.
 */
import { Platform } from 'react-native';

import {
  getSiblingApps,
  getSiblingBrandIds,
  getStoreUrl,
  resolveProfileConsent,
} from '../siblingApps';

const HOUSE = 'symply-house';
const BUDGET = 'symply-budget';
const KAIZEN = 'symply-kaizen';
const LANGUAGE = 'symply-language';
const HEALTH = 'symply-health';

describe('getSiblingBrandIds', () => {
  it('excludes the active brand and lists the other four', () => {
    expect(getSiblingBrandIds(HOUSE)).toEqual([BUDGET, KAIZEN, LANGUAGE, HEALTH]);
    expect(getSiblingBrandIds(BUDGET)).toEqual([HOUSE, KAIZEN, LANGUAGE, HEALTH]);
    expect(getSiblingBrandIds(KAIZEN)).not.toContain(KAIZEN);
  });
});

describe('resolveProfileConsent', () => {
  it('resolves House → child profile packages', () => {
    expect(resolveProfileConsent(HOUSE, BUDGET)?.packageId).toBe('profile.core.v1');
    expect(resolveProfileConsent(HOUSE, HEALTH)?.packageId).toBe('profile.core.health.v1');
    expect(resolveProfileConsent(HOUSE, LANGUAGE)?.packageId).toBe('profile.core.language.v1');
  });

  it('is bidirectional House ↔ Budget for profile.core.v1', () => {
    const route = resolveProfileConsent(BUDGET, HOUSE);
    expect(route).toEqual({
      packageId: 'profile.core.v1',
      sourceBrandId: BUDGET,
      destinationBrandId: HOUSE,
    });
  });

  it('returns null for pairs with no registered profile package', () => {
    expect(resolveProfileConsent(HOUSE, KAIZEN)).toBeNull();
    expect(resolveProfileConsent(KAIZEN, HOUSE)).toBeNull();
    // Health/Language profile packages are one-directional House → child only.
    expect(resolveProfileConsent(HEALTH, HOUSE)).toBeNull();
    expect(resolveProfileConsent(LANGUAGE, HOUSE)).toBeNull();
  });
});

describe('getStoreUrl', () => {
  const original = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
  });

  it('derives the Play Store URL from the package on Android', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    expect(getStoreUrl(BUDGET)).toBe(
      'https://play.google.com/store/apps/details?id=com.symply.budget',
    );
  });

  it('returns null on iOS until an App Store ID is published', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    expect(getStoreUrl(BUDGET)).toBeNull();
  });
});

describe('getSiblingApps', () => {
  it('builds one entry per sibling with tagline, scheme, and consent route', () => {
    const apps = getSiblingApps(HOUSE);
    expect(apps.map((a) => a.id)).toEqual([BUDGET, KAIZEN, LANGUAGE, HEALTH]);

    const budget = apps.find((a) => a.id === BUDGET)!;
    expect(budget.scheme).toBe('simplebudget');
    expect(budget.tagline).toBeTruthy();
    expect(budget.profileConsent?.packageId).toBe('profile.core.v1');

    const kaizen = apps.find((a) => a.id === KAIZEN)!;
    expect(kaizen.profileConsent).toBeNull();
  });
});
