/**
 * Symply Health — the event-driven sync trigger.
 *
 * Three things are worth failing a build over:
 *
 * 1. **No native module, no listener.** Off Health/off iOS, `nativeHealthKitModule()`
 *    is `null` and this file must not throw or leak a subscription.
 * 2. **Debounced, not polled.** Several `onHealthDataChanged` events close together
 *    collapse into ONE `importNow()` call, never one per event and never a timer
 *    that fires on its own without a signal.
 * 3. **Both arrival paths work.** A live event AND the "pending flag consumed on
 *    foreground" path must each be able to trigger a sync — the second one is what
 *    covers a change that landed while the app had no live JS runtime to hear the
 *    live event at all.
 */
import { AppState } from 'react-native';

import { showToast } from '@services/toastManager';
import { useHealthSyncStore } from '@stores/healthSyncStore';

jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

jest.mock('../healthKit', () => {
  const actual = jest.requireActual('../healthKit');
  return { ...actual, healthKit: { importNow: jest.fn() } };
});

jest.mock('../healthKitBridge', () => ({
  ...jest.requireActual('../healthKitBridge'),
  nativeHealthKitModule: jest.fn(),
}));

import { healthKit } from '../healthKit';
import { startHealthKitBackgroundSync } from '../healthKitBackgroundSync';
import { nativeHealthKitModule } from '../healthKitBridge';

const importNow = healthKit.importNow as jest.Mock;
const getNative = nativeHealthKitModule as jest.Mock;

function emptyImportResult(over: Partial<Record<string, number>> = {}) {
  return {
    state: 'connected',
    imported: 0,
    superseded: 0,
    skipped: [],
    failed: 0,
    weightImported: 0,
    weightSuperseded: 0,
    weightSkipped: [],
    weightFailed: 0,
    workoutImported: 0,
    workoutSkipped: 0,
    workoutFailed: 0,
    nutritionImported: 0,
    nutritionSuperseded: 0,
    nutritionSkipped: 0,
    nutritionFailed: 0,
    samplesRead: 0,
    syncedAt: '2026-07-28T12:00:00.000Z',
    ...over,
  };
}

function fakeNativeModule() {
  const listeners: Array<(event: { type: string }) => void> = [];
  return {
    addListener: jest.fn((_event: string, cb: (event: { type: string }) => void) => {
      listeners.push(cb);
      return { remove: jest.fn() };
    }),
    consumePendingSync: jest.fn(async () => false),
    fire: (type = 'HKQuantityTypeIdentifierBodyMass') => {
      for (const cb of listeners) cb({ type });
    },
  };
}

let appStateListeners: Array<(state: string) => void> = [];

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: string,
    cb: (state: string) => void,
  ) => {
    appStateListeners.push(cb);
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  }) as typeof AppState.addEventListener);
  importNow.mockResolvedValue(emptyImportResult());
});

afterEach(() => {
  jest.useRealTimers();
});

describe('startHealthKitBackgroundSync — no native module', () => {
  it('HEALTH-HK-400: is a safe no-op off Health / off iOS', () => {
    getNative.mockReturnValue(null);
    const handle = startHealthKitBackgroundSync();
    expect(() => handle.stop()).not.toThrow();
    expect(importNow).not.toHaveBeenCalled();
  });
});

describe('startHealthKitBackgroundSync — live event path', () => {
  it('HEALTH-HK-401: a change event triggers importNow after the debounce window', async () => {
    const native = fakeNativeModule();
    getNative.mockReturnValue(native);
    startHealthKitBackgroundSync();

    native.fire();
    expect(importNow).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(3000);
    expect(importNow).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-HK-402: several events close together collapse into ONE import', async () => {
    const native = fakeNativeModule();
    getNative.mockReturnValue(native);
    startHealthKitBackgroundSync();

    native.fire('HKQuantityTypeIdentifierBodyMass');
    await jest.advanceTimersByTimeAsync(1000);
    native.fire('HKQuantityTypeIdentifierDietaryEnergyConsumed');
    await jest.advanceTimersByTimeAsync(1000);
    native.fire(HEALTHKIT_WORKOUT_SENTINEL);
    await jest.advanceTimersByTimeAsync(3000);

    expect(importNow).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-HK-403: marks sync store (no toast) when something imported', async () => {
    const native = fakeNativeModule();
    getNative.mockReturnValue(native);
    importNow.mockResolvedValue(emptyImportResult({ weightImported: 1 }));
    useHealthSyncStore.setState({ lastSyncedAt: null });
    startHealthKitBackgroundSync();

    native.fire();
    await jest.advanceTimersByTimeAsync(3000);

    // Silent path — Watch/scale writes can fire several times an hour.
    expect(showToast).not.toHaveBeenCalled();
    expect(useHealthSyncStore.getState().lastSyncedAt).not.toBeNull();
  });

  it('HEALTH-HK-404: shows nothing when the import found no changes', async () => {
    const native = fakeNativeModule();
    getNative.mockReturnValue(native);
    importNow.mockResolvedValue(emptyImportResult());
    useHealthSyncStore.setState({ lastSyncedAt: null });
    startHealthKitBackgroundSync();

    native.fire();
    await jest.advanceTimersByTimeAsync(3000);

    expect(showToast).not.toHaveBeenCalled();
    expect(useHealthSyncStore.getState().lastSyncedAt).toBeNull();
  });

  it('HEALTH-HK-405: a rejected import never throws or surfaces a raw error', async () => {
    const native = fakeNativeModule();
    getNative.mockReturnValue(native);
    importNow.mockRejectedValue(new Error('offline'));
    startHealthKitBackgroundSync();

    native.fire();
    await expect(jest.advanceTimersByTimeAsync(3000)).resolves.toBeUndefined();
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('startHealthKitBackgroundSync — pending-flag path', () => {
  it('HEALTH-HK-406: checks for a pending change on mount, before any live event', async () => {
    const native = fakeNativeModule();
    native.consumePendingSync.mockResolvedValue(true);
    getNative.mockReturnValue(native);
    startHealthKitBackgroundSync();

    expect(native.consumePendingSync).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(3000);
    expect(importNow).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-HK-407: re-checks every time the app becomes active', async () => {
    const native = fakeNativeModule();
    getNative.mockReturnValue(native);
    startHealthKitBackgroundSync();
    native.consumePendingSync.mockClear();

    native.consumePendingSync.mockResolvedValue(true);
    for (const cb of appStateListeners) cb('active');

    expect(native.consumePendingSync).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(3000);
    expect(importNow).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-HK-408: no pending change means no import', async () => {
    const native = fakeNativeModule();
    native.consumePendingSync.mockResolvedValue(false);
    getNative.mockReturnValue(native);
    startHealthKitBackgroundSync();

    await jest.advanceTimersByTimeAsync(3000);
    expect(importNow).not.toHaveBeenCalled();
  });
});

describe('startHealthKitBackgroundSync — teardown', () => {
  it('HEALTH-HK-409: stop() removes the listener and cancels a pending debounce', async () => {
    const native = fakeNativeModule();
    getNative.mockReturnValue(native);
    const handle = startHealthKitBackgroundSync();

    native.fire();
    handle.stop();
    await jest.advanceTimersByTimeAsync(5000);

    expect(importNow).not.toHaveBeenCalled();
  });
});

const HEALTHKIT_WORKOUT_SENTINEL = 'HKWorkoutTypeIdentifier';
