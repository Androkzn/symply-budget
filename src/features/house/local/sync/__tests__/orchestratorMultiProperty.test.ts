/**
 * Sync is per PROPERTY, and every run is bound to its own session handle.
 *
 * All of the failures this guards are silent. Nothing throws when a background
 * home's batch is sealed under the foreground home's HDK: the ops are correctly
 * encrypted, correctly signed, and land in a mailbox whose peers cannot open
 * them — invisible until the two homes diverge and somebody asks why B never
 * syncs. Nothing throws when a global single-flight hands home B the promise of
 * home A's hung run either; B simply never syncs and reports that it did. And
 * nothing throws when a background home writes its result onto the status
 * banner — it just paints an error over a screen that is working fine.
 *
 * This became load-bearing rather than theoretical the day joining started
 * ADDING a home instead of replacing one: every member who accepts an invite now
 * holds at least two.
 *
 * So the assertions are about WHICH home's material reached the mailbox, not
 * about whether a sync "succeeded".
 */
/* -------------------------------------------------------------------------- */
/* Fixtures the mock factories close over. Declared before the mocks, which     */
/* read them only at call time — after the module body has run.                */
/* -------------------------------------------------------------------------- */

const DEVICE_ID = 'dev_this_device';
const PEER_DEVICE_ID = 'dev_peer';
const HH_A = 'hh_local_aaaa';
const HH_B = 'hh_local_bbbb';

type FakeStore = {
  getVersionVector: jest.Mock;
  getSyncPeerState: jest.Mock;
  listOperationsSince: jest.Mock;
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
  /** The READ-side key ring — every epoch this device can still open a batch with. */
  retiredHdks?: ReadonlyMap<number, Uint8Array>;
  deviceId: string;
  peerDeviceIds?: string[];
  control: { boundHouseholdId?: string };
};

const mockHandles = new Map<string, FakeHandle>();
const mockMailboxes: MailboxOptions[] = [];
const mockConflicts = new Map<string, unknown[]>();
/** Which property each constructed transport client was bound to. */
const mockTransportBindings: Array<string | undefined> = [];

let mockActiveHouseholdId: string | null = HH_A;
let mockSessionOpen = true;
let mockLocalFirst = true;
let mockSyncOnce: () => Promise<unknown> = async () => ({
  applied: 0,
  pushedOps: 0,
  chunks: 0,
  skippedPeers: 0,
  pages: 1,
  deposited: 0,
  acked: 0,
});

async function mockLiveHandle(householdId: string): Promise<FakeHandle> {
  const handle = mockHandles.get(householdId);
  if (!handle) throw new Error(`no session for ${householdId}`);
  return handle;
}

const mockGetSession = jest.fn(mockLiveHandle);
const mockFetchControlPlaneState = jest.fn();
const mockSyncLocalHouseholdToControlPlane = jest.fn(async () => undefined);
const mockHouseholdIsOnControlPlane = jest.fn(async (_householdId: string) => true);
const mockPublishHouseRoster = jest.fn(() => []);
const mockNoteRemoteOpsApplied = jest.fn(async () => undefined);
const mockTryAcceptHdkFromMailbox = jest.fn(async () => false);
const mockTryInstallLatestCheckpoint = jest.fn(async () => false);
const mockRunHouseholdBackfill = jest.fn(async () => 'not-needed' as const);
/** Properties the durable join marker says still owe a full backfill. */
const mockBootstrapPending = new Set<string>();
const mockMaybePublishCheckpoint = jest.fn(async () => false);
const mockMaybeCompactAfterSync = jest.fn(async () => undefined);
const mockSyncHouseLocalReminders = jest.fn(async () => undefined);
const mockPurgeRevokedHouseProperties = jest.fn(async () => []);
/**
 * ONE stable client object, not a fresh one per call — the announcement is what
 * peers now act on, so it has to be observable rather than swallowed by a
 * per-call double.
 */
const mockSignalingConnect = jest.fn(() => true);
const mockAnnounceSyncAvailable = jest.fn();

/* -------------------------------------------------------------------------- */
/* Mocks                                                                       */
/* -------------------------------------------------------------------------- */

jest.mock('@symply/local-first', () => {
  const actual = jest.requireActual('@symply/local-first');
  return {
    ...actual,
    // Records what it was constructed with. That record IS the isolation
    // assertion: the home keys and the OpLog it receives are what every
    // outgoing batch is sealed and signed with.
    MailboxSyncEngine: class {
      constructor(options: unknown) {
        mockMailboxes.push(options as MailboxOptions);
      }
      async syncOnce() {
        return mockSyncOnce();
      }
      async pendingOutboundCount() {
        return 0;
      }
    },
  };
});

jest.mock('@api/e2eTestObservability', () => ({
  __esModule: true,
  recordE2EPersistEntry: jest.fn(),
}));

/**
 * The active-session accessors THROW rather than answer.
 *
 * They are the whole hazard: `getLocalHouseholdKeys()` returns the HDK of the
 * home on screen, so a background run that reaches for one seals home B's ops
 * under home A's key. The orchestrator does not import them today, and the point
 * of a mock that throws is that the day somebody re-adds one, the suite fails
 * here instead of in a member's ledger six weeks later.
 */
jest.mock('../../engine', () => {
  const activeOnly = (name: string) => () => {
    throw new Error(
      `${name}() is an ACTIVE-session accessor — background sync must use getLocalHouseSession(householdId)`,
    );
  };
  return {
    __esModule: true,
    getActiveHouseholdId: () => mockActiveHouseholdId,
    isLocalHouseSessionOpen: () => mockSessionOpen,
    listLocalHouseProperties: () =>
      [...mockHandles.values()].map((handle) => ({
        householdId: handle.householdId,
        deviceId: handle.ledger.deviceId,
        name: handle.ledger.household.name,
        role: 'owner',
        isActive: handle.householdId === mockActiveHouseholdId,
        hydrated: true,
        awaitingEnrolment: handle.awaitingEnrolment,
      })),
    getLocalHouseSession: (householdId: string) => mockGetSession(householdId),
    getLocalHouseConflictsFor: (householdId: string) => mockConflicts.get(householdId) ?? [],
    noteRemoteHouseOpsApplied: (...args: unknown[]) => mockNoteRemoteOpsApplied(...(args as [])),
    // The backfill marker: false here, so these properties take the ordinary
    // path. `newMemberBackfill.test.ts` owns the joiner case.
    isHouseholdBootstrapPending: (householdId: string) =>
      Promise.resolve(mockBootstrapPending.has(householdId)),
    // Runs the work and releases the batch — the coalescing itself is the
    // engine's, and re-implementing it here would test the double rather than
    // the orchestrator's use of it.
    withLedgerBatch: async (_householdId: string | null, work: () => Promise<unknown>) => work(),
    getLocalHouseLedger: activeOnly('getLocalHouseLedger'),
    getLocalHouseOpLog: activeOnly('getLocalHouseOpLog'),
    getLocalHouseholdKeys: activeOnly('getLocalHouseholdKeys'),
    getLocalHouseStore: activeOnly('getLocalHouseStore'),
    getLocalHouseIdentity: activeOnly('getLocalHouseIdentity'),
  };
});

jest.mock('../../controlPlaneClient', () => ({
  __esModule: true,
  fetchControlPlaneState: (...args: unknown[]) => mockFetchControlPlaneState(...args),
  syncLocalHouseholdToControlPlane: (...args: unknown[]) =>
    mockSyncLocalHouseholdToControlPlane(...(args as [])),
  // The gate that keeps a PRIVATE home off the control plane: a property with
  // no row there has no peers to poll and no mailbox to drain, and running the
  // round anyway would walk into `resolvePeers`'s 403 recovery and re-create
  // the very row that is not supposed to exist. Every property in this suite is
  // shared, so the default is true; `sync/skip` has its own test below.
  houseHouseholdIsOnControlPlane: (...args: unknown[]) =>
    mockHouseholdIsOnControlPlane(...(args as [string])),
}));

/**
 * The roster publish is a DISPLAY concern riding on the sync's control-plane
 * trip. Doubled so this suite can assert it is scoped to the active property
 * without pulling in the household store the real module writes to.
 */
jest.mock('../../householdRoster', () => ({
  __esModule: true,
  publishHouseRoster: (...args: unknown[]) => mockPublishHouseRoster(...(args as [])),
}));

jest.mock('../../flag', () => ({
  __esModule: true,
  isHouseLocalFirst: () => mockLocalFirst,
}));

jest.mock('../../reminders/houseLocalReminders', () => ({
  __esModule: true,
  syncHouseLocalReminders: (...args: unknown[]) => mockSyncHouseLocalReminders(...(args as [])),
}));

jest.mock('../hdkTransfer', () => ({
  __esModule: true,
  tryAcceptHdkFromMailbox: (...args: unknown[]) => mockTryAcceptHdkFromMailbox(...(args as [])),
}));

jest.mock('../checkpoints', () => ({
  __esModule: true,
  tryInstallLatestCheckpoint: (...args: unknown[]) =>
    mockTryInstallLatestCheckpoint(...(args as [])),
  runHouseholdBackfill: (...args: unknown[]) => mockRunHouseholdBackfill(...(args as [])),
  maybePublishCheckpoint: (...args: unknown[]) => mockMaybePublishCheckpoint(...(args as [])),
  maybeCompactAfterSync: (...args: unknown[]) => mockMaybeCompactAfterSync(...(args as [])),
}));

/**
 * The membership check `runHouseLocalSync` makes before its fan-out.
 *
 * Doubled rather than left real: this suite is about the fan-out, and a property
 * the check removed mid-run would be a property these tests never got to sync.
 * The real module also reads the ACTIVE ledger to confirm the account matches,
 * which the engine double above deliberately makes throw — letting it run here
 * would swallow that throw and hide the very guard the double exists for.
 * `membershipWatch.test.ts` owns the removal behaviour.
 */
jest.mock('../../membershipWatch', () => ({
  __esModule: true,
  purgeRevokedHouseProperties: (...args: unknown[]) =>
    mockPurgeRevokedHouseProperties(...(args as [])),
}));

jest.mock('../signalingClient', () => ({
  __esModule: true,
  getHouseSignalingClient: () => ({
    connect: mockSignalingConnect,
    announceSyncAvailable: mockAnnounceSyncAvailable,
  }),
}));

// The transport client records ONLY its binding — which property it will
// address — because that is the fact this suite is about.
jest.mock('../httpControlPlane', () => ({
  __esModule: true,
  HttpControlPlaneClient: class {
    // A plain parameter, not a TypeScript parameter property: the field
    // shorthand reads as an out-of-scope identifier to jest's module-factory
    // guard, which refuses anything not prefixed `mock`.
    constructor(householdId?: string) {
      mockTransportBindings.push(householdId);
    }
  },
}));

import { runHouseLocalSync, runHouseLocalSyncFor } from '../orchestrator';
import { useHouseSyncStatusStore } from '../syncStatusStore';

/* -------------------------------------------------------------------------- */

function handle(householdId: string, overrides?: Partial<FakeHandle>): FakeHandle {
  return {
    householdId,
    ledger: {
      household: { id: householdId, name: `Home ${householdId.slice(-4)}` },
      deviceId: DEVICE_ID,
      memberId: 'member-1',
    },
    identity: {
      deviceId: DEVICE_ID,
      signingPublicKey: new Uint8Array([1, 2, 3]),
      agreementPublicKey: new Uint8Array([4, 5, 6]),
    },
    // The bytes differ per home — that is what makes "which key sealed this"
    // an assertable fact rather than a hope.
    householdKeys: {
      householdId,
      hdk: new Uint8Array(32).fill(householdId === HH_A ? 0xaa : 0xbb),
      keyEpoch: 1,
    },
    retiredHouseholdKeys: new Map(),
    opLog: { label: `oplog:${householdId}` },
    store: {
      getVersionVector: jest.fn(async () => ({ [DEVICE_ID]: 1 })),
      getSyncPeerState: jest.fn(async () => null),
      listOperationsSince: jest.fn(async () => []),
    },
    awaitingEnrolment: false,
    ...overrides,
  };
}

function controlPlaneState(householdId: string) {
  return {
    householdId,
    keyEpoch: 1,
    securityRevision: 1,
    members: [],
    devices: [
      {
        deviceId: DEVICE_ID,
        userId: 'u1',
        signingPublicKey: '01',
        agreementPublicKey: '02',
        status: 'active',
      },
      {
        deviceId: PEER_DEVICE_ID,
        userId: 'u2',
        signingPublicKey: '03',
        agreementPublicKey: '04',
        status: 'active',
      },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHandles.clear();
  mockMailboxes.length = 0;
  mockTransportBindings.length = 0;
  mockConflicts.clear();
  mockBootstrapPending.clear();
  mockRunHouseholdBackfill.mockImplementation(async () => 'not-needed' as const);
  mockPurgeRevokedHouseProperties.mockImplementation(async () => []);
  mockHouseholdIsOnControlPlane.mockImplementation(async () => true);
  mockPublishHouseRoster.mockImplementation(() => []);
  mockSignalingConnect.mockImplementation(() => true);
  mockActiveHouseholdId = HH_A;
  mockSessionOpen = true;
  mockLocalFirst = true;
  mockSyncOnce = async () => ({
    applied: 0,
    pushedOps: 0,
    chunks: 0,
    skippedPeers: 0,
    pages: 1,
    deposited: 0,
    acked: 0,
  });
  mockHandles.set(HH_A, handle(HH_A));
  mockHandles.set(HH_B, handle(HH_B));
  mockFetchControlPlaneState.mockImplementation(async (id: string) => controlPlaneState(id));
  useHouseSyncStatusStore.setState({
    phase: 'idle',
    lastError: null,
    lastErrorCode: null,
    // Reset explicitly: the store is module state shared by every test in this
    // file, so a run that sets this would otherwise hand its verdict to the next
    // test and make an assertion pass for the wrong reason.
    enrolmentUnreachable: false,
  });
});

describe('every open property syncs, each under its own key', () => {
  it('fans out over all of them, not just the one on screen', async () => {
    await runHouseLocalSync();

    expect(mockMailboxes.map((m) => m.householdKeys.householdId).sort()).toEqual(
      [HH_A, HH_B].sort(),
    );
  });

  it('seals each batch with the KEY of the property it is for', async () => {
    await runHouseLocalSync();

    const byHousehold = new Map(mockMailboxes.map((m) => [m.householdKeys.householdId, m]));
    expect(byHousehold.get(HH_A)!.householdKeys.hdk[0]).toBe(0xaa);
    expect(byHousehold.get(HH_B)!.householdKeys.hdk[0]).toBe(0xbb);
    // …and the OpLog with it: the two travel together, and a batch signed by
    // one home's log under another's key opens for nobody.
    expect(byHousehold.get(HH_B)!.opLog.label).toBe(`oplog:${HH_B}`);
  });

  it('binds the mailbox transport to the property the run is for', async () => {
    // Unbound, every mailbox call resolves against "whatever is active": a
    // background run for B then fetches A's mail under B's cursor and deposits
    // B's ops — sealed with B's HDK — into A's mailbox.
    await runHouseLocalSync();

    expect(mockTransportBindings.sort()).toEqual([HH_A, HH_B].sort());
  });

  it('re-reads the session AFTER enrolment, because installing a key swaps it', async () => {
    // Installing the HDK replaces both the home keys and the OpLog instance, so
    // a handle captured before that step would seal this run's batches under the
    // pre-join key and every op would be rejected.
    mockTryAcceptHdkFromMailbox.mockResolvedValue(true);

    await runHouseLocalSyncFor(HH_A);

    const calls = mockGetSession.mock.calls.map(([id]) => id);
    expect(calls.filter((id) => id === HH_A).length).toBeGreaterThanOrEqual(2);
  });

  it('bootstraps an EMPTY property from its own checkpoint, named', async () => {
    // A device with no version vector for a home has just been let into it, and
    // the checkpoint is the only thing that makes it usable in one round trip —
    // replaying the log is not viable at House's op rate. Asking for the wrong
    // home's snapshot would install another home's rows under this one's id.
    mockActiveHouseholdId = HH_A;
    mockHandles.set(
      HH_B,
      handle(HH_B, {
        store: {
          getVersionVector: jest.fn(async () => ({})),
          getSyncPeerState: jest.fn(async () => null),
          listOperationsSince: jest.fn(async () => []),
        },
      }),
    );

    await runHouseLocalSyncFor(HH_B);

    // The third argument is the progress-reporting hook. Matched loosely because
    // the assertion is about WHICH property is bootstrapped — the hook's
    // behaviour belongs to `newMemberBackfill.test.ts`.
    expect(mockTryInstallLatestCheckpoint).toHaveBeenCalledWith(
      'bootstrap',
      HH_B,
      expect.anything(),
    );
  });

  /**
   * The joiner's guarantee, at the orchestrator's level: a property the durable
   * marker says is still owed its history gets a backfill attempt on EVERY pass,
   * whatever its version vector says.
   *
   * The vector here names an author, which under the old gate meant the single
   * bootstrap window had closed — the exact state a joiner reaches after merging
   * one live op, and the state that used to leave it holding whatever happened
   * since the join and nothing before it.
   */
  it('retries the backfill for a joined property whose vector is no longer empty', async () => {
    mockBootstrapPending.add(HH_B);
    mockHandles.set(
      HH_B,
      handle(HH_B, {
        store: {
          getVersionVector: jest.fn(async () => ({ dev_peer: 3 })),
          getSyncPeerState: jest.fn(async () => null),
          listOperationsSince: jest.fn(async () => []),
        },
      }),
    );

    await runHouseLocalSyncFor(HH_B);

    expect(mockRunHouseholdBackfill).toHaveBeenCalledWith(HH_B, expect.anything());
  });

  it('leaves a property that owes nothing alone', async () => {
    // A property this device minted: no marker, a populated vector. Downloading
    // and installing a snapshot over its own origin would be pure waste.
    mockHandles.set(
      HH_B,
      handle(HH_B, {
        store: {
          getVersionVector: jest.fn(async () => ({ dev_peer: 3 })),
          getSyncPeerState: jest.fn(async () => null),
          listOperationsSince: jest.fn(async () => []),
        },
      }),
    );

    await runHouseLocalSyncFor(HH_B);

    expect(mockRunHouseholdBackfill).not.toHaveBeenCalled();
    expect(mockTryInstallLatestCheckpoint).not.toHaveBeenCalledWith(
      'bootstrap',
      HH_B,
      expect.anything(),
    );
  });

  // The enrolment step itself — `tryAcceptHdkFromMailbox(householdId)` — is
  // reached through a DYNAMIC import (to break a module cycle), which Jest
  // cannot service here, and the orchestrator swallows that in its own
  // best-effort try/catch. Its property scoping is pinned directly instead, in
  // `hdkTransfer.test.ts`.
});

describe('single-flight is per property', () => {
  it('lets a second property sync while the first is still in flight', async () => {
    // A global guard hands B the promise of A's hung run: B never syncs, and
    // reports that it did.
    let releaseA: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    mockSyncOnce = async () => {
      await gate;
      return { applied: 0, pushedOps: 0, chunks: 0, skippedPeers: 0, pages: 1, deposited: 0, acked: 0 };
    };

    const runA = runHouseLocalSyncFor(HH_A);
    const runB = runHouseLocalSyncFor(HH_B);
    releaseA();
    await Promise.all([runA, runB]);

    expect(mockMailboxes.map((m) => m.householdKeys.householdId).sort()).toEqual(
      [HH_A, HH_B].sort(),
    );
  });

  it('de-duplicates two concurrent runs of the SAME property', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockSyncOnce = async () => {
      await gate;
      return { applied: 0, pushedOps: 0, chunks: 0, skippedPeers: 0, pages: 1, deposited: 0, acked: 0 };
    };

    const first = runHouseLocalSyncFor(HH_A);
    const second = runHouseLocalSyncFor(HH_A);
    release();
    await Promise.all([first, second]);

    expect(mockMailboxes.filter((m) => m.householdKeys.householdId === HH_A)).toHaveLength(1);
  });
});

describe('the status banner belongs to the property on screen', () => {
  it('does not let a background property paint its failure over a working screen', async () => {
    mockActiveHouseholdId = HH_A;
    mockFetchControlPlaneState.mockImplementation(async (id: string) => {
      if (id === HH_B) throw new Error('offline');
      return controlPlaneState(id);
    });

    await runHouseLocalSync();

    expect(useHouseSyncStatusStore.getState().phase).not.toBe('offline');
  });

  it('does report the ACTIVE property’s failure, which is the one the member can see', async () => {
    mockActiveHouseholdId = HH_B;
    mockFetchControlPlaneState.mockImplementation(async (id: string) => {
      if (id === HH_B) throw new Error('offline');
      return controlPlaneState(id);
    });

    await runHouseLocalSync();

    expect(useHouseSyncStatusStore.getState().phase).toBe('offline');
  });

  it('counts conflicts from the property that synced, not from the one on screen', async () => {
    mockActiveHouseholdId = HH_B;
    mockConflicts.set(HH_B, [{ table: 'tasks' }, { table: 'tasks' }]);

    await runHouseLocalSyncFor(HH_B);

    expect(useHouseSyncStatusStore.getState().conflicts).toBe(2);
  });
});

describe('a 403 registers the property that got it', () => {
  it('names the household in the retry, rather than registering whatever is active', async () => {
    // Left to default, the retry registered the ACTIVE home — never the one that
    // just got the 403 when a background home is syncing — so it re-asked the
    // same question and failed the same way, for ever.
    mockActiveHouseholdId = HH_A;
    let denied = true;
    mockFetchControlPlaneState.mockImplementation(async (id: string) => {
      if (id === HH_B && denied) {
        denied = false;
        throw Object.assign(new Error('forbidden'), { response: { status: 403 } });
      }
      return controlPlaneState(id);
    });

    await runHouseLocalSyncFor(HH_B);

    expect(mockSyncLocalHouseholdToControlPlane).toHaveBeenCalledWith(HH_B);
  });

  it('treats a non-403 as offline rather than registering on every hiccup', async () => {
    mockFetchControlPlaneState.mockRejectedValue(new Error('timeout'));

    await runHouseLocalSyncFor(HH_A);

    expect(mockSyncLocalHouseholdToControlPlane).not.toHaveBeenCalled();
    expect(mockMailboxes).toHaveLength(0);
  });
});

describe('a property still awaiting its key', () => {
  it('does not bootstrap a checkpoint it has no key to open', async () => {
    mockHandles.set(HH_A, handle(HH_A, { awaitingEnrolment: true }));

    await runHouseLocalSyncFor(HH_A);

    expect(mockTryInstallLatestCheckpoint).not.toHaveBeenCalled();
  });
});

/**
 * Telling a wait apart from a dead end.
 *
 * `awaitingEnrolment` says the household key has not arrived. It does not say
 * whether it ever will, and the two render identically — "Waiting for the home
 * key", indefinitely. Observed on House-iPad 2026-09-03: the only other enrolled
 * device was a previous identity of the same simulator, destroyed by a
 * reinstall, so the wrap had nobody left to deposit it and the device polled
 * `HDK wrap not found … blobsSeen=0` on every heartbeat.
 */
describe('a property awaiting a key nobody can hand over', () => {
  /** Older than `DEVICE_STALE_AFTER_MS` (7 days) — a device that stopped syncing. */
  const LONG_GONE = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const stateWithPeerSeen = (householdId: string, peerLastSeenAt: string | null) => ({
    ...controlPlaneState(householdId),
    devices: [
      { ...controlPlaneState(householdId).devices[0], lastSeenAt: new Date().toISOString() },
      { ...controlPlaneState(householdId).devices[1], lastSeenAt: peerLastSeenAt },
    ],
  });

  it('reports the wait as unreachable when every other device has gone stale', async () => {
    mockHandles.set(HH_A, handle(HH_A, { awaitingEnrolment: true }));
    mockFetchControlPlaneState.mockImplementation(async (id: string) =>
      stateWithPeerSeen(id, LONG_GONE),
    );

    await runHouseLocalSyncFor(HH_A);

    expect(useHouseSyncStatusStore.getState().enrolmentUnreachable).toBe(true);
  });

  it('keeps waiting while another device is still reaching the home', async () => {
    mockHandles.set(HH_A, handle(HH_A, { awaitingEnrolment: true }));
    mockFetchControlPlaneState.mockImplementation(async (id: string) =>
      stateWithPeerSeen(id, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()),
    );

    await runHouseLocalSyncFor(HH_A);

    expect(useHouseSyncStatusStore.getState().enrolmentUnreachable).toBe(false);
  });

  it('clears the verdict once the property is no longer awaiting a key', async () => {
    // Left set, a home that recovered would keep telling the member it was
    // beyond saving.
    useHouseSyncStatusStore.setState({ enrolmentUnreachable: true });
    mockHandles.set(HH_A, handle(HH_A, { awaitingEnrolment: false }));

    await runHouseLocalSyncFor(HH_A);

    expect(useHouseSyncStatusStore.getState().enrolmentUnreachable).toBe(false);
  });

  it('does not let a BACKGROUND property write the verdict onto the foreground banner', async () => {
    // The status store describes the property on screen. HH_B is stuck, but
    // HH_A is what the member is looking at, and telling them THEIR home is
    // unrecoverable because a different one is would be a lie.
    mockHandles.set(HH_B, handle(HH_B, { awaitingEnrolment: true }));
    mockFetchControlPlaneState.mockImplementation(async (id: string) =>
      stateWithPeerSeen(id, LONG_GONE),
    );

    await runHouseLocalSyncFor(HH_B);

    expect(mockActiveHouseholdId).toBe(HH_A);
    expect(useHouseSyncStatusStore.getState().enrolmentUnreachable).toBe(false);
  });
});

describe('the gates', () => {
  it('does nothing at all with local-first off', async () => {
    mockLocalFirst = false;
    await runHouseLocalSync();
    expect(mockMailboxes).toHaveLength(0);
  });

  it('does nothing at all with no session open', async () => {
    mockSessionOpen = false;
    await runHouseLocalSync();
    expect(mockMailboxes).toHaveLength(0);
  });
});

/**
 * Telling the household a deposit is waiting.
 *
 * The nudge that makes another member's change appear on this screen while they
 * are still looking at theirs — `autoSync` turns the inbound frame into a sync.
 * House never had this at all: the coordinator socket was opened only by
 * `enrolmentLive`, and nothing ever announced.
 *
 * Now that peers ACT on the frame, it is also how a quiet home could spin for
 * ever. The coordinator fans `sync_available` out to every other device, so
 * announcing unconditionally would mean: A announces → B syncs → B announces →
 * A syncs → A announces, with nobody writing anything. Gating on a deposit
 * terminates it after one hop, because the peer that only RECEIVED has nothing
 * to deposit and so says nothing back.
 */
describe('announcing a deposit', () => {
  const depositedOnce = async () => ({
    applied: 0,
    pushedOps: 2,
    chunks: 1,
    skippedPeers: 0,
    pages: 1,
    deposited: 1,
    acked: 0,
  });

  it('says nothing when the run deposited nothing', async () => {
    await runHouseLocalSyncFor(HH_A);

    expect(mockAnnounceSyncAvailable).not.toHaveBeenCalled();
  });

  it('announces when the run left ops for a peer to collect', async () => {
    mockSyncOnce = depositedOnce;

    await runHouseLocalSyncFor(HH_A);

    expect(mockSignalingConnect).toHaveBeenCalledWith(HH_A);
    expect(mockAnnounceSyncAvailable).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a BACKGROUND property, whatever it deposited', async () => {
    // One socket, one property: `connect()` refuses a non-active property by
    // design, so a background run announcing would either be dropped or drag the
    // socket out of the room the member is looking at.
    mockActiveHouseholdId = HH_A;
    mockSyncOnce = depositedOnce;

    await runHouseLocalSyncFor(HH_B);

    expect(mockAnnounceSyncAvailable).not.toHaveBeenCalled();
  });

  it('does not announce when the socket refuses to connect', async () => {
    // Offline, or a switch landed mid-run. Announcing into a socket that is not
    // there is not an error, but claiming it happened would be.
    mockSignalingConnect.mockImplementation(() => false);
    mockSyncOnce = depositedOnce;

    await runHouseLocalSyncFor(HH_A);

    expect(mockAnnounceSyncAvailable).not.toHaveBeenCalled();
  });

  it('never fails the sync because the socket threw', async () => {
    mockSignalingConnect.mockImplementation(() => {
      throw new Error('socket exploded');
    });
    mockSyncOnce = depositedOnce;

    await runHouseLocalSyncFor(HH_A);

    // The deposit is on the relay either way and the peer's heartbeat finds it.
    expect(useHouseSyncStatusStore.getState().phase).toBe('ok');
  });
});

describe('the read-side key ring reaches the mailbox', () => {
  /**
   * A home that has revoked anybody has rotated its HDK, and a peer still
   * draining a backlog deposited before that rotation sends batches sealed under
   * the OLD epoch. The mailbox opens a deposit against the current epoch first
   * and then every retired one — but only if it was given them.
   *
   * House held these keys on the session handle for the attachment channel and
   * never passed them here, so every such batch was refused and left on the
   * relay permanently. Nothing throws: the home simply stops applying anything a
   * revocation has aged out, and reports a clean sync while doing it.
   */
  it('hands the mailbox every epoch this device can still read with', async () => {
    const ring = new Map([
      [1, new Uint8Array(32).fill(0x11)],
      [2, new Uint8Array(32).fill(0x22)],
    ]);
    mockHandles.set(HH_A, handle(HH_A, { retiredHouseholdKeys: ring }));

    await runHouseLocalSyncFor(HH_A);

    expect(mockMailboxes).toHaveLength(1);
    expect(mockMailboxes[0]!.retiredHdks).toBe(ring);
  });

  it('keeps each property to its own ring', async () => {
    // The same hazard as the HDK itself: A's retired keys handed to B's mailbox
    // would have B trying to open its peers' batches with a stranger's history
    // of keys.
    const ringA = new Map([[1, new Uint8Array(32).fill(0xa1)]]);
    const ringB = new Map([[1, new Uint8Array(32).fill(0xb1)]]);
    mockHandles.set(HH_A, handle(HH_A, { retiredHouseholdKeys: ringA }));
    mockHandles.set(HH_B, handle(HH_B, { retiredHouseholdKeys: ringB }));

    await runHouseLocalSync();

    const forA = mockMailboxes.find((m) => m.householdKeys.householdId === HH_A);
    const forB = mockMailboxes.find((m) => m.householdKeys.householdId === HH_B);
    expect(forA!.retiredHdks).toBe(ringA);
    expect(forB!.retiredHdks).toBe(ringB);
  });
});

describe('a home nobody else can reach is skipped', () => {
  /**
   * Skipping is not an optimisation. `resolvePeers` answers a 403 by REGISTERING
   * the property and retrying — so running the round against a private home
   * re-creates, on the next tick, exactly the control-plane row that is not
   * supposed to exist. A private home is meant to stay off the control plane
   * entirely.
   */
  it('does not open a mailbox for a property with no control-plane row', async () => {
    mockHouseholdIsOnControlPlane.mockImplementation(async (id: string) => id !== HH_A);

    await runHouseLocalSync();

    expect(mockMailboxes.map((m) => m.householdKeys.householdId)).toEqual([HH_B]);
    // And it never asked the control plane about it, so the 403 recovery that
    // would have re-registered it was never reachable.
    expect(mockFetchControlPlaneState).not.toHaveBeenCalledWith(HH_A);
  });

  it('leaves the banner idle rather than claiming an error', async () => {
    // A private home is not a broken one. Painting 'error' here is what made
    // "sync does nothing" look like a failure to a member with a solo home.
    mockHouseholdIsOnControlPlane.mockImplementation(async () => false);

    await runHouseLocalSyncFor(HH_A);

    expect(useHouseSyncStatusStore.getState().phase).toBe('idle');
    expect(useHouseSyncStatusStore.getState().stage).toBe('idle');
  });
});

describe('reminders are refreshed once per invocation', () => {
  /**
   * The pass cancels House notifications by prefix and reschedules wholesale, so
   * one pass PER PROPERTY does the same work N times and interleaves N sweeps
   * over the notification centre for nothing.
   */
  it('does not run once per property in a fan-out', async () => {
    await runHouseLocalSync();

    expect(mockHandles.size).toBe(2);
    expect(mockSyncHouseLocalReminders).toHaveBeenCalledTimes(1);
  });

  it('still refreshes when the property failed to sync', async () => {
    // The old placement was the last line of the success path, so a home that
    // threw left its reminders stale until something else happened to reschedule
    // them — precisely the home most likely to be holding out-of-date ones.
    mockSyncOnce = async () => {
      throw new Error('relay unreachable');
    };

    await runHouseLocalSyncFor(HH_A);

    expect(useHouseSyncStatusStore.getState().phase).toBe('error');
    expect(mockSyncHouseLocalReminders).toHaveBeenCalledTimes(1);
  });
});

describe('the roster rides on the sync it is already paying for', () => {
  it('publishes members for the property on screen', async () => {
    await runHouseLocalSyncFor(HH_A);

    expect(mockPublishHouseRoster).toHaveBeenCalledWith(expect.anything(), HH_A);
  });

  it('never publishes a background property over the one on screen', async () => {
    // The household store holds ONE member list. A background property writing
    // into it would blank the names on the screen the member is looking at.
    await runHouseLocalSyncFor(HH_B);

    expect(mockPublishHouseRoster).not.toHaveBeenCalled();
  });
});
