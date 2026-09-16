/**
 * useHealthKitConnection — the state machine `HealthMoreScreen` used to own
 * inline. `healthKit` itself is a seam here (its own suite is
 * `healthKit.test.ts`); this file locks the ORCHESTRATION: which of
 * `getStatus` / `requestPermission` / `importNow` run, in what order, for
 * each starting state, and that `busy` brackets the whole action.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';

import { showToast } from '@services/toastManager';

import { healthKit, type HealthKitImportResult, type HealthKitStatus } from '../healthKit';
import { useHealthKitConnection, type UseHealthKitConnectionResult } from '../useHealthKitConnection';

jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

jest.mock('../healthKit', () => {
  const actual = jest.requireActual('../healthKit');
  return {
    ...actual,
    healthKit: {
      getStatus: jest.fn(),
      requestPermission: jest.fn(),
      importNow: jest.fn(),
    },
  };
});

const mockGetStatus = healthKit.getStatus as jest.Mock;
const mockRequestPermission = healthKit.requestPermission as jest.Mock;
const mockImportNow = healthKit.importNow as jest.Mock;
const mockShowToast = showToast as jest.Mock;

function importResult(over: Partial<HealthKitImportResult> = {}): HealthKitImportResult {
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
    syncedAt: '2026-07-28T00:00:00.000Z',
    ...over,
  };
}

function hkStatus(
  state: HealthKitStatus['state'],
  over: Partial<HealthKitStatus> = {},
): HealthKitStatus {
  return {
    state,
    availability: state === 'unavailable' ? 'unavailable' : 'available',
    perType: {},
    requestedAt: state === 'not-requested' ? null : '2026-07-25T08:00:00.000Z',
    lastSyncedAt: null,
    ...over,
  } as HealthKitStatus;
}

function renderHook() {
  const captured: { current: UseHealthKitConnectionResult } = { current: null as never };
  function Probe() {
    captured.current = useHealthKitConnection();
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return captured;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useHealthKitConnection — initial load', () => {
  it('starts null/not-busy, then resolves the status from getStatus()', async () => {
    mockGetStatus.mockResolvedValue(hkStatus('connected'));

    const hook = renderHook();
    expect(hook.current.status).toBeNull();
    expect(hook.current.busy).toBe(false);

    await act(async () => {});

    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    expect(hook.current.status?.state).toBe('connected');
  });
});

describe('useHealthKitConnection — connectOrSync', () => {
  it('when not connected: requests permission, imports, then re-reads status', async () => {
    mockGetStatus
      .mockResolvedValueOnce(hkStatus('not-requested')) // mount read
      .mockResolvedValueOnce(hkStatus('not-requested')) // re-read inside connectOrSync
      .mockResolvedValue(
        hkStatus('connected', { lastSyncedAt: '2026-07-27T00:00:00.000Z' }),
      ); // post-import re-read
    mockRequestPermission.mockResolvedValue(hkStatus('connected'));
    mockImportNow.mockResolvedValue(undefined);

    const hook = renderHook();
    await act(async () => {});

    await act(async () => {
      await hook.current.connectOrSync();
    });

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockImportNow).toHaveBeenCalledTimes(1);
    expect(mockGetStatus).toHaveBeenCalledTimes(3);
    expect(hook.current.status?.state).toBe('connected');
    expect(hook.current.status?.lastSyncedAt).toBe('2026-07-27T00:00:00.000Z');
    expect(hook.current.busy).toBe(false);
  });

  it('when already connected: syncs via importNow WITHOUT re-prompting', async () => {
    mockGetStatus.mockResolvedValue(hkStatus('connected'));
    mockImportNow.mockResolvedValue(undefined);

    const hook = renderHook();
    await act(async () => {});

    await act(async () => {
      await hook.current.connectOrSync();
    });

    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(mockImportNow).toHaveBeenCalledTimes(1);
  });

  it('passes an onProgress listener through to importNow, and exposes its frames as `progress`', async () => {
    mockGetStatus.mockResolvedValue(hkStatus('connected'));
    const frame = {
      stage: 'reading',
      areas: [],
      completedAreas: 0,
      totalAreas: 5,
      result: null,
    };
    mockImportNow.mockImplementation(async ({ onProgress }: { onProgress: (p: unknown) => void }) => {
      onProgress(frame);
    });

    const hook = renderHook();
    await act(async () => {});
    expect(hook.current.progress).toBeNull();

    await act(async () => {
      await hook.current.connectOrSync();
    });

    expect(mockImportNow).toHaveBeenCalledWith(expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(hook.current.progress).toEqual(frame);
  });

  it('clears a stale `progress` frame at the start of the next sync', async () => {
    mockGetStatus.mockResolvedValue(hkStatus('connected'));
    let call = 0;
    mockImportNow.mockImplementation(async ({ onProgress }: { onProgress: (p: unknown) => void }) => {
      call += 1;
      if (call === 1) onProgress({ stage: 'done', areas: [], completedAreas: 5, totalAreas: 5, result: null });
      // Second call never reports a frame, simulating a sync still in flight.
    });

    const hook = renderHook();
    await act(async () => {});

    await act(async () => {
      await hook.current.connectOrSync();
    });
    expect(hook.current.progress).not.toBeNull();

    await act(async () => {
      void hook.current.connectOrSync();
    });
    expect(hook.current.progress).toBeNull();
  });

  it('a denied permission result imports nothing', async () => {
    mockGetStatus.mockResolvedValue(hkStatus('not-requested'));
    mockRequestPermission.mockResolvedValue(hkStatus('denied'));

    const hook = renderHook();
    await act(async () => {});

    await act(async () => {
      await hook.current.connectOrSync();
    });

    expect(mockImportNow).not.toHaveBeenCalled();
    expect(hook.current.status?.state).toBe('denied');
  });

  it('keeps `syncing` false while the permission sheet is up, then true once import actually starts', async () => {
    // The full-screen sync modal is gated on `syncing`, not `busy`, precisely
    // so it never tries to present at the same time as the OS HealthKit sheet
    // (that race is what made the modal appear, get displaced, then
    // reappear). `busy` still covers the whole action, for the card's
    // disabled state.
    mockGetStatus
      .mockResolvedValueOnce(hkStatus('not-requested')) // mount read
      .mockResolvedValueOnce(hkStatus('not-requested')); // re-read inside connectOrSync
    let resolvePermission!: (status: HealthKitStatus) => void;
    mockRequestPermission.mockImplementation(
      () =>
        new Promise<HealthKitStatus>((resolve) => {
          resolvePermission = resolve;
        }),
    );
    let releaseImport!: () => void;
    mockImportNow.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseImport = () => resolve();
        }),
    );

    const hook = renderHook();
    await act(async () => {});

    let inFlight!: Promise<void>;
    await act(async () => {
      inFlight = hook.current.connectOrSync();
    });
    // Permission sheet is up: the button is locked, but our own modal must
    // stay hidden — showing it here is exactly the bug being guarded against.
    expect(hook.current.busy).toBe(true);
    expect(hook.current.syncing).toBe(false);

    mockGetStatus.mockResolvedValue(hkStatus('connected'));
    await act(async () => {
      resolvePermission(hkStatus('connected'));
    });
    // Sheet answered, import now actually running: the modal may show.
    expect(hook.current.syncing).toBe(true);

    await act(async () => {
      releaseImport();
      await inFlight;
    });

    expect(hook.current.busy).toBe(false);
    expect(hook.current.syncing).toBe(false);
  });

  it('drops `syncing` and toasts the moment saving starts, while `busy` keeps the import from being retapped', async () => {
    // The on-device read is fast; writing it to our own backend is the slow,
    // network-bound half. Nobody should be held on the blocking modal for
    // that tail — `syncing` (and the modal it drives) drops the instant the
    // `saving` frame arrives, well before `importNow()` itself resolves.
    mockGetStatus.mockResolvedValue(hkStatus('connected'));
    let onProgress!: (frame: unknown) => void;
    let resolveImport!: (result: HealthKitImportResult) => void;
    mockImportNow.mockImplementation(
      ({ onProgress: cb }: { onProgress: (frame: unknown) => void }) =>
        new Promise<HealthKitImportResult>((resolve) => {
          onProgress = cb;
          resolveImport = resolve;
        }),
    );

    const hook = renderHook();
    await act(async () => {});

    let inFlight!: Promise<void>;
    await act(async () => {
      inFlight = hook.current.connectOrSync();
    });
    expect(hook.current.syncing).toBe(true);

    await act(async () => {
      onProgress({ stage: 'reading', areas: [], completedAreas: 5, totalAreas: 5, result: null });
    });
    expect(hook.current.syncing).toBe(true);
    expect(mockShowToast).not.toHaveBeenCalled();

    await act(async () => {
      onProgress({ stage: 'saving', areas: [], completedAreas: 5, totalAreas: 5, result: null });
    });
    // Reading's done: the modal drops away, but the button stays locked —
    // the import is still writing to the backend behind it.
    expect(hook.current.syncing).toBe(false);
    expect(hook.current.busy).toBe(true);
    expect(mockShowToast).toHaveBeenCalledWith('info', expect.stringContaining('background'));

    await act(async () => {
      resolveImport(importResult({ imported: 3, weightImported: 1 }));
      await inFlight;
    });
    expect(hook.current.busy).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith('success', expect.stringContaining('Apple Health synced'));
  });

  it('shows no completion toast when the background save finds nothing new', async () => {
    mockGetStatus.mockResolvedValue(hkStatus('connected'));
    mockImportNow.mockImplementation(
      ({ onProgress }: { onProgress: (frame: unknown) => void }) => {
        onProgress({ stage: 'saving', areas: [], completedAreas: 5, totalAreas: 5, result: null });
        return Promise.resolve(importResult());
      },
    );

    const hook = renderHook();
    await act(async () => {});

    await act(async () => {
      await hook.current.connectOrSync();
    });

    expect(mockShowToast).toHaveBeenCalledWith('info', expect.stringContaining('background'));
    expect(mockShowToast).not.toHaveBeenCalledWith('success', expect.anything());
  });

  it('brackets the whole action with busy=true, unlocking only once it settles', async () => {
    mockGetStatus.mockResolvedValue(hkStatus('connected'));
    let releaseImport!: () => void;
    mockImportNow.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseImport = () => resolve();
        }),
    );

    const hook = renderHook();
    await act(async () => {});
    expect(hook.current.busy).toBe(false);

    await act(async () => {
      void hook.current.connectOrSync();
    });
    expect(hook.current.busy).toBe(true);
    expect(mockImportNow).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseImport();
    });
    expect(hook.current.busy).toBe(false);
  });

  it('a rejected import is swallowed: re-reads status, never throws, clears busy', async () => {
    mockGetStatus
      .mockResolvedValueOnce(hkStatus('connected'))
      .mockResolvedValueOnce(hkStatus('connected'))
      .mockResolvedValue(hkStatus('connected', { lastSyncedAt: null }));
    mockImportNow.mockRejectedValue(new Error('HKErrorDomain 6'));

    const hook = renderHook();
    await act(async () => {});

    await act(async () => {
      await expect(hook.current.connectOrSync()).resolves.toBeUndefined();
    });

    expect(hook.current.busy).toBe(false);
    expect(hook.current.status?.state).toBe('connected');
  });

  it('a status re-read that also fails resolves to a null status, not a thrown error', async () => {
    mockGetStatus
      .mockResolvedValueOnce(hkStatus('connected'))
      .mockResolvedValueOnce(hkStatus('connected'))
      .mockRejectedValue(new Error('bridge gone'));
    mockImportNow.mockRejectedValue(new Error('HKErrorDomain 6'));

    const hook = renderHook();
    await act(async () => {});

    await act(async () => {
      await expect(hook.current.connectOrSync()).resolves.toBeUndefined();
    });

    expect(hook.current.busy).toBe(false);
    expect(hook.current.status).toBeNull();
  });
});
