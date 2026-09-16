/**
 * BUDGET-SETT-032 — Settings tab owns an independent NavigationContainer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Budget settings NavigationContainer contract (BUDGET-SETT-032)', () => {
  it('wraps SettingsNavigator in NavigationIndependentTree + NavigationContainer', () => {
    const settingsTabSource = readFileSync(join(__dirname, '../../../../app/(tabs)/settings.tsx'), 'utf8');

    expect(settingsTabSource).toContain('NavigationIndependentTree');
    expect(settingsTabSource).toContain('NavigationContainer');
    expect(settingsTabSource).toContain('SettingsNavigator');
    expect(settingsTabSource.indexOf('NavigationContainer')).toBeLessThan(
      settingsTabSource.indexOf('SettingsNavigator')
    );
  });
});
