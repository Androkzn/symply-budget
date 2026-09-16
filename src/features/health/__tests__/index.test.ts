/**
 * Symply Health feature-module surface — brand guard + port-phase contract.
 * These are the invariants other modules rely on to gate Health-only code.
 */

import { brandId } from '@brand';

import {
  HealthActivityScreen,
  HealthBodyScreen,
  HealthHabitsScreen,
  HealthHomeScreen,
  HealthMoreScreen,
  HealthNutritionScreen,
  HealthTrendsScreen,
  HEALTH_FEATURE_ID,
  HEALTH_PORT_ORDER,
  isHealthBrand,
  type HealthPortPhase,
} from '../index';

describe('health feature module', () => {
  it('exposes a stable feature id', () => {
    expect(HEALTH_FEATURE_ID).toBe('health');
  });

  it('re-exports the screen components through the feature barrel', () => {
    // Exercises src/features/health/index.ts → screens/index.ts re-export chain,
    // so the barrels are part of the module contract other tabs import from.
    // Every `app/(tabs)/health-*.tsx` route resolves its screen from here.
    expect(typeof HealthHomeScreen).toBe('function');
    expect(typeof HealthNutritionScreen).toBe('function');
    expect(typeof HealthActivityScreen).toBe('function');
    expect(typeof HealthTrendsScreen).toBe('function');
    expect(typeof HealthBodyScreen).toBe('function');
    expect(typeof HealthHabitsScreen).toBe('function');
    expect(typeof HealthMoreScreen).toBe('function');
  });

  it('isHealthBrand only matches the symply-health runtime id', () => {
    expect(isHealthBrand('symply-health')).toBe(true);
    expect(isHealthBrand('symply-house')).toBe(false);
    expect(isHealthBrand('symply-budget')).toBe(false);
    expect(isHealthBrand('symply-kaizen')).toBe(false);
    expect(isHealthBrand('symply-language')).toBe(false);
    expect(isHealthBrand('')).toBe(false);
  });

  it('defaults to the active brand id when called with no argument', () => {
    // Covers the `id = brandId` default parameter branch. The mobile Jest
    // baseline runs as the House brand, so this is false here — but the
    // assertion tracks whatever brand the build resolves to.
    expect(isHealthBrand()).toBe(brandId === 'symply-health');
  });

  it('lists the migration port phases in the documented order', () => {
    const expected: HealthPortPhase[] = [
      'shell',
      'core-tracking',
      'healthkit',
      'companions',
      'ai-media',
    ];
    expect(HEALTH_PORT_ORDER).toEqual(expected);
    // Frozen contract: shell first, ai-media last — HealthKit/AI never lead.
    expect(HEALTH_PORT_ORDER[0]).toBe('shell');
    expect(HEALTH_PORT_ORDER[HEALTH_PORT_ORDER.length - 1]).toBe('ai-media');
    expect(new Set(HEALTH_PORT_ORDER).size).toBe(HEALTH_PORT_ORDER.length); // no dupes
  });
});
