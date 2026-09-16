/**
 * Symply Health screens barrel (`screens/index.ts`).
 *
 * The (tabs)/index and (tabs)/settings entry points import the Health screens
 * through this barrel, so its re-exports are part of the module contract. This
 * loads the barrel directly (not the individual screen files) to keep it wired.
 */

import {
  HealthActivityScreen,
  HealthBodyScreen,
  HealthHabitsScreen,
  HealthHomeScreen,
  HealthMoreScreen,
  HealthNutritionScreen,
  HealthTrendsScreen,
} from '../index';

describe('health screens barrel', () => {
  it('re-exports every tab screen component', () => {
    // One per route in the brand tab pool (see healthTabShell.test.ts) — a
    // missing export here is a blank tab at runtime, not a type error.
    expect(typeof HealthHomeScreen).toBe('function');
    expect(typeof HealthNutritionScreen).toBe('function');
    expect(typeof HealthActivityScreen).toBe('function');
    expect(typeof HealthTrendsScreen).toBe('function');
    expect(typeof HealthBodyScreen).toBe('function');
    expect(typeof HealthHabitsScreen).toBe('function');
    expect(typeof HealthMoreScreen).toBe('function');
  });
});
