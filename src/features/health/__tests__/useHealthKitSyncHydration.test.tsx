/**
 * useHealthKitSyncHydration — focused-tab + after-interactions refresh.
 */
import React from 'react';
import { InteractionManager } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { useHealthSyncStore } from '@stores/healthSyncStore';

import { useHealthKitSyncHydration } from '../useHealthKitSyncHydration';

let mockIsFocused = true;

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockIsFocused,
}));

function Probe({ hydrate }: { hydrate: () => void }) {
  useHealthKitSyncHydration(hydrate);
  return null;
}

describe('useHealthKitSyncHydration', () => {
  beforeEach(() => {
    mockIsFocused = true;
    useHealthSyncStore.setState({ lastSyncedAt: null });
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((cb) => {
      const handle = { cancel: jest.fn() };
      // Run immediately in tests — production waits for gestures to settle.
      (cb as () => void)();
      return handle as unknown as ReturnType<typeof InteractionManager.runAfterInteractions>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hydrates the focused screen when markSynced fires', async () => {
    const hydrate = jest.fn();
    await act(async () => {
      ReactTestRenderer.create(<Probe hydrate={hydrate} />);
    });
    expect(hydrate).not.toHaveBeenCalled();

    await act(async () => {
      useHealthSyncStore.getState().markSynced();
    });
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it('skips hydration when the screen is not focused', async () => {
    mockIsFocused = false;
    const hydrate = jest.fn();
    await act(async () => {
      ReactTestRenderer.create(<Probe hydrate={hydrate} />);
    });

    await act(async () => {
      useHealthSyncStore.getState().markSynced();
    });
    expect(hydrate).not.toHaveBeenCalled();
  });
});
