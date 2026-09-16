/**
 * Sync happens by itself, or it does not happen.
 *
 * The bug this suite exists for had no error and no failing test: every piece of
 * the sync engine worked, and nothing called it. Writing a spending appended an
 * op to the local log and stopped — so the author's change sat on their phone
 * until they relaunched the app or tapped "Sync now", and because a peer is only
 * woken by a mailbox DEPOSIT, the other devices had no reason to sync either.
 * Two phones, both idle, both behaving correctly, quietly diverging.
 *
 * So the assertions here are about TRIGGERS — did a sync get scheduled, for
 * which household, and how many times — rather than about anything the sync
 * itself does. The orchestrator's own suite owns the second half.
 */
import { AppState } from 'react-native';

const HH_A = 'hh_local_aaaa';
const HH_B = 'hh_local_bbbb';

let mockLocalFirst = true;
let mockSessionOpen = true;
let mockActiveHouseholdId: string | null = HH_A;
let mockHouseholds = [HH_A];
/** The callback `setLocalWriteListener` was handed, as the engine would hold it. */
let mockWriteListener: ((householdId: string) => void) | null = null;
/** Likewise for `setRemoteApplyListener` — the live record counter's source. */
let mockApplyListener: ((householdId: string, rows: number) => void) | null = null;
/** Subscribers the engine's ledger-change bus is holding. */
const mockLedgerListeners = new Set<() => void>();
/** Handlers registered on the signaling socket. */
const mockSignalingHandlers = new Set<(event: { type: string }) => void>();

const mockRunBudgetLocalSync = jest.fn(async () => undefined);
const mockRunBudgetLocalSyncFor = jest.fn(async () => undefined);
const mockSignalingConnect = jest.fn();
let mockSignalingHouseholdId: string | null = HH_A;

jest.mock('../../engine', () => ({
  __esModule: true,
  isLocalBudgetSessionOpen: () => mockSessionOpen,
  getActiveBudgetHouseholdId: () => mockActiveHouseholdId,
  listLocalBudgetHouseholds: () =>
    mockHouseholds.map((householdId) => ({ householdId })),
  setLocalWriteListener: (listener: ((householdId: string) => void) | null) => {
    mockWriteListener = listener;
  },
  setRemoteApplyListener: (
    listener: ((householdId: string, rows: number) => void) | null,
  ) => {
    mockApplyListener = listener;
  },
  subscribeToLedgerChanges: (listener: () => void) => {
    mockLedgerListeners.add(listener);
    return () => mockLedgerListeners.delete(listener);
  },
}));

jest.mock('../../flag', () => ({
  __esModule: true,
  isBudgetLocalFirst: () => mockLocalFirst,
}));

jest.mock('../orchestrator', () => ({
  __esModule: true,
  runBudgetLocalSync: (...args: unknown[]) => mockRunBudgetLocalSync(...(args as [])),
  runBudgetLocalSyncFor: (...args: unknown[]) =>
    mockRunBudgetLocalSyncFor(...(args as [])),
}));

jest.mock('../signalingClient', () => ({
  __esModule: true,
  getSignalingClient: () => ({
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

import { startBudgetAutoSync, stopBudgetAutoSync } from '../autoSync';
import { useBudgetSyncStatusStore } from '../syncStatusStore';

/** Deliver a frame the way the coordinator's socket would. */
function announce(): void {
  for (const handler of mockSignalingHandlers) handler({ type: 'sync_available' });
}

/** Drive the AppState listener `startBudgetAutoSync` registered. */
function setAppState(next: 'active' | 'background'): void {
  const calls = (AppState.addEventListener as unknown as jest.Mock).mock.calls;
  for (const [event, handler] of calls) {
    if (event === 'change') (handler as (s: string) => void)(next);
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({
    remove: jest.fn(),
  } as never);
  mockLocalFirst = true;
  mockSessionOpen = true;
  mockActiveHouseholdId = HH_A;
  mockHouseholds = [HH_A];
  mockSignalingHouseholdId = HH_A;
  mockWriteListener = null;
  mockApplyListener = null;
  mockLedgerListeners.clear();
  mockSignalingHandlers.clear();
  useBudgetSyncStatusStore.getState().reset();
});

afterEach(() => {
  stopBudgetAutoSync();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('a local write pushes itself', () => {
  it('syncs the household that was written to, shortly after the write', () => {
    startBudgetAutoSync();
    expect(mockWriteListener).not.toBeNull();

    // The moment `mutateLocalLedger` appends the op for a new spending.
    mockWriteListener!(HH_A);
    // Nothing yet — the debounce is what collapses a multi-row gesture.
    expect(mockRunBudgetLocalSyncFor).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000);

    expect(mockRunBudgetLocalSyncFor).toHaveBeenCalledWith(HH_A, 'local-write');
  });

  it('collapses a burst of writes into one sync', () => {
    // A receipt import writes a row per line item and `applyGoalToYear` writes
    // twelve. One mailbox round per row would be absurd, and the single-flight
    // gate cannot help — sequential awaits do not overlap in time.
    startBudgetAutoSync();

    for (let i = 0; i < 20; i += 1) mockWriteListener!(HH_A);
    jest.advanceTimersByTime(1_000);

    expect(mockRunBudgetLocalSyncFor).toHaveBeenCalledTimes(1);
  });

  it('keeps two households apart', () => {
    // One timer would drop the first household's push on the floor.
    startBudgetAutoSync();

    mockWriteListener!(HH_A);
    mockWriteListener!(HH_B);
    jest.advanceTimersByTime(1_000);

    expect(mockRunBudgetLocalSyncFor).toHaveBeenCalledWith(HH_A, 'local-write');
    expect(mockRunBudgetLocalSyncFor).toHaveBeenCalledWith(HH_B, 'local-write');
  });

  it('does not sync a write that lands after the session closed', () => {
    // Sign-out between the write and the debounce firing. Syncing here would
    // reach for a session that is gone, on behalf of an account that has left.
    startBudgetAutoSync();
    mockWriteListener!(HH_A);
    mockSessionOpen = false;

    jest.advanceTimersByTime(1_000);

    expect(mockRunBudgetLocalSyncFor).not.toHaveBeenCalled();
  });
});

describe("a peer's announcement is collected immediately", () => {
  it('syncs the announcing household as soon as the frame lands', () => {
    startBudgetAutoSync();

    announce();

    expect(mockRunBudgetLocalSyncFor).toHaveBeenCalledWith(HH_A, 'peer-announce');
  });

  it('collapses duplicate frames from a multi-device household', () => {
    // The coordinator fans one announcement out to every other device, so a
    // three-phone household delivers the same news more than once.
    startBudgetAutoSync();

    announce();
    announce();
    announce();

    expect(mockRunBudgetLocalSyncFor).toHaveBeenCalledTimes(1);
  });

  it('reacts again once the throttle window has passed', () => {
    startBudgetAutoSync();
    announce();
    jest.advanceTimersByTime(2_000);

    announce();

    expect(mockRunBudgetLocalSyncFor).toHaveBeenCalledTimes(2);
  });

  it('ignores every other signaling frame', () => {
    // The socket also carries presence, SDP, ICE and enrolment events. Syncing
    // on any of those would turn a WebRTC handshake into a sync storm.
    startBudgetAutoSync();

    for (const handler of mockSignalingHandlers) {
      handler({ type: 'presence.join' });
      handler({ type: 'signal.ice' });
      handler({ type: 'enrolment.claimed' });
    }

    expect(mockRunBudgetLocalSyncFor).not.toHaveBeenCalled();
  });
});

describe('the safety net under the fast paths', () => {
  it('syncs on foreground', () => {
    startBudgetAutoSync();
    setAppState('background');
    mockRunBudgetLocalSync.mockClear();

    setAppState('active');

    expect(mockRunBudgetLocalSync).toHaveBeenCalledWith('app-foreground');
  });

  it('polls while the app is in the foreground', () => {
    // The socket can die without anything noticing and a push can be dropped;
    // this is what stops either from becoming an hour of divergence.
    startBudgetAutoSync();
    mockRunBudgetLocalSync.mockClear();

    jest.advanceTimersByTime(46_000);

    expect(mockRunBudgetLocalSync).toHaveBeenCalledWith('heartbeat');
  });

  it('stops polling in the background', () => {
    startBudgetAutoSync();
    setAppState('background');
    mockRunBudgetLocalSync.mockClear();

    jest.advanceTimersByTime(120_000);

    expect(mockRunBudgetLocalSync).not.toHaveBeenCalled();
  });

  it('keeps the socket up rather than opening one per sync', () => {
    // The device most in need of an announcement is an IDLE one, and before
    // this the socket was only opened at the tail of a sync run — so the device
    // that needed to hear had nothing open to hear on.
    startBudgetAutoSync();
    expect(mockSignalingConnect).toHaveBeenCalled();

    mockSignalingConnect.mockClear();
    // A household switch moves the socket to a different room.
    for (const listener of mockLedgerListeners) listener();

    expect(mockSignalingConnect).toHaveBeenCalled();
  });
});

describe('the live record counter', () => {
  it('accumulates the rows the engine reports', () => {
    // ROWS, not ops. One op can be a single edited amount or four hundred rows
    // from a bulk import, so an op counter tells a member watching a sync almost
    // nothing about how much of their budget has arrived.
    startBudgetAutoSync();

    mockApplyListener!(HH_A, 40);
    mockApplyListener!(HH_A, 2);

    expect(useBudgetSyncStatusStore.getState().recordsThisSession).toBe(42);
  });

  it('ignores a background household', () => {
    // The status store is a single-household surface. A background household
    // merging four hundred rows must not make the screen the member is looking
    // at claim it just received them.
    startBudgetAutoSync();

    mockApplyListener!(HH_B, 400);

    expect(useBudgetSyncStatusStore.getState().recordsThisSession).toBe(0);
  });

  it('is released on teardown', () => {
    startBudgetAutoSync();
    stopBudgetAutoSync();

    expect(mockApplyListener).toBeNull();
  });
});

describe('teardown', () => {
  it('leaves nothing behind that can fire for a signed-out account', () => {
    startBudgetAutoSync();
    const captured = mockWriteListener!;

    stopBudgetAutoSync();

    // The engine's slot is released, so a late write cannot reach us at all.
    expect(mockWriteListener).toBeNull();
    // And a push already scheduled when teardown ran does not fire either.
    captured(HH_A);
    jest.advanceTimersByTime(120_000);
    expect(mockRunBudgetLocalSyncFor).not.toHaveBeenCalled();
    expect(mockRunBudgetLocalSync).not.toHaveBeenCalled();
  });

  it('does nothing at all on a server-backed build', () => {
    mockLocalFirst = false;

    startBudgetAutoSync();

    expect(mockWriteListener).toBeNull();
    expect(mockSignalingConnect).not.toHaveBeenCalled();
  });
});
