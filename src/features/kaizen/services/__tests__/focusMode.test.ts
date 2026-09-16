import { Linking, Platform } from 'react-native';

import {
  FOCUS_FILTER_ACTIVE_KEY,
  focusModeHint,
  isDeepWorkFocusFilterActive,
  openSystemFocusSettings,
  setDeepWorkFocusFilterActive,
} from '../focusMode';

const store: Record<string, string> = {};
jest.mock('../storage', () => ({
  storageHelpers: {
    getString: jest.fn((k: string) => store[k] ?? null),
    setString: jest.fn((k: string, v: string) => {
      store[k] = v;
    }),
    remove: jest.fn((k: string) => {
      delete store[k];
    }),
  },
}));

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  // clearAllMocks (not restoreAllMocks): the jest-expo react-native Linking mock
  // is non-configurable, so spies can't be fully restored — clear call history
  // each test instead and let each test re-declare its own resolved values.
  jest.clearAllMocks();
  (Platform as unknown as { OS: string }).OS = 'ios';
});

describe('deep-work focus filter flag', () => {
  it('defaults to inactive and toggles on/off', () => {
    expect(isDeepWorkFocusFilterActive()).toBe(false);

    setDeepWorkFocusFilterActive(true);
    expect(store[FOCUS_FILTER_ACTIVE_KEY]).toBe('true');
    expect(isDeepWorkFocusFilterActive()).toBe(true);

    setDeepWorkFocusFilterActive(false);
    expect(store[FOCUS_FILTER_ACTIVE_KEY]).toBeUndefined();
    expect(isDeepWorkFocusFilterActive()).toBe(false);
  });
});

describe('focusModeHint', () => {
  it('reports when the suggestion is off', () => {
    expect(focusModeHint(false)).toMatch(/suggestion is off/);
  });

  it('reports when the filter is already active', () => {
    setDeepWorkFocusFilterActive(true);
    expect(focusModeHint(true)).toMatch(/Focus filter is active/);
  });

  it('gives platform-specific setup guidance when idle', () => {
    (Platform as unknown as { OS: string }).OS = 'ios';
    expect(focusModeHint(true)).toMatch(/Settings → Focus → Filters/);

    (Platform as unknown as { OS: string }).OS = 'android';
    expect(focusModeHint(true)).toMatch(/device Focus \/ DND/);
  });
});

describe('openSystemFocusSettings', () => {
  it('opens the first deep-linkable Focus URL on iOS', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);

    expect(await openSystemFocusSettings()).toBe(true);
    expect(openUrl).toHaveBeenCalledWith('App-prefs:FOCUS');
  });

  it('falls back to openSettings when no Focus URL is supported', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);

    expect(await openSystemFocusSettings()).toBe(true);
    expect(openSettings).toHaveBeenCalled();
  });

  it('uses openSettings directly on non-iOS platforms', async () => {
    (Platform as unknown as { OS: string }).OS = 'android';
    const canOpen = jest.spyOn(Linking, 'canOpenURL');
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);

    expect(await openSystemFocusSettings()).toBe(true);
    expect(canOpen).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalled();
  });

  it('returns false on iOS when no Focus URL opens and openSettings throws', async () => {
    (Platform as unknown as { OS: string }).OS = 'ios';
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
    jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('no settings'));

    expect(await openSystemFocusSettings()).toBe(false);
  });

  it('returns false on non-iOS when openSettings throws', async () => {
    (Platform as unknown as { OS: string }).OS = 'android';
    jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('no settings'));

    expect(await openSystemFocusSettings()).toBe(false);
  });
});
