/**
 * `useNetworkStatus` is the single source of truth `NetworkBlockOverlay` and
 * React Query's `onlineManager` both key off. Pins the things that make it
 * more than a thin `NetInfo.addEventListener` wrapper:
 *   - "online" requires BOTH `isConnected` AND `isInternetReachable !== false`
 *     (a captive portal / dead router reports `isConnected: true` too),
 *   - transitions are debounced so a brief Wi-Fi↔cellular handoff doesn't flip
 *     `appStore.isOnline` (and therefore the blocking overlay) on and off, and
 *   - going offline only takes effect after the connection reads offline
 *     CONTINUOUSLY for `OFFLINE_CONFIRM_MS`, with any single good reading in
 *     that window cancelling it outright — a flaky one-bar-signal connection
 *     that flickers every second or two must never trip the overlay. Going
 *     back online is always immediate.
 */

let netInfoListener: ((state: unknown) => void) | null = null;
const mockFetch = jest.fn();
const mockConfigure = jest.fn();
const mockUnsubscribe = jest.fn();

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    configure: (...args: unknown[]) => mockConfigure(...args),
    fetch: (...args: unknown[]) => mockFetch(...args),
    addEventListener: (listener: (state: unknown) => void) => {
      netInfoListener = listener;
      return mockUnsubscribe;
    },
  },
}));

import React from 'react';
import { act, create } from 'react-test-renderer';

import { useAppStore } from '@stores/appStore';

import { useNetworkStatus } from '../useNetworkStatus';

const OFFLINE_CONFIRM_MS = 6 * 1000;

function renderHook() {
  let captured!: ReturnType<typeof useNetworkStatus>;
  function Probe() {
    captured = useNetworkStatus();
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Probe />);
  });
  return {
    get current() {
      return captured;
    },
    unmount: () => act(() => renderer.unmount()),
  };
}

/** Flush the mount-time `NetInfo.fetch()` so it can't land mid-sequence later. */
async function flushMountFetch() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  netInfoListener = null;
  mockFetch.mockReset().mockResolvedValue({ isConnected: true, isInternetReachable: true });
  mockConfigure.mockClear();
  mockUnsubscribe.mockClear();
  useAppStore.setState({ isOnline: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useNetworkStatus', () => {
  // Must run first: the hook configures NetInfo's reachability probe only
  // ONCE per app lifetime (a module-level guard), so it only fires on this
  // suite's very first mount — later tests in this file share that guard.
  it('configures a custom reachability probe against the API health route', async () => {
    renderHook();
    await flushMountFetch();
    expect(mockConfigure).toHaveBeenCalledWith(
      expect.objectContaining({
        reachabilityUrl: expect.stringContaining('/health'),
        // Android's native module reports its own isInternetReachable boolean
        // and NetInfo trusts that over any custom probe by default — without
        // this, the reachabilityUrl config above is silently dead code there.
        useNativeReachability: false,
      })
    );
  });

  it('primes appStore.isOnline from an immediate NetInfo.fetch() on mount, once confirmed', async () => {
    mockFetch.mockResolvedValue({ isConnected: false, isInternetReachable: null });
    renderHook();
    await flushMountFetch();
    // Countdown has started but not elapsed yet.
    expect(useAppStore.getState().isOnline).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(OFFLINE_CONFIRM_MS);
    });
    expect(useAppStore.getState().isOnline).toBe(false);
  });

  it('treats isConnected + isInternetReachable=true as online', async () => {
    renderHook();
    await flushMountFetch();
    expect(useAppStore.getState().isOnline).toBe(true);
  });

  it('treats isConnected=true with isInternetReachable=false (captive portal) as OFFLINE once confirmed', async () => {
    renderHook();
    await flushMountFetch();
    act(() => {
      netInfoListener?.({ isConnected: true, isInternetReachable: false });
      jest.advanceTimersByTime(1000);
    });
    expect(useAppStore.getState().isOnline).toBe(true); // countdown running, not elapsed

    await act(async () => {
      jest.advanceTimersByTime(OFFLINE_CONFIRM_MS);
    });
    expect(useAppStore.getState().isOnline).toBe(false);
  });

  it('a brief flicker that recovers before the countdown elapses never shows the overlay', async () => {
    renderHook();
    await flushMountFetch();
    act(() => {
      netInfoListener?.({ isConnected: false, isInternetReachable: null });
      jest.advanceTimersByTime(1000);
    });
    expect(useAppStore.getState().isOnline).toBe(true); // countdown running

    act(() => {
      netInfoListener?.({ isConnected: true, isInternetReachable: true });
      jest.advanceTimersByTime(1000);
    });
    expect(useAppStore.getState().isOnline).toBe(true); // cancelled by the good reading

    // Even after the original countdown's full duration would have elapsed,
    // nothing fires — the timer was cleared, not just superseded.
    act(() => {
      jest.advanceTimersByTime(OFFLINE_CONFIRM_MS);
    });
    expect(useAppStore.getState().isOnline).toBe(true);
  });

  it('repeated short blips (each recovering before OFFLINE_CONFIRM_MS) never show the overlay', async () => {
    renderHook();
    await flushMountFetch();

    for (let i = 0; i < 4; i++) {
      act(() => {
        netInfoListener?.({ isConnected: false, isInternetReachable: null });
        jest.advanceTimersByTime(1500);
      });
      expect(useAppStore.getState().isOnline).toBe(true);
      act(() => {
        netInfoListener?.({ isConnected: true, isInternetReachable: true });
        jest.advanceTimersByTime(1500);
      });
      expect(useAppStore.getState().isOnline).toBe(true);
    }
  });

  it('treats a null isInternetReachable (probe still running) as online', () => {
    renderHook();
    act(() => {
      netInfoListener?.({ isConnected: true, isInternetReachable: null });
      jest.advanceTimersByTime(1000);
    });
    expect(useAppStore.getState().isOnline).toBe(true);
  });

  it('debounces a transition — a same-tick flip back does not toggle appStore', () => {
    renderHook();
    act(() => {
      netInfoListener?.({ isConnected: false, isInternetReachable: false });
      // Recovers before the debounce window elapses.
      netInfoListener?.({ isConnected: true, isInternetReachable: true });
      jest.advanceTimersByTime(1000);
    });
    expect(useAppStore.getState().isOnline).toBe(true);
  });

  it('applies a sustained offline transition once the connection stays down for the full confirm window', async () => {
    renderHook();
    await flushMountFetch();
    act(() => {
      netInfoListener?.({ isConnected: false, isInternetReachable: false });
    });
    expect(useAppStore.getState().isOnline).toBe(true); // not yet — still debouncing

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(useAppStore.getState().isOnline).toBe(true); // countdown running, not elapsed

    await act(async () => {
      jest.advanceTimersByTime(OFFLINE_CONFIRM_MS);
    });
    expect(useAppStore.getState().isOnline).toBe(false);
  });

  it('retry() bypasses the debounce and applies the result immediately', async () => {
    const hook = renderHook();
    await flushMountFetch();

    mockFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    useAppStore.setState({ isOnline: false });

    await act(async () => {
      await hook.current.retry();
    });

    expect(useAppStore.getState().isOnline).toBe(true);
  });

  it('self-heals while blocked: a periodic recheck clears isOnline without a manual retry', async () => {
    renderHook();
    await flushMountFetch();

    mockFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    act(() => {
      netInfoListener?.({ isConnected: false, isInternetReachable: false });
      jest.advanceTimersByTime(1000);
    });
    expect(useAppStore.getState().isOnline).toBe(true); // countdown running

    await act(async () => {
      jest.advanceTimersByTime(OFFLINE_CONFIRM_MS); // countdown elapses, now confirmed offline
    });
    expect(useAppStore.getState().isOnline).toBe(false);

    // NetInfo's own change events can stall — connectivity has actually
    // recovered by the time the fallback poll fires its next fetch.
    mockFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });

    await act(async () => {
      jest.advanceTimersByTime(10 * 1000);
      await Promise.resolve();
    });

    expect(useAppStore.getState().isOnline).toBe(true);
  });

  it('does not poll while already online', async () => {
    renderHook();
    await flushMountFetch();
    mockFetch.mockClear();

    await act(async () => {
      jest.advanceTimersByTime(30 * 1000);
      await Promise.resolve();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('unsubscribes from NetInfo on unmount', () => {
    const hook = renderHook();
    hook.unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
