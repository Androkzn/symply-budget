/**
 * BR-016 B3 — sync is per household, and every run is bound to ITS household's
 * session handle.
 *
 * All three failures this guards are silent. Nothing throws when a background
 * household's batch is sealed under the foreground household's HDK: the ops are
 * correctly encrypted, correctly signed, and land in a mailbox whose peers
 * cannot open them — invisible until the two households diverge and somebody
 * asks why household B never syncs. Nothing throws when a global single-flight
 * hands household B the promise of household A's hung run either; B simply never
 * syncs and reports that it did (plan §2 hazard 7). And nothing throws when a
 * background household writes its result onto the status banner — it just paints
 * an error over a screen that is working fine.
 *
 * So the assertions here are about WHICH household's material reached the
 * mailbox, not about whether a sync "succeeded".
 */
/* -------------------------------------------------------------------------- */
/* Fixtures the mock factories close over. Declared before the mocks read them  */
/* only at call time, which is after the module body has run.                   */
/* -------------------------------------------------------------------------- */

let mockAuthUserId = 'usr_ada';
jest.mock('../recoveryWake', () => ({ requestRecoveryWake: jest.fn(async () => undefined) }));
jest.mock('../ledgerRefresh', () => ({refreshBudgetLedgerNow: jest.fn(async () => undefined)}));
jest.mock('@stores/authStore', () => ({useAuthStore:{getState:() => ({isAuthenticated:true,user:{id:mockAuthUserId}})}}));

const DEVICE_ID = 'dev_this_device';
const PEER_DEVICE_ID = 'dev_peer';
const HH_A = 'hh_local_aaaa';
const HH_B = 'hh_local_bbbb';
const HH_C = 'hh_local_cccc';

type FakeStore = {
  getVersionVector: jest.Mock;
  getSyncPeerState: jest.Mock;
  listOperationsSince: jest.Mock;
  listOperationsByHlc: jest.Mock;
};

type FakeHandle = {
  householdId: string;
  ledger: { household: { id: string; name: string }; deviceId: string; memberId: string };
  identity: { deviceId: string; signingPublicKey: Uint8Array; agreementPublicKey: Uint8Array };
  householdKeys: { householdId: string; hdk: Uint8Array; keyEpoch: number };
  retiredHouseholdKeys: Map<number, Uint8Array>;
  opLog: { label: string };
  store: FakeStore;
  awaitingEnrolment: boolean;
};

/** What the mailbox engine was actually handed, per construction. */
type MailboxOptions = {
  store: FakeStore;
  opLog: { label: string };
  householdKeys: { householdId: string; hdk: Uint8Array; keyEpoch: number };
  deviceId: string;
  signingPublicKey: Uint8Array;
  peerDeviceIds?: string[];
};

/**
 * The REAL result shape, not a hand-rolled copy of it.
 *
 * This was a local duplicate listing seven of the engine's fields, and it drifted
 * the moment the engine grew `rejectedReasons` / `duplicates` / `rejected` /
 * `deferredBlobs`. The orchestrator then read a field the fixture did not have,
 * threw inside the try that decides the household's phase, and two tests failed
 * claiming a background household had painted its failure over the banner — a
 * completely different bug from the one that existed. Aliasing the engine's own
 * type makes the next added field a compile error here instead.
 */
type MailboxResult = MailboxSyncResult;

const mockHandles = new Map<string, FakeHandle>();
const mockMailboxes: MailboxOptions[] = [];
const mockConflicts = new Map<string, unknown[]>();

let mockActiveHouseholdId: string | null = HH_A;
let mockSessionOpen = true;
let mockLocalFirst = true;
let mockMailboxResult: MailboxResult = {
  applied: 0,
  pushedOps: 0,
  chunks: 0,
  skippedPeers: 0,
  pages: 1,
  deposited: 0,
  acked: 0,
  receipts: 0,
  duplicates: 0,
  rejected: 0,
  rejectedReasons: {},
  deferredBlobs: 0,
};

/** Stands in for `getLocalBudgetSession` — always the LIVE handle for that id. */
async function mockLiveHandle(householdId: string): Promise<FakeHandle> {
  const handle = mockHandles.get(householdId);
  if (!handle) throw new Error(`no session for ${householdId}`);
  return handle;
}

const mockGetSession = jest.fn(mockLiveHandle);
const mockNoteRemoteOpsApplied = jest.fn(async () => undefined);
const mockFetchControlPlaneState = jest.fn();
const mockSyncLocalHouseholdToControlPlane = jest.fn(async () => undefined);
/**
 * Every household in this suite is a SHARED one — that is what it is about — so
 * the default is true. The one case that says otherwise sets it per household
 * and asserts the sync never starts.
 */
const mockHouseholdIsOnControlPlane = jest.fn(async (_householdId: string) => true);
const mockPublishBudgetRoster = jest.fn();
const mockSyncBudgetLocalReminders = jest.fn(async () => undefined);
const mockTryAcceptHdkFromMailbox = jest.fn(async () => false);
const mockTryInstallLatestCheckpoint = jest.fn(async () => false);
const mockRunHouseholdBackfill = jest.fn(async () => 'not-needed' as const);
/** Households the durable join marker says still owe a full backfill. */
const mockBootstrapPending = new Set<string>();
const mockMaybePublishCheckpoint = jest.fn(async () => false);
const mockMaybeCompactAfterSync = jest.fn(async () => undefined);
/**
 * ONE stable client object, not a fresh one per call.
 *
 * The factory used to build a new `{ connect, announceSyncAvailable }` on every
 * `getSignalingClient()`, so the only thing assertable was how many times the
 * getter ran — the announcement itself, which peers now act on, was
 * unobservable.
 */
const mockSignalingConnect = jest.fn();
const mockAnnounceSyncAvailable = jest.fn();
const mockGetSignalingClient = jest.fn(() => ({
  connect: mockSignalingConnect,
  announceSyncAvailable: mockAnnounceSyncAvailable,
}));
const mockRecordE2EPersistEntry = jest.fn();

/* -------------------------------------------------------------------------- */
/* Mocks                                                                        */
/* -------------------------------------------------------------------------- */

jest.mock('@symply/local-first', () => {
  const actual = jest.requireActual('@symply/local-first');
  return {
    ...actual,
    // Records what it was constructed with. That record IS the isolation
    // assertion: the household keys and the OpLog it receives are what every
    // outgoing batch is sealed and signed with.
    MailboxSyncEngine: class {
      constructor(options: unknown) {
        mockMailboxes.push(options as MailboxOptions);
      }
      async syncOnce() {
        return mockMailboxResult;
      }
      async pendingOutboundCount() {
        return 0;
      }
    },
  };
});

jest.mock('@api/e2eTestObservability', () => ({
  __esModule: true,
  recordE2EPersistEntry: (...args: unknown[]) => mockRecordE2EPersistEntry(...args),
}));

/**
 * The active-session accessors THROW rather than answer.
 *
 * They are the whole hazard: `getLocalHouseholdKeys()` returns the HDK of the
 * household on screen, so a background run that reaches for it seals household
 * B's ops under household A's key. The orchestrator does not import them today,
 * and the point of a mock that throws is that the day somebody re-adds one, the
 * suite fails here instead of in a member's ledger six weeks later.
 */
jest.mock('../../engine', () => {
  const activeOnly = (name: string) => () => {
    throw new Error(
      `${name}() is an ACTIVE-session accessor — background sync must use getLocalBudgetSession(householdId)`,
    );
  };
  return {
    __esModule: true,
    getActiveBudgetHouseholdId: () => mockActiveHouseholdId,
    isLocalBudgetSessionOpen: () => mockSessionOpen,
    listLocalBudgetHouseholds: () =>
      [...mockHandles.values()].map((handle) => ({
        householdId: handle.householdId,
        deviceId: handle.ledger.deviceId,
        name: handle.ledger.household.name,
        role: 'owner',
        isActive: handle.householdId === mockActiveHouseholdId,
        hydrated: true,
        awaitingEnrolment: handle.awaitingEnrolment,
      })),
    getLocalBudgetSession: (householdId: string) => mockGetSession(householdId),
    getLocalConflictsFor: (householdId: string) => mockConflicts.get(householdId) ?? [],
    noteRemoteOpsApplied: (...args: unknown[]) => mockNoteRemoteOpsApplied(...(args as [])),
    // The backfill marker: false here, so these households take the ordinary
    // path. `newMemberBackfill.test.ts` owns the joiner case.
    isHouseholdBootstrapPending: (householdId: string) =>
      Promise.resolve(mockBootstrapPending.has(householdId)),
    // Runs the work and releases the batch — the coalescing itself is the
    // engine's, and re-implementing it here would test the double rather than
    // the orchestrator's use of it.
    withLedgerBatch: async (_householdId: string | null, work: () => Promise<unknown>) => work(),
    getLocalLedger: activeOnly('getLocalLedger'),
    getLocalOpLog: activeOnly('getLocalOpLog'),
    getLocalHouseholdKeys: activeOnly('getLocalHouseholdKeys'),
    getLocalStore: activeOnly('getLocalStore'),
    getLocalIdentity: activeOnly('getLocalIdentity'),
  };
});

jest.mock('../../controlPlaneClient', () => ({
  __esModule: true,
  fetchControlPlaneState: (...args: unknown[]) => mockFetchControlPlaneState(...args),
  syncLocalHouseholdToControlPlane: (...args: unknown[]) =>
    mockSyncLocalHouseholdToControlPlane(...(args as [])),
  budgetHouseholdIsOnControlPlane: (householdId: string) =>
    mockHouseholdIsOnControlPlane(householdId),
  // The membership check `runBudgetLocalSync` makes before its fan-out reads
  // this marker first, and answering "never registered" is what makes that
  // check a no-op here: this suite is about the fan-out, and a household it
  // removed mid-run would be a household these tests never got to sync.
  // `membershipWatch.test.ts` owns the removal behaviour.
  budgetHouseholdWasRegistered: () => Promise.resolve(false),
}));

jest.mock('../../flag', () => ({
  __esModule: true,
  isBudgetLocalFirst: () => mockLocalFirst,
}));

jest.mock('../../householdRoster', () => ({
  __esModule: true,
  publishBudgetRoster: (...args: unknown[]) => mockPublishBudgetRoster(...args),
}));

jest.mock('../../reminders/budgetLocalReminders', () => ({
  __esModule: true,
  syncBudgetLocalReminders: (...args: unknown[]) => mockSyncBudgetLocalReminders(...(args as [])),
}));

jest.mock('../peerRecovery', () => ({ recoverExistingMemberDevices: jest.fn(async () => 0) }));

jest.mock('../hdkTransfer', () => ({
  __esModule: true,
  tryAcceptHdkFromMailbox: (...args: unknown[]) => mockTryAcceptHdkFromMailbox(...(args as [])),
}));

jest.mock('../checkpoints', () => ({
  __esModule: true,
  tryInstallLatestCheckpoint: (...args: unknown[]) => mockTryInstallLatestCheckpoint(...(args as [])),
  runHouseholdBackfill: (...args: unknown[]) => mockRunHouseholdBackfill(...(args as [])),
  maybePublishCheckpoint: (...args: unknown[]) => mockMaybePublishCheckpoint(...(args as [])),
  maybeCompactAfterSync: (...args: unknown[]) => mockMaybeCompactAfterSync(...(args as [])),
}));

jest.mock('../httpControlPlane', () => ({
  __esModule: true,
  HttpControlPlaneClient: class {},
}));

jest.mock('../signalingClient', () => ({
  __esModule: true,
  getSignalingClient: () => mockGetSignalingClient(),
}));

jest.mock('../webrtcPeer', () => ({
  __esModule: true,
  WebRtcPeerTransport: class {
    static async isAvailable() {
      return false;
    }
  },
}));

import { AppState } from 'react-native';

import type { MailboxSyncResult } from '@symply/local-first';

import type { ControlPlaneState } from '../../controlPlaneClient';
import { runBudgetLocalSync, runBudgetLocalSyncFor } from '../orchestrator';
import { recoverExistingMemberDevices } from '../peerRecovery';
import { useBudgetSyncStatusStore } from '../syncStatusStore';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * One household's slice of the shared SQLite file. A fresh instance per
 * household, so an assertion can say WHICH store the mailbox was handed —
 * identity is the whole point here, not behaviour.
 */
function fakeStore(): FakeStore {
  return {
    // Non-empty: an empty vector means "this device has nothing", which routes
    // to the bootstrap branch. That branch gets its own test.
    getVersionVector: jest.fn(async () => ({ [DEVICE_ID]: 3 })),
    getSyncPeerState: jest.fn(async () => null),
    listOperationsSince: jest.fn(async () => []),
    listOperationsByHlc: jest.fn(async () => []),
  };
}

/**
 * A session handle whose HDK is distinguishable at a glance — `hdk[0]` is the
 * household's marker byte, so an assertion can say "this batch was sealed under
 * A" instead of "the arrays differ".
 */
function handleFor(householdId: string, marker: number, keyEpoch = 1): FakeHandle {
  return {
    householdId,
    ledger: {
      household: { id: householdId, name: `Household ${householdId.slice(-4)}` },
      deviceId: DEVICE_ID,
      memberId: 'usr_ada',
    },
    identity: {
      deviceId: DEVICE_ID,
      signingPublicKey: new Uint8Array(32).fill(0x11),
      agreementPublicKey: new Uint8Array(32).fill(0x22),
    },
    householdKeys: { householdId, hdk: new Uint8Array(32).fill(marker), keyEpoch },
    retiredHouseholdKeys: new Map(),
    opLog: { label: `oplog:${householdId}:${keyEpoch}` },
    store: fakeStore(),
    awaitingEnrolment: false,
  };
}

function controlPlaneState(householdId: string): ControlPlaneState {
  return {
    householdId,
    keyEpoch: 1,
    securityRevision: 1,
    members: [],
    devices: [
      { deviceId: DEVICE_ID, status: 'active', signingPublicKey: '11'.repeat(32) },
      { deviceId: PEER_DEVICE_ID, status: 'active', signingPublicKey: 'aa'.repeat(32) },
    ],
  } as unknown as ControlPlaneState;
}

/** Every mailbox built for one household, in construction order. */
function mailboxesFor(householdId: string): MailboxOptions[] {
  return mockMailboxes.filter((options) => options.householdKeys.householdId === householdId);
}

beforeEach(() => {
  mockAuthUserId = 'usr_ada';
  AppState.currentState = 'active';
  // `clearAllMocks` clears CALLS, not implementations, so every mock a test
  // re-implements has to be put back by hand or it leaks into the next one.
  jest.clearAllMocks();
  mockGetSession.mockImplementation(mockLiveHandle);
  mockTryAcceptHdkFromMailbox.mockImplementation(async () => false);
  mockHouseholdIsOnControlPlane.mockImplementation(async () => true);
  mockRunHouseholdBackfill.mockImplementation(async () => 'not-needed' as const);
  mockHandles.clear();
  mockMailboxes.length = 0;
  mockConflicts.clear();
  mockBootstrapPending.clear();
  mockActiveHouseholdId = HH_A;
  mockSessionOpen = true;
  mockLocalFirst = true;
  mockMailboxResult = {
    applied: 0,
    pushedOps: 0,
    chunks: 0,
    skippedPeers: 0,
    pages: 1,
    deposited: 0,
    acked: 0,
    receipts: 0,
    duplicates: 0,
    rejected: 0,
    rejectedReasons: {},
    deferredBlobs: 0,
  };
  mockHandles.set(HH_A, handleFor(HH_A, 0xaa));
  mockHandles.set(HH_B, handleFor(HH_B, 0xbb));
  mockFetchControlPlaneState.mockImplementation(async (householdId: string) =>
    controlPlaneState(householdId),
  );
  useBudgetSyncStatusStore.getState().reset();
});

/* -------------------------------------------------------------------------- */

describe('a run is bound to its household, never to the active session', () => {
  /**
   * The headline of B3. Household A is on screen; household B syncs in the
   * background. Every value the mailbox engine seals and signs with must come
   * from B's handle.
   */
  it('seals a background household under ITS OWN key while another is active', async () => {
    mockHandles.set(HH_C, handleFor(HH_C, 0xcc));
    expect(mockActiveHouseholdId).toBe(HH_A);

    await runBudgetLocalSyncFor(HH_B);

    const [mailbox] = mailboxesFor(HH_B);
    expect(mailbox).toBeDefined();
    expect(mailbox!.householdKeys.householdId).toBe(HH_B);
    expect(mailbox!.householdKeys.hdk[0]).toBe(0xbb);
    // The concrete cross-contamination: A's HDK on B's batch.
    expect(mailbox!.householdKeys.hdk[0]).not.toBe(0xaa);
    expect(mailbox!.opLog).toBe(mockHandles.get(HH_B)!.opLog);
    expect(mailbox!.store).toBe(mockHandles.get(HH_B)!.store);
    // Nothing was built for the household that merely happened to be active.
    expect(mailboxesFor(HH_A)).toHaveLength(0);
  });

  it('asks the engine for the named household, not for whatever is open', async () => {
    await runBudgetLocalSyncFor(HH_B);

    expect(mockGetSession).toHaveBeenCalledWith(HH_B);
    expect(mockGetSession).not.toHaveBeenCalledWith(HH_A);
  });

  /**
   * Accepting an HDK wrap swaps BOTH the household keys and the OpLog instance,
   * so the handle read before enrolment is stale. A run that kept it would seal
   * this round's batches under the pre-join key and every op from the household
   * would be rejected until the next sync.
   *
   * The rotation is staged on the ACCESSOR rather than driven through
   * `tryAcceptHdkFromMailbox`, because the orchestrator reaches that helper
   * through `await import('./hdkTransfer')` and Jest's CJS runtime cannot serve
   * a dynamic import (`A dynamic import callback was invoked without
   * --experimental-vm-modules`) — the orchestrator's own try/catch swallows it,
   * so an enrolment driven from here would silently never happen and the test
   * would assert nothing. What is under test is the same thing either way: the
   * handle the mailbox is built from must be the one read AFTER the enrolment
   * step, not the one read before it.
   */
  it('re-reads the handle after enrolment, so a rotation lands on this round', async () => {
    const stale = { ...handleFor(HH_B, 0xb0), awaitingEnrolment: true };
    mockGetSession.mockImplementationOnce(async () => stale);
    // What installHouseholdKeys leaves behind: new key, new epoch, new OpLog.
    mockHandles.set(HH_B, handleFor(HH_B, 0xbb, 2));

    await runBudgetLocalSyncFor(HH_B);

    expect(mockGetSession).toHaveBeenCalledTimes(2);
    const [mailbox] = mailboxesFor(HH_B);
    expect(mailbox!.householdKeys.keyEpoch).toBe(2);
    expect(mailbox!.householdKeys.hdk[0]).toBe(0xbb);
    expect(mailbox!.opLog).toEqual({ label: `oplog:${HH_B}:2` });
    // The pre-enrolment handle was read and then correctly discarded.
    expect(mailbox!.opLog).not.toBe(stale.opLog);
  });

  /**
   * `noteRemoteOpsApplied` persists the merged snapshot. Without the household
   * id it drains the ACTIVE session's pending deltas and writes B's rows into A
   * — correctly encrypted, wrong household (plan §2 hazard 3).
   */
  it('persists merged remote ops against the household they came from', async () => {
    mockMailboxResult = { ...mockMailboxResult, applied: 2 };
    const fresh = [{ opId: 'op-1' }, { opId: 'op-2' }];
    mockHandles.get(HH_B)!.store.listOperationsSince.mockResolvedValue(fresh);

    await runBudgetLocalSyncFor(HH_B);

    expect(mockNoteRemoteOpsApplied).toHaveBeenCalledWith(fresh, HH_B);
  });

  it('skips the persist entirely when nothing arrived', async () => {
    await runBudgetLocalSyncFor(HH_B);
    expect(mockNoteRemoteOpsApplied).not.toHaveBeenCalled();
  });

  it('bootstraps a checkpoint for the household that has nothing, not for the active one', async () => {
    mockHandles.get(HH_B)!.store.getVersionVector.mockResolvedValue({});

    await runBudgetLocalSyncFor(HH_B);

    // The third argument is the progress-reporting hook. Matched loosely because
    // the assertion is about WHICH household is bootstrapped — the hook's
    // behaviour belongs to `newMemberBackfill.test.ts`.
    expect(mockTryInstallLatestCheckpoint).toHaveBeenCalledWith(
      'bootstrap',
      HH_B,
      expect.anything(),
    );
  });

  /**
   * The joiner's guarantee, at the orchestrator's level: a household the durable
   * marker says is still owed its history gets a backfill attempt on EVERY pass,
   * whatever its version vector says.
   *
   * The vector here names an author, which under the old gate meant the single
   * bootstrap window had closed — the exact state a joiner reaches after merging
   * one live op, and the state that used to leave it holding the current month
   * and nothing before it.
   */
  it('retries the backfill for a joined household whose vector is no longer empty', async () => {
    mockBootstrapPending.add(HH_B);
    mockHandles.get(HH_B)!.store.getVersionVector.mockResolvedValue({ dev_peer: 3 });

    await runBudgetLocalSyncFor(HH_B);

    expect(mockRunHouseholdBackfill).toHaveBeenCalledWith(HH_B, expect.anything());
  });

  it('leaves a household that owes nothing alone', async () => {
    // A household this device minted: no marker, a populated vector. Downloading
    // and installing a snapshot over its own origin would be pure waste.
    mockHandles.get(HH_B)!.store.getVersionVector.mockResolvedValue({ dev_peer: 3 });

    await runBudgetLocalSyncFor(HH_B);

    expect(mockRunHouseholdBackfill).not.toHaveBeenCalled();
    expect(mockTryInstallLatestCheckpoint).not.toHaveBeenCalledWith(
      'bootstrap',
      HH_B,
      expect.anything(),
    );
  });
});

describe('single-flight is per household', () => {
  /**
   * Plan §2 hazard 7. One global promise meant a household that could not reach
   * the control plane held every other household's sync behind it — and the
   * caller was handed the hung run's promise, so it believed it had synced.
   */
  it('does not let an unreachable household block another', async () => {
    const hung = deferred<ControlPlaneState>();
    mockFetchControlPlaneState.mockImplementation(async (householdId: string) =>
      householdId === HH_A ? hung.promise : controlPlaneState(householdId),
    );

    const fanOut = runBudgetLocalSync();
    // A is still waiting on the control plane; B must complete regardless.
    await runBudgetLocalSyncFor(HH_B);

    expect(mailboxesFor(HH_B)).toHaveLength(1);
    expect(mailboxesFor(HH_A)).toHaveLength(0);

    hung.resolve(controlPlaneState(HH_A));
    await fanOut;
    expect(mailboxesFor(HH_A)).toHaveLength(1);
  });

  it('joins the run already in flight for the same household', async () => {
    const gate = deferred<void>();
    mockFetchControlPlaneState.mockImplementation(async (householdId: string) => {
      await gate.promise;
      return controlPlaneState(householdId);
    });

    const first = runBudgetLocalSyncFor(HH_B);
    const second = runBudgetLocalSyncFor(HH_B);
    gate.resolve();
    await Promise.all([first, second]);

    // Two callers, one round trip — not two mailboxes racing the same log.
    expect(mailboxesFor(HH_B)).toHaveLength(1);
  });

  it('releases the slot when the run ends, so the next sync is a real one', async () => {
    await runBudgetLocalSyncFor(HH_B);
    await runBudgetLocalSyncFor(HH_B);
    expect(mailboxesFor(HH_B)).toHaveLength(2);
  });

  it('releases the slot after a FAILED run', async () => {
    mockFetchControlPlaneState.mockRejectedValueOnce(new Error('boom'));
    await runBudgetLocalSyncFor(HH_B);
    expect(mailboxesFor(HH_B)).toHaveLength(0);

    await runBudgetLocalSyncFor(HH_B);
    expect(mailboxesFor(HH_B)).toHaveLength(1);
  });
});

describe('fan-out covers every household this device holds', () => {
  it('syncs all of them, each against its own household id', async () => {
    mockHandles.set(HH_C, handleFor(HH_C, 0xcc));

    await runBudgetLocalSync();

    expect(mockFetchControlPlaneState.mock.calls.map(([id]) => id).sort()).toEqual(
      [HH_A, HH_B, HH_C].sort(),
    );
    expect(mockMailboxes.map((m) => m.householdKeys.householdId).sort()).toEqual(
      [HH_A, HH_B, HH_C].sort(),
    );
    // Distinct keys, one per household — the map is not one HDK reused.
    expect(new Set(mockMailboxes.map((m) => m.householdKeys.hdk[0])).size).toBe(3);
  });

  /** `Promise.allSettled`: one household's failure must not abort the rest. */
  it('cancels before transferring data if the account changes during discovery', async () => {
    mockFetchControlPlaneState.mockImplementationOnce(async () => {
      mockAuthUserId = 'other-account';
      return controlPlaneState(HH_A);
    });
    await runBudgetLocalSyncFor(HH_A, 'account-change');
    expect(mailboxesFor(HH_A)).toHaveLength(0);
  });

  it('does not report success or advance the success timestamp with deferred messages', async () => {
    mockMailboxResult = {...mockMailboxResult, deferredBlobs: 1};
    await runBudgetLocalSyncFor(HH_A, 'partial-delivery');
    expect(useBudgetSyncStatusStore.getState().phase).toBe('error');
    expect(useBudgetSyncStatusStore.getState().lastSyncedAt).toBeNull();
  });

  it('finishes the other households when one throws', async () => {
    mockHandles.set(HH_C, handleFor(HH_C, 0xcc));
    mockFetchControlPlaneState.mockImplementation(async (householdId: string) => {
      if (householdId === HH_A) throw new Error('control plane down');
      return controlPlaneState(householdId);
    });

    await expect(runBudgetLocalSync()).resolves.toBeUndefined();

    expect(mailboxesFor(HH_B)).toHaveLength(1);
    expect(mailboxesFor(HH_C)).toHaveLength(1);
  });

  /**
   * The reminders pass cancels Budget notifications by prefix and rebuilds them
   * wholesale, so N concurrent passes do the same work N times and interleave
   * over the notification centre for nothing.
   */
  it('tops reminders up once per invocation, not once per household', async () => {
    mockHandles.set(HH_C, handleFor(HH_C, 0xcc));
    await runBudgetLocalSync();
    expect(mockSyncBudgetLocalReminders).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when no session is open', async () => {
    mockSessionOpen = false;
    await runBudgetLocalSync();
    await runBudgetLocalSyncFor(HH_B);
    expect(mockFetchControlPlaneState).not.toHaveBeenCalled();
  });

  it('does nothing on a server-backed build', async () => {
    mockLocalFirst = false;
    await runBudgetLocalSync();
    expect(mockFetchControlPlaneState).not.toHaveBeenCalled();
  });

  /**
   * A household nobody else can reach is not synced, and — the part that
   * matters — is not REGISTERED either. `resolvePeers` recovers from a 403 by
   * registering and retrying, so without this skip the very first tick after a
   * reinstall would re-create on the server the solo household that is supposed
   * to stay on the phone. That recovery is how production collected 13 orphan
   * `hh_local_*` rows.
   */
  it('skips a household the control plane does not hold, without registering it', async () => {
    mockHouseholdIsOnControlPlane.mockImplementation(async (householdId) => householdId !== HH_B);

    await runBudgetLocalSync();

    expect(mockFetchControlPlaneState.mock.calls.map(([id]) => id)).toEqual([HH_A]);
    expect(mailboxesFor(HH_B)).toHaveLength(0);
    expect(mockSyncLocalHouseholdToControlPlane).not.toHaveBeenCalled();
  });
});

describe('single-household surfaces stay the ACTIVE household’s', () => {
  it('never paints a background household’s failure over the banner', async () => {
    mockFetchControlPlaneState.mockImplementation(async (householdId: string) => {
      if (householdId === HH_B) throw new Error('B is unreachable');
      return controlPlaneState(householdId);
    });

    await runBudgetLocalSync();

    // A — the household on screen — succeeded, and that is what the banner says.
    const status = useBudgetSyncStatusStore.getState();
    expect(status.phase).toBe('ok');
    expect(status.lastError).toBeNull();
    expect(status.lastErrorCode).toBeNull();
  });

  it('reports the ACTIVE household’s failure, because that one is on screen', async () => {
    mockFetchControlPlaneState.mockImplementation(async (householdId: string) => {
      if (householdId === HH_A) throw new Error('A is unreachable');
      return controlPlaneState(householdId);
    });

    await runBudgetLocalSync();

    // An unreachable control plane is 'offline', not 'error' — the distinction
    // is load-bearing for the copy, so assert the code and not just "it failed".
    const status = useBudgetSyncStatusStore.getState();
    expect(status.phase).toBe('offline');
    expect(status.lastError).toBe('control_plane_unreachable');
  });

  it('surfaces a genuine failure on the ACTIVE household as an error', async () => {
    mockGetSession.mockImplementation(async (householdId: string) => {
      if (householdId === HH_A) throw new Error('ledger is locked');
      const handle = mockHandles.get(householdId);
      if (!handle) throw new Error(`no session for ${householdId}`);
      return handle;
    });

    await runBudgetLocalSync();

    const status = useBudgetSyncStatusStore.getState();
    expect(status.phase).toBe('error');
    expect(status.lastError).toBe('ledger is locked');
  });

  it('does not report a background household’s conflict count', async () => {
    mockConflicts.set(HH_B, [{ id: 'c1' }, { id: 'c2' }]);
    mockActiveHouseholdId = HH_A;

    await runBudgetLocalSyncFor(HH_B);

    expect(useBudgetSyncStatusStore.getState().conflicts).toBe(0);
  });

  /**
   * `householdStore` holds ONE member list. A background household publishing
   * into it blanks the names on the screen the member is actually looking at.
   */
  it('publishes a roster only for the household on screen', async () => {
    await runBudgetLocalSync();

    expect(mockPublishBudgetRoster).toHaveBeenCalledTimes(1);
    const [published] = mockPublishBudgetRoster.mock.calls[0] as [ControlPlaneState];
    expect(published.householdId).toBe(HH_A);
  });

  /**
   * One module-global signaling socket cannot represent N households — `connect()`
   * tears down the previous socket, so a fan-out would leave the survivor
   * offering one household's ops into another household's coordinator room.
   * Background households take the mailbox path only, by design.
   */
  it('offers the WebRTC upgrade to the active household alone', async () => {
    await runBudgetLocalSyncFor(HH_B);
    expect(mockGetSignalingClient).not.toHaveBeenCalled();

    await runBudgetLocalSyncFor(HH_A);
    expect(mockGetSignalingClient).toHaveBeenCalledTimes(1);
  });

  /**
   * The announcement is what makes a peer's screen update while the author is
   * still looking at theirs — and, now that peers ACT on it, it is also how a
   * quiet household could spin for ever.
   *
   * The coordinator fans `sync_available` out to every other device. Announcing
   * unconditionally would mean: A announces → B syncs → B announces → A syncs →
   * A announces, with nobody writing anything. Gating on a deposit terminates it
   * after one hop, because the peer that only RECEIVED has nothing to deposit
   * and so says nothing back.
   */
  it('says nothing when the run deposited nothing', async () => {
    await runBudgetLocalSyncFor(HH_A);

    expect(mockSignalingConnect).toHaveBeenCalled();
    expect(mockAnnounceSyncAvailable).not.toHaveBeenCalled();
  });

  it('announces when the run left ops for a peer to collect', async () => {
    mockMailboxResult = { ...mockMailboxResult, deposited: 1 };

    await runBudgetLocalSyncFor(HH_A);

    expect(mockAnnounceSyncAvailable).toHaveBeenCalledTimes(1);
  });
});


it('uses the mailbox without opening WebRTC while Budget is in the background', async () => {
  AppState.currentState = 'background';
  await runBudgetLocalSyncFor(HH_A, 'background-wake');
  expect(mailboxesFor(HH_A)).toHaveLength(1);
  expect(mockSignalingConnect).not.toHaveBeenCalled();
  expect(recoverExistingMemberDevices).toHaveBeenCalledWith(expect.objectContaining({ householdId: HH_A }));
});
