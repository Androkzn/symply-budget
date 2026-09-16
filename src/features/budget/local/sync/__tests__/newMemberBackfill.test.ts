/**
 * What a brand-new member actually RECEIVES.
 *
 * The enrolment suite proves the household key arrives (mm-05) and that a
 * spending written AFTER the join reaches the peer (mm-06 → mm-07). Neither
 * touches the case a joiner cares about most: the months of budget that existed
 * before they were invited. That history does not travel as ops — the log is
 * compacted — it travels as a CHECKPOINT, and `tryInstallLatestCheckpoint`
 * under reason `bootstrap` is the only thing that fetches one.
 *
 * Its primitives are covered in `packages/local-first/__tests__/checkpoint.test.ts`
 * (seal/open, bad signature, tampered chunk). What had no coverage at either
 * layer is the join: an empty device, a household with existing rows, and the
 * question of whether those rows end up on it. A member could join, every test
 * could stay green, and they could land in an empty budget.
 *
 * So the crypto here is REAL — a genuinely sealed checkpoint, opened through the
 * production path — and only the control plane and the engine's storage are
 * stubbed. A test that mocked `openCheckpoint` would prove the plumbing calls
 * itself and nothing about whether a newcomer can read what they were sent.
 */
import {
  generateDeviceIdentity,
  generateHouseholdKeys,
  bytesToBase64,
  bytesToHex,
  sealCheckpoint,
} from '@symply/local-first';

import {
  fetchCheckpointChunk,
  fetchControlPlaneState,
  fetchLatestCheckpoint,
} from '../../controlPlaneClient';
import {
  clearHouseholdBootstrapPending,
  getLocalBudgetSession,
  installCheckpointPlaintext,
  isAwaitingHouseholdEnrolment,
  isHouseholdBootstrapPending,
} from '../../engine';
import { runHouseholdBackfill, tryInstallLatestCheckpoint } from '../checkpoints';

jest.mock('../../controlPlaneClient', () => ({
  fetchLatestCheckpoint: jest.fn(),
  fetchCheckpointChunk: jest.fn(),
  fetchControlPlaneState: jest.fn(),
  putCheckpointChunk: jest.fn(async () => undefined),
}));

const HOUSEHOLD_ID = 'hh-backfill';

/** The owner, who wrote the budget long before anyone was invited. */
const owner = generateDeviceIdentity('dev-owner');
const householdKeys = generateHouseholdKeys(HOUSEHOLD_ID, 1);

/**
 * The JOINER's view of the world: its own identity, the household key it has
 * just been given, and — the point of the whole test — an empty version vector.
 * It has authored nothing and received nothing.
 */
const joiner = generateDeviceIdentity('dev-joiner');
let joinerVersionVector: Record<string, number> = {};

/**
 * Bare `jest.fn()`s, filled in from `beforeEach`.
 *
 * The factory is hoisted above the identity/key consts above, so anything it
 * closed over would be a TDZ error — the same reason `hdkTransfer.test.ts`
 * derives its session rather than returning a fixed object.
 */
jest.mock('../../engine', () => ({
  isAwaitingHouseholdEnrolment: jest.fn(() => false),
  getActiveBudgetHouseholdId: jest.fn(() => 'hh-backfill'),
  getLocalBudgetSession: jest.fn(),
  installCheckpointPlaintext: jest.fn(async () => undefined),
  compactLocalLogIfSafe: jest.fn(async () => undefined),
  exportCheckpointPlaintext: jest.fn(),
  rememberPublishedCheckpoint: jest.fn(async () => undefined),
  isHouseholdBootstrapPending: jest.fn(async () => false),
  clearHouseholdBootstrapPending: jest.fn(async () => undefined),
}));

/**
 * The rows the household already had. Deliberately more than one table: a
 * backfill that carried only the table the joiner's first screen happens to read
 * would look correct until they opened anything else.
 */
const EXISTING_ROWS = [
  {
    table: 'expenses',
    rowKey: 'exp-rent-july',
    bucket: '2026-07',
    deleted: false,
    bodyJson: '{"row":{"id":"exp-rent-july","amount":180000},"lww":{"f":{}}}',
    updatedHlc: '000000000000100-0000-devowner',
  },
  {
    table: 'budget_items',
    rowKey: 'item-groceries',
    bucket: '2026-07',
    deleted: false,
    bodyJson: '{"row":{"id":"item-groceries","planned":40000},"lww":{"f":{}}}',
    updatedHlc: '000000000000101-0000-devowner',
  },
];

function sealHouseholdHistory(rows = EXISTING_ROWS) {
  return sealCheckpoint({
    plaintext: {
      v: 1 as const,
      householdId: HOUSEHOLD_ID,
      keyEpoch: 1,
      versionVector: { 'dev-owner': 42 },
      household: { id: HOUSEHOLD_ID, name: 'Sweet Home' },
      rows,
    },
    hdk: householdKeys.hdk,
    generation: 7,
    signerDeviceId: owner.deviceId,
    signingPrivateKey: owner.signingPrivateKey,
  });
}

/** Publish a sealed checkpoint into the mocked control plane. */
function publish(sealed: ReturnType<typeof sealHouseholdHistory>, options?: { signerActive?: boolean }) {
  (fetchLatestCheckpoint as jest.Mock).mockResolvedValue({
    manifest: sealed.manifest,
    generation: sealed.manifest.generation,
    chunkCount: sealed.manifest.chunkCount,
  });
  (fetchCheckpointChunk as jest.Mock).mockImplementation(async (_hh: string, index: number) => ({
    generation: sealed.manifest.generation,
    chunkIndex: index,
    ciphertextBase64: bytesToBase64(sealed.chunks[index]),
  }));
  (fetchControlPlaneState as jest.Mock).mockResolvedValue({
    devices: [
      {
        deviceId: owner.deviceId,
        status: options?.signerActive === false ? 'revoked' : 'active',
        signingPublicKey: bytesToHex(owner.signingPublicKey),
      },
    ],
  });
}

describe('a brand-new member receives the budget that already existed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Empty: this device has authored nothing and received nothing. That is what
    // makes it a new member rather than one catching up.
    joinerVersionVector = {};
    (isAwaitingHouseholdEnrolment as jest.Mock).mockReturnValue(false);
    (getLocalBudgetSession as jest.Mock).mockResolvedValue({
      householdId: HOUSEHOLD_ID,
      ledger: { household: { id: HOUSEHOLD_ID, name: 'Sweet Home' }, deviceId: joiner.deviceId },
      householdKeys,
      // The key ring, empty here on purpose: this member joined a household
      // that has never rotated, so the current key opens the checkpoint. The
      // rotated case — where it does not — is covered in the package's
      // key-epoch-ring suite.
      retiredHouseholdKeys: new Map<number, Uint8Array>(),
      identity: joiner,
      store: { getVersionVector: jest.fn(async () => joinerVersionVector) },
    });
  });

  it('installs the household history onto a device that has none', async () => {
    publish(sealHouseholdHistory());

    await expect(tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID)).resolves.toBe(true);

    const [plain, namedHousehold] = (installCheckpointPlaintext as jest.Mock).mock.calls[0];
    // The rows themselves, decrypted through the real HDK — not merely "a call
    // happened". This is the assertion the feature exists for.
    expect(plain.rows).toEqual(EXISTING_ROWS);
    expect(plain.householdId).toBe(HOUSEHOLD_ID);
    // Named explicitly: `installCheckpointPlaintext` CLEARS the household's rows
    // before writing, so an unnamed call wipes whichever household is on screen.
    expect(namedHousehold).toBe(HOUSEHOLD_ID);
  });

  it('keeps first-sync pending until the installed data is published to the UI', async () => {
    publish(sealHouseholdHistory());
    (isHouseholdBootstrapPending as jest.Mock).mockResolvedValue(true);
    const order: string[] = [];
    let finishRefresh!: () => void;
    const refresh = new Promise<void>(resolve => {finishRefresh = resolve;});
    const onApplying = jest.fn(() => {order.push('applying');});
    const onApplied = jest.fn(async () => {order.push('refreshing'); await refresh;});
    const run = runHouseholdBackfill(HOUSEHOLD_ID, {onApplying,onApplied});
    for (let i = 0; i < 20 && !onApplied.mock.calls.length; i += 1) await Promise.resolve();
    expect(order).toEqual(['applying','refreshing']);
    expect(installCheckpointPlaintext).toHaveBeenCalled();
    expect(clearHouseholdBootstrapPending).not.toHaveBeenCalled();
    finishRefresh();
    await expect(run).resolves.toBe('installed');
    expect(clearHouseholdBootstrapPending).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('carries every table, not just the one the first screen reads', async () => {
    publish(sealHouseholdHistory());
    await tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID);
    const [plain] = (installCheckpointPlaintext as jest.Mock).mock.calls[0];
    expect(plain.rows.map((r: { table: string }) => r.table).sort()).toEqual([
      'budget_items',
      'expenses',
    ]);
  });

  it('fetches every chunk of a multi-chunk history', async () => {
    // A large household splits across chunks. Stopping early would install a
    // partial budget that still decrypts and still looks plausible.
    //
    // Chunking is by BYTE size, not row count — 400 small rows still sealed into
    // one chunk and the assertion below was vacuous. Padded bodies, as the
    // package's own multi-chunk test does.
    const body = 'x'.repeat(200_000);
    const many = Array.from({ length: 6 }, (_, i) => ({
      table: 'expenses',
      rowKey: `exp-${i}`,
      bucket: '2026-07',
      deleted: false,
      bodyJson: body,
      updatedHlc: `00000000000${String(1000 + i)}-0000-devowner`,
    }));
    const sealed = sealHouseholdHistory(many);
    expect(sealed.manifest.chunkCount).toBeGreaterThan(1);
    publish(sealed);

    await tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID);

    expect(fetchCheckpointChunk).toHaveBeenCalledTimes(sealed.manifest.chunkCount);
    const [plain] = (installCheckpointPlaintext as jest.Mock).mock.calls[0];
    expect(plain.rows).toHaveLength(many.length);
  });

  it('refuses a chunk from another generation before installing any rows', async () => {
    const sealed = sealHouseholdHistory();
    publish(sealed);
    (fetchCheckpointChunk as jest.Mock).mockResolvedValue({generation: sealed.manifest.generation + 1, chunkIndex: 0, ciphertextBase64: bytesToBase64(sealed.chunks[0])});
    await expect(tryInstallLatestCheckpoint('bootstrap')).rejects.toThrow('generation changed');
    expect(installCheckpointPlaintext).not.toHaveBeenCalled();
  });

  it('refuses a checkpoint signed by a device the household no longer trusts', async () => {
    // The signature is valid; the SIGNER has been revoked. Installing here would
    // let a removed device hand a joiner a budget of its choosing — and the
    // install path wipes first, so it would also destroy what was there.
    publish(sealHouseholdHistory(), { signerActive: false });

    await expect(tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID)).rejects.toThrow(
      /signer unknown/i,
    );
    expect(installCheckpointPlaintext).not.toHaveBeenCalled();
  });

  it('does nothing while the device is still waiting to be let in', async () => {
    // Before approval this device holds no household key, so there is nothing to
    // open the checkpoint with — and it must not clear the household either.
    (isAwaitingHouseholdEnrolment as jest.Mock).mockReturnValue(true);
    publish(sealHouseholdHistory());

    await expect(tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID)).resolves.toBe(false);
    expect(fetchLatestCheckpoint).not.toHaveBeenCalled();
    expect(installCheckpointPlaintext).not.toHaveBeenCalled();
  });

  it('is a no-op when the household has never published one', async () => {
    // A brand-new household: nothing to backfill, and the joiner starts empty
    // rather than erroring.
    (fetchLatestCheckpoint as jest.Mock).mockResolvedValue(null);

    await expect(tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID)).resolves.toBe(false);
    expect(installCheckpointPlaintext).not.toHaveBeenCalled();
  });
});

/**
 * The retry, which is the part that was missing.
 *
 * Every test above asks whether ONE attempt works. The production failure was
 * never about a broken attempt — it was about there being only one, taken at a
 * moment the owner's snapshot did not exist yet.
 *
 * The sequence that produced it: the owner approves, the joiner receives the
 * household key, the joiner's first sync looks for a checkpoint and the upload
 * has not landed, so it finds nothing. Then the same sync drains the mailbox and
 * merges one live op — and the old gate (`the version vector is empty`) is now
 * false for ever. The joiner keeps syncing happily, receives everything written
 * from that moment on, and never receives anything written before it: the
 * current month arrives, the goals, the income and the earlier months do not,
 * because the ops that carried them were compacted at the owner long ago.
 *
 * So these are about the MARKER, not the crypto: does an unsuccessful attempt
 * leave the household still owed, and does a later attempt — with a version
 * vector that is no longer empty — still install?
 */
describe('the backfill is retried until the history actually lands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    joinerVersionVector = {};
    (isAwaitingHouseholdEnrolment as jest.Mock).mockReturnValue(false);
    (isHouseholdBootstrapPending as jest.Mock).mockResolvedValue(true);
    (getLocalBudgetSession as jest.Mock).mockResolvedValue({
      householdId: HOUSEHOLD_ID,
      ledger: { household: { id: HOUSEHOLD_ID, name: 'Sweet Home' }, deviceId: joiner.deviceId },
      householdKeys,
      retiredHouseholdKeys: new Map<number, Uint8Array>(),
      identity: joiner,
      store: { getVersionVector: jest.fn(async () => joinerVersionVector) },
    });
  });

  it('keeps the household owed when the owner has not published a snapshot yet', async () => {
    (fetchLatestCheckpoint as jest.Mock).mockResolvedValue(null);

    await expect(runHouseholdBackfill(HOUSEHOLD_ID)).resolves.toBe('no-checkpoint');

    // THE assertion. Clearing here is what made the failure permanent: the next
    // pass would see nothing owed and the member would keep a partial budget for
    // the life of the install.
    expect(clearHouseholdBootstrapPending).not.toHaveBeenCalled();
    expect(installCheckpointPlaintext).not.toHaveBeenCalled();
  });

  it('installs on a later pass, after live ops have already been merged', async () => {
    // The state the old gate could not recover from: this device has applied an
    // op from a peer, so its version vector names an author. Under
    // `Object.keys(ours).length === 0` the bootstrap was over; under the marker
    // it is simply not finished.
    //
    // The author is the OTHER member's device, at seq 1 — which is what a
    // joiner's vector really looks like after one live op. It cannot be
    // `dev-owner` at a high seq: the vector is a CONTIGUOUS frontier, and a
    // joiner holding op 43 with 1..42 missing reports nothing for that author.
    // (A vector that did cover the checkpoint would be `already-current`, and
    // correctly so — the test below pins that.)
    joinerVersionVector = { 'dev-peer': 1 };
    publish(sealHouseholdHistory());

    await expect(runHouseholdBackfill(HOUSEHOLD_ID)).resolves.toBe('installed');

    const [plain] = (installCheckpointPlaintext as jest.Mock).mock.calls[0];
    expect(plain.rows).toEqual(EXISTING_ROWS);
    expect(clearHouseholdBootstrapPending).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('stops retrying once this device already covers the snapshot', async () => {
    // A device that genuinely holds everything the checkpoint holds is done, and
    // must not re-download the household on every sync for ever.
    joinerVersionVector = { 'dev-owner': 42 };
    publish(sealHouseholdHistory());

    await expect(runHouseholdBackfill(HOUSEHOLD_ID)).resolves.toBe('already-current');

    expect(installCheckpointPlaintext).not.toHaveBeenCalled();
    expect(clearHouseholdBootstrapPending).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('does not touch a household that was never joined', async () => {
    // Households this device MINTED have no history elsewhere to fetch. The
    // marker is the only thing that distinguishes them, and a backfill that ran
    // anyway would download and install a snapshot over a ledger that is the
    // household's origin.
    (isHouseholdBootstrapPending as jest.Mock).mockResolvedValue(false);
    publish(sealHouseholdHistory());

    await expect(runHouseholdBackfill(HOUSEHOLD_ID)).resolves.toBe('not-needed');

    expect(fetchLatestCheckpoint).not.toHaveBeenCalled();
    expect(installCheckpointPlaintext).not.toHaveBeenCalled();
  });

  it('reports download progress chunk by chunk', async () => {
    // The panel's fraction is real or it is a lie. A household with years of
    // budget is several chunks, and each one has to move the bar.
    const body = 'x'.repeat(200_000);
    const many = Array.from({ length: 6 }, (_, i) => ({
      table: 'expenses',
      rowKey: `exp-${i}`,
      bucket: '2026-07',
      deleted: false,
      bodyJson: body,
      updatedHlc: `00000000000${String(1000 + i)}-0000-devowner`,
    }));
    const sealed = sealHouseholdHistory(many);
    publish(sealed);

    const seen: Array<{ done: number; total: number }> = [];
    await runHouseholdBackfill(HOUSEHOLD_ID, {
      onProgress: (done, total) => seen.push({ done, total }),
    });

    expect(seen[0]).toEqual({ done: 0, total: sealed.manifest.chunkCount });
    expect(seen[seen.length - 1]).toEqual({
      done: sealed.manifest.chunkCount,
      total: sealed.manifest.chunkCount,
    });
    expect(seen).toHaveLength(sealed.manifest.chunkCount + 1);
  });
});
