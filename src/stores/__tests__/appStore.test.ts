/**
 * appStore — unit tests for theme + color-schema state.
 *
 * Focuses on the `colorScheme` skin selector (clean default vs house) added
 * for the two-schema theming system, plus the existing `themeMode`. The
 * settings-sync side effect is mocked so we can assert the persisted key
 * without touching storage / the network.
 */

jest.mock('@services/settings-sync', () => ({
  settingsSync: {
    queueSync: jest.fn(),
    setHydrating: jest.fn(),
    setOnlineStatus: jest.fn(),
  },
}));

const mockGetLocales = jest.fn(() => [] as Array<{ regionCode?: string }>);
jest.mock('expo-localization', () => ({
  getLocales: () => mockGetLocales(),
}));

import { settingsSync } from '@services/settings-sync';
import { useAppStore } from '@stores/appStore';

const queueSync = settingsSync.queueSync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLocales.mockReturnValue([]);
  useAppStore.setState({
    colorScheme: 'clean',
    themeMode: 'system',
    currency: 'USD',
    taxCountry: null,
    taxRegion: null,
  });
});

describe('appStore — initial state', () => {
  it('defaults to the "clean" color schema', () => {
    expect(useAppStore.getState().colorScheme).toBe('clean');
  });

  it('defaults themeMode to "system"', () => {
    expect(useAppStore.getState().themeMode).toBe('system');
  });
});

describe('appStore — setColorScheme', () => {
  it('switches to house and persists via settings-sync', () => {
    useAppStore.getState().setColorScheme('house');

    expect(useAppStore.getState().colorScheme).toBe('house');
    expect(queueSync).toHaveBeenCalledWith('theme.colorScheme', 'house');
  });

  it('switches back to clean', () => {
    useAppStore.getState().setColorScheme('house');
    useAppStore.getState().setColorScheme('clean');

    expect(useAppStore.getState().colorScheme).toBe('clean');
    expect(queueSync).toHaveBeenLastCalledWith('theme.colorScheme', 'clean');
  });
});

describe('appStore — setCurrency', () => {
  it('defaults currency to USD', () => {
    expect(useAppStore.getState().currency).toBe('USD');
  });

  it('updates the code and persists under preferences.currency', () => {
    useAppStore.getState().setCurrency('EUR');

    expect(useAppStore.getState().currency).toBe('EUR');
    expect(queueSync).toHaveBeenCalledWith('preferences.currency', 'EUR');
  });

  it('applies a persisted currency on hydrate, and coerces unknown codes to USD', () => {
    useAppStore.getState().hydrate({ currency: 'CAD' });
    expect(useAppStore.getState().currency).toBe('CAD');

    useAppStore.getState().hydrate({ currency: 'ZZZ' as 'USD' });
    expect(useAppStore.getState().currency).toBe('USD');

    // Absent setting leaves the current value untouched.
    useAppStore.setState({ currency: 'GBP' });
    useAppStore.getState().hydrate({ themeMode: 'dark' });
    expect(useAppStore.getState().currency).toBe('GBP');
  });
});

describe('appStore — setTaxRegion', () => {
  it('defaults tax region to unset (null)', () => {
    expect(useAppStore.getState().taxCountry).toBeNull();
    expect(useAppStore.getState().taxRegion).toBeNull();
  });

  it('stores country + province/state and persists both under preferences.*', () => {
    useAppStore.getState().setTaxRegion('CA', 'BC');

    expect(useAppStore.getState().taxCountry).toBe('CA');
    expect(useAppStore.getState().taxRegion).toBe('BC');
    expect(queueSync).toHaveBeenCalledWith('preferences.taxCountry', 'CA');
    expect(queueSync).toHaveBeenCalledWith('preferences.taxRegion', 'BC');
  });

  it('applies a persisted region on hydrate', () => {
    useAppStore.getState().hydrate({ taxCountry: 'US', taxRegion: 'CA' });
    expect(useAppStore.getState().taxCountry).toBe('US');
    expect(useAppStore.getState().taxRegion).toBe('CA');
  });

  it('seeds country from the device locale only when unset', () => {
    mockGetLocales.mockReturnValue([{ regionCode: 'CA' }]);
    useAppStore.getState().seedFirstRunTaxRegion();
    expect(useAppStore.getState().taxCountry).toBe('CA');
    expect(useAppStore.getState().taxRegion).toBeNull();

    mockGetLocales.mockReturnValue([{ regionCode: 'US' }]);
    useAppStore.getState().seedFirstRunTaxRegion();
    expect(useAppStore.getState().taxCountry).toBe('CA');
  });
});

describe('appStore — setThemeMode', () => {
  it('updates the mode and persists under theme.mode', () => {
    useAppStore.getState().setThemeMode('dark');

    expect(useAppStore.getState().themeMode).toBe('dark');
    expect(queueSync).toHaveBeenCalledWith('theme.mode', 'dark');
  });
});

describe('appStore — hydrate', () => {
  it('applies a persisted colorScheme', () => {
    useAppStore.getState().hydrate({ colorScheme: 'house' });
    expect(useAppStore.getState().colorScheme).toBe('house');
  });

  it('leaves colorScheme untouched when the setting is absent', () => {
    useAppStore.setState({ colorScheme: 'house' });
    useAppStore.getState().hydrate({ themeMode: 'dark' });

    expect(useAppStore.getState().colorScheme).toBe('house');
    expect(useAppStore.getState().themeMode).toBe('dark');
  });

  it('does not write back to settings-sync during hydration', () => {
    useAppStore.getState().hydrate({ colorScheme: 'house' });
    expect(queueSync).not.toHaveBeenCalled();
  });
});
