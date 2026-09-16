/**
 * Sync happens by itself, or it does not happen.
 *
 * The bug this suite exists for had no error and no failing test: every piece of
 * the sync engine worked, and nothing called it. Writing a task appended an op to
 * the local log and stopped — so the author's change sat on their phone until
 * they relaunched the app or tapped "Sync now", and because a peer is only woken
 * by a mailbox DEPOSIT, the other devices had no reason to sync either. Two
 * phones, both idle, both behaving correctly, quietly diverging.
 *
 * House carried a second half of the same gap that Budget did not: its
 * coordinator socket was opened only by `enrolmentLive`, and nothing ever called
 * `announceSyncAvailable` — so the inbound fast path did not exist in either
 * direction. `keepSignalingConnected` here is one half of the fix; the announce
 * in `orchestrator` is the other, and `orchestratorMultiProperty` owns that one.
 *
 * So the assertions here are about TRIGGERS — did a sync get scheduled, for which
 * property, and how many times — rather than about anything the sync itself does.
 * The orchestrator's own suite owns the second half.
 */
import { AppState } from 'react-native';

const HH_A = 'hh_local_aaaa';
const HH_B = 'hh_local_bbbb';

let mockLocalFirst = true;
let mockSessionOpen = true;
let mockActiveHouseholdId: string | null = HH_A;
let mockProperties = [HH_A];
/** The callback `setLocalHouseWriteListener` was handed, as the engine would hold it. */
let mockWriteListener: ((householdId: string) => void) | null = null;
/** The callback `setRemoteApplyListener` was handed — the live record counter. */
let mockApplyListener: ((householdId: string, rows: number) => void) | null = null;
/** Subscribers the engine's ledger-change bus is holding. */
const mockLedgerListeners = new Set<() => void>();
/** Handlers registered on the signaling socket. */
const mockSignalingHandlers = new Set<(event: { type: string }) => void>();

const mockRunHouseLocalSync = jest.fn(async () => undefined);
const mockRunHouseLocalSyncFor = jest.fn(async () => undefined);
const mockSignalingConnect = jest.fn();
let mockSignalingHouseholdId: string | null = HH_A;

jest.mock('../../engine', () => ({
  __esModule: true,
  isLocalHouseSessionOpen: () => mockSessionOpen,
  getActiveHouseholdId: () => mockActiveHouseholdId,
  listLocalHouseProperties: () =>
    mockProperties.map(householdId => ({ householdId })),
  setLocalHouseWriteListener: (
    listener: ((householdId: string) => void) | null,
  ) => {
    mockWriteListener = listener;
  },
  setRemoteApplyListener: (
    listener: ((householdId: string, rows: number) => void) | null,
  ) => {
    mockApplyListener = listener;
  },
  subscribeToHouseLedgerChanges: (listener: () => void) => {
    mockLedgerListeners.add(listener);
    return () => mockLedgerListeners.delete(listener);
  },
}));

jest.mock('../../flag', () => ({
  __esModule: true,
  isHouseLocalFirst: () => mockLocalFirst,
}));

jest.mock('../orchestrator', () => ({
  __esModule: true,
  runHouseLocalSync: (...args: unknown[]) =>
    mockRunHouseLocalSync(...(args as [])),
  runHouseLocalSyncFor: (...args: unknown[]) =>
    mockRunHouseLocalSyncFor(...(args as [])),
}));

jest.mock('../signalingClient', () => ({
  __esModule: true,
  getHouseSignalingClient: () => ({
    connect: mockSignalingConnect,
    get householdId() {
      return mockSignalingHouseholdId;
    },
    onEvent: (handler: (event: { type: string }) => void) => {
      mockSignalingHandlers.add(handler);
      return () => mockSignalingHandlers.delete(handler);
    },
  }),
}));

import { startHouseAutoSync, stopHouseAutoSync } from '../autoSync';
import { useHouseSyncStatusStore } from '../syncStatusStore';

/** Deliver a frame the way the coordinator's socket would. */
function announce(): void {
  for (const handler of mockSignalingHandlers)
    handler({ type: 'sync_available' });
}

/** Drive the AppState listener `startHouseAutoSync` registered. */
function setAppState(next: 'active' | 'background'): void {
  const calls = (AppState.addEventListener as unknown as jest.Mock).mock.calls;
  for (const [event, handler] of calls) {
    if (event === 'change') (handler as (s: string) => void)(next);
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() } as never);
  mockLocalFirst = true;
  mockSessionOpen = true;
  mockActiveHouseholdId = HH_A;
  mockProperties = [HH_A];
  mockSignalingHouseholdId = HH_A;
  mockWriteListener = null;
  mockApplyListener = null;
  mockLedgerListeners.clear();
  mockSignalingHandlers.clear();
  useHouseSyncStatusStore.getState().reset();
});

afterEach(() => {
  stopHouseAutoSync();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('a local write pushes itself', () => {
  it('syncs the property that was written to, shortly after the write', () => {
    startHouseAutoSync();
    expect(mockWriteListener).not.toBeNull();

    // The moment `mutateLocalHouseLedger` appends the op for a new task.
    mockWriteListener!(HH_A);
    // Nothing yet — the debounce is what collapses a multi-row gesture.
    expect(mockRunHouseLocalSyncFor).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000);

    expect(mockRunHouseLocalSyncFor).toHaveBeenCalledWith(HH_A, 'local-write');
  });

  it('collapses a burst of writes into one sync', () => {
    // Completing a checklist writes a row per item and a seasonal generation
    // writes one per entry. One mailbox round per row would be absurd, and the
    // single-flight gate cannot help — sequential awaits do not overlap in time.
    startHouseAutoSync();

    for (let i = 0; i < 20; i += 1) mockWriteListener!(HH_A);
    jest.advanceTimersByTime(1_000);

    expect(mockRunHouseLocalSyncFor).toHaveBeenCalledTimes(1);
  });

  it('keeps two properties apart', () => {
    // One timer would drop the first property's push on the floor.
    startHouseAutoSync();

    mockWriteListener!(HH_A);
    mockWriteListener!(HH_B);
    jest.advanceTimersByTime(1_000);

    expect(mockRunHouseLocalSyncFor).toHaveBeenCalledWith(HH_A, 'local-write');
    expect(mockRunHouseLocalSyncFor).toHaveBeenCalledWith(HH_B, 'local-write');
  });

  it('does not sync a write that lands after the session closed', () => {
    // Sign-out between the write and the debounce firing. Syncing here would
    // reach for a session that is gone, on behalf of an account that has left.
    startHouseAutoSync();
    mockWriteListener!(HH_A);
    mockSessionOpen = false;

    jest.advanceTimersByTime(1_000);

    expect(mockRunHouseLocalSyncFor).not.toHaveBeenCalled();
  });
});

describe("a peer's announcement is collected immediately", () => {
  it('syncs the announcing property as soon as the frame lands', () => {
    startHouseAutoSync();

    announce();

    expect(mockRunHouseLocalSyncFor).toHaveBeenCalledWith(
      HH_A,
      'peer-announce',
    );
  });

  it('collapses duplicate frames from a multi-device home', () => {
    // The coordinator fans one announcement out to every other device, so a
    // three-phone home delivers the same news more than once.
    startHouseAutoSync();

    announce();
    announce();
    announce();

    expect(mockRunHouseLocalSyncFor).toHaveBeenCalledTimes(1);
  });

  it('reacts again once the throttle window has passed', () => {
    startHouseAutoSync();
    announce();
    jest.advanceTimersByTime(2_000);

    announce();

    expect(mockRunHouseLocalSyncFor).toHaveBeenCalledTimes(2);
  });

  it('ignores every other signaling frame', () => {
    // House's socket also carries presence and the four enrolment frames. Syncing
    // on any of those would turn an enrolment handshake into a sync storm — and
    // `enrolmentLive` is listening on the same socket for exactly those.
    startHouseAutoSync();

    for (const handler of mockSignalingHandlers) {
      handler({ type: 'presence.join' });
      handler({ type: 'presence.leave' });
      handler({ type: 'enrolment.claimed' });
      handler({ type: 'enrolment.approved' });
      handler({ type: 'pong' });
    }

    expect(mockRunHouseLocalSyncFor).not.toHaveBeenCalled();
  });

  it('falls back to the active property when the socket names none', () => {
    // A socket that has not finished binding reports null. The frame still came
    // from the room this device is in, which is the active property by
    // construction — `connect()` refuses any other.
    mockSignalingHouseholdId = null;
    startHouseAutoSync();

    announce();

    expect(mockRunHouseLocalSyncFor).toHaveBeenCalledWith(
      HH_A,
      'peer-announce',
    );
  });
});

describe('the safety net under the fast paths', () => {
  it('syncs on foreground', () => {
    startHouseAutoSync();
    setAppState('background');
    mockRunHouseLocalSync.mockClear();

    setAppState('active');

    expect(mockRunHouseLocalSync).toHaveBeenCalledWith('app-foreground');
  });

  it('polls while the app is in the foreground', () => {
    // The socket can die without anything noticing and a push can be dropped;
    // this is what stops either from becoming an hour of divergence.
    startHouseAutoSync();
    mockRunHouseLocalSync.mockClear();

    jest.advanceTimersByTime(46_000);

    expect(mockRunHouseLocalSync).toHaveBeenCalledWith('heartbeat');
  });

  it('stops polling in the background', () => {
    startHouseAutoSync();
    setAppState('background');
    mockRunHouseLocalSync.mockClear();

    jest.advanceTimersByTime(120_000);

    expect(mockRunHouseLocalSync).not.toHaveBeenCalled();
  });

  it('does not poll a device that holds no property yet', () => {
    // A signed-in device mid-bootstrap. The socket is still re-asserted — that
    // costs nothing and is what catches the first enrolment — but there is
    // nothing to sync.
    mockProperties = [];
    startHouseAutoSync();
    mockRunHouseLocalSync.mockClear();

    jest.advanceTimersByTime(46_000);

    expect(mockRunHouseLocalSync).not.toHaveBeenCalled();
    expect(mockSignalingConnect).toHaveBeenCalled();
  });

  it('keeps the socket up rather than opening one per sync', () => {
    // The device most in need of an announcement is an IDLE one, and House never
    // opened a socket for sync at all — so the device that needed to hear had
    // nothing open to hear on.
    startHouseAutoSync();
    expect(mockSignalingConnect).toHaveBeenCalled();

    mockSignalingConnect.mockClear();
    // A property switch moves the socket to a different room.
    for (const listener of mockLedgerListeners) listener();

    expect(mockSignalingConnect).toHaveBeenCalled();
  });
});

describe('teardown', () => {
  it('leaves nothing behind that can fire for a signed-out account', () => {
    startHouseAutoSync();
    const captured = mockWriteListener!;

    stopHouseAutoSync();

    // The engine's slot is released, so a late write cannot reach us at all.
    expect(mockWriteListener).toBeNull();
    // And a push already scheduled when teardown ran does not fire either.
    captured(HH_A);
    jest.advanceTimersByTime(120_000);
    expect(mockRunHouseLocalSyncFor).not.toHaveBeenCalled();
    expect(mockRunHouseLocalSync).not.toHaveBeenCalled();
  });

  it('does nothing at all on a server-backed build', () => {
    mockLocalFirst = false;

    startHouseAutoSync();

    expect(mockWriteListener).toBeNull();
    expect(mockSignalingConnect).not.toHaveBeenCalled();
  });

  it('is idempotent — a second session open does not double every trigger', () => {
    startHouseAutoSync();
    startHouseAutoSync();

    mockWriteListener!(HH_A);
    jest.advanceTimersByTime(1_000);

    expect(mockRunHouseLocalSyncFor).toHaveBeenCalledTimes(1);
  });
});

describe('the live record counter', () => {
  it('accumulates the rows the engine reports', () => {
    // ROWS, not ops. One op can be a single renamed room or four hundred rows
    // from a floor-plan import, so an op counter tells a member watching a sync
    // almost nothing about how much of their home has arrived.
    startHouseAutoSync();

    mockApplyListener!(HH_A, 40);
    mockApplyListener!(HH_A, 2);

    expect(useHouseSyncStatusStore.getState().recordsThisSession).toBe(42);
  });

  it('ignores a background property', () => {
    // The status store is a single-property surface. A background property
    // merging four hundred rows must not make the screen the member is looking
    // at claim it just received them.
    startHouseAutoSync();

    mockApplyListener!(HH_B, 400);

    expect(useHouseSyncStatusStore.getState().recordsThisSession).toBe(0);
  });

  it('is released on teardown', () => {
    startHouseAutoSync();
    stopHouseAutoSync();

    expect(mockApplyListener).toBeNull();
  });
});
