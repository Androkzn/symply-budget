/**
 * What a brand-new member of a home actually RECEIVES.
 *
 * The enrolment suite proves the home key arrives, and the two-device run proves
 * a task written AFTER the join reaches the peer. Neither touches the case a
 * joiner cares about most: the years of home the owner had before anybody was
 * invited. That history does not travel as ops — the log is compacted, and H10
 * measured a full House catch-up at 452 ops per deposit, so a ten-year log is 98
 * round trips — it travels as a CHECKPOINT, and `tryInstallLatestCheckpoint`
 * under reason `bootstrap` is the only thing that fetches one.
 *
 * A member could join, every other test could stay green, and they could land in
 * an empty home.
 *
 * The publish side is here too, because it is the other half of the same
 * promise: a snapshot that is never published, or is published under a key the
 * home has since rotated away from, is a joiner who bootstraps from nothing.
 *
 * The crypto is REAL — a genuinely sealed checkpoint, opened through the
 * production path — and only the control plane and the engine's storage are
 * stubbed. A test that mocked `openCheckpoint` would prove the plumbing calls
 * itself and nothing about whether a newcomer can read what they were sent.
 */
import {
  bytesToBase64,
  bytesToHex,
  generateDeviceIdentity,
  generateHouseholdKeys,
  sealCheckpoint,
} from '@symply/local-first';

import {
  fetchCheckpointChunk,
  fetchControlPlaneState,
  fetchLatestCheckpoint,
  putCheckpointChunk,
} from '../../controlPlaneClient';
import {
  exportHouseCheckpointPlaintext,
  getLocalHouseSession,
  installHouseCheckpointPlaintext,
  isAwaitingHouseEnrolment,
} from '../../engine';
import { maybePublishCheckpoint, tryInstallLatestCheckpoint } from '../checkpoints';

jest.mock('../../controlPlaneClient', () => ({
  fetchLatestCheckpoint: jest.fn(),
  fetchCheckpointChunk: jest.fn(),
  fetchControlPlaneState: jest.fn(),
  putCheckpointChunk: jest.fn(async () => undefined),
}));

/**
 * Bare `jest.fn()`s, filled in from `beforeEach`.
 *
 * The factory is hoisted above the identity/key consts below, so anything it
 * closed over would be a TDZ error.
 */
jest.mock('../../engine', () => ({
  isAwaitingHouseEnrolment: jest.fn(() => false),
  getActiveHouseholdId: jest.fn(() => 'hh-backfill'),
  getLocalHouseSession: jest.fn(),
  installHouseCheckpointPlaintext: jest.fn(async () => undefined),
  compactLocalHouseLogIfSafe: jest.fn(async () => undefined),
  exportHouseCheckpointPlaintext: jest.fn(),
  rememberPublishedHouseCheckpoint: jest.fn(async () => undefined),
}));

const HOUSEHOLD_ID = 'hh-backfill';

/** The owner, who ran this home long before anyone was invited. */
const owner = generateDeviceIdentity('dev-owner');
const householdKeys = generateHouseholdKeys(HOUSEHOLD_ID, 1);

/** The joiner: its own identity, the home key it was just given, no history. */
const joiner = generateDeviceIdentity('dev-joiner');
let joinerVersionVector: Record<string, number> = {};
/** What the joiner's store says it has published / holds, per key. */
let storeMeta: Record<string, string> = {};
let opsSinceCheckpoint = 0;
let sessionRole = 'owner';
let sessionKeys = householdKeys;

/**
 * The rows the home already had. Deliberately more than one table: a backfill
 * that carried only the table the joiner's first screen happens to read would
 * look correct until they opened anything else.
 */
const EXISTING_ROWS = [
  {
    table: 'tasks',
    rowKey: 'task-boiler',
    bucket: '2026-07',
    deleted: false,
    bodyJson: '{"row":{"id":"task-boiler","title":"Service the boiler"},"lww":{"f":{}}}',
    updatedHlc: '000000000000100-0000-devowner',
  },
  {
    table: 'appliances',
    rowKey: 'app-dishwasher',
    bucket: '*',
    deleted: false,
    bodyJson: '{"row":{"id":"app-dishwasher","name":"Dishwasher"},"lww":{"f":{}}}',
    updatedHlc: '000000000000101-0000-devowner',
  },
];

function sealHomeHistory(rows = EXISTING_ROWS, keys = householdKeys) {
  return sealCheckpoint({
    plaintext: {
      v: 1 as const,
      householdId: HOUSEHOLD_ID,
      keyEpoch: keys.keyEpoch,
      versionVector: { 'dev-owner': 42 },
      // The home's identity row travels with the snapshot: a joiner that
      // installed only `rows` would land in a home with no name.
      household: { id: HOUSEHOLD_ID, name: 'Maple Street House' },
      rows,
    },
    hdk: keys.hdk,
    generation: 1,
    signerDeviceId: owner.deviceId,
    signingPrivateKey: owner.signingPrivateKey,
  });
}

/** Serve a sealed checkpoint the way the control plane would. */
function serveCheckpoint(sealed: ReturnType<typeof sealCheckpoint>) {
  (fetchLatestCheckpoint as jest.Mock).mockResolvedValue({
    generation: 1,
    chunkCount: sealed.chunks.length,
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    manifest: sealed.manifest,
  });
  (fetchCheckpointChunk as jest.Mock).mockImplementation(async (_hh: string, index: number) => ({
    generation: 1,
    chunkIndex: index,
    ciphertextBase64: bytesToBase64(sealed.chunks[index]!),
  }));
  (fetchControlPlaneState as jest.Mock).mockResolvedValue({
    householdId: HOUSEHOLD_ID,
    keyEpoch: 1,
    securityRevision: 1,
    members: [],
    devices: [
      {
        deviceId: owner.deviceId,
        userId: 'u-owner',
        signingPublicKey: bytesToHex(owner.signingPublicKey),
        agreementPublicKey: bytesToHex(owner.agreementPublicKey),
        status: 'active',
      },
    ],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  joinerVersionVector = {};
  storeMeta = {};
  opsSinceCheckpoint = 0;
  sessionRole = 'owner';
  sessionKeys = householdKeys;

  (isAwaitingHouseEnrolment as jest.Mock).mockReturnValue(false);
  (getLocalHouseSession as jest.Mock).mockImplementation(async () => ({
    householdId: HOUSEHOLD_ID,
    ledger: {
      household: { id: HOUSEHOLD_ID, name: 'Maple Street House', my_role: sessionRole },
      deviceId: joiner.deviceId,
    },
    identity: joiner,
    householdKeys: sessionKeys,
    retiredHouseholdKeys: new Map(),
    store: {
      getVersionVector: jest.fn(async () => joinerVersionVector),
      countOperationsSince: jest.fn(async () => opsSinceCheckpoint),
      getMeta: jest.fn(async (key: string) => storeMeta[key] ?? null),
      setMeta: jest.fn(async (key: string, value: string) => {
        storeMeta[key] = value;
      }),
    },
  }));
  (exportHouseCheckpointPlaintext as jest.Mock).mockResolvedValue({
    v: 1,
    householdId: HOUSEHOLD_ID,
    keyEpoch: sessionKeys.keyEpoch,
    versionVector: { 'dev-owner': 42 },
    household: { id: HOUSEHOLD_ID, name: 'Maple Street House' },
    rows: EXISTING_ROWS,
  });
});

describe('a new member bootstraps the home that existed before them', () => {
  it('installs every table the checkpoint carried, not just the first screen’s', async () => {
    serveCheckpoint(sealHomeHistory());

    await expect(tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID)).resolves.toBe(true);

    const installed = (installHouseCheckpointPlaintext as jest.Mock).mock.calls[0]![0] as {
      rows: Array<{ table: string; rowKey: string }>;
    };
    expect(installed.rows.map((row) => row.table).sort()).toEqual(['appliances', 'tasks']);
    expect(installed.rows.map((row) => row.rowKey)).toContain('task-boiler');
  });

  it('installs into the property it was ASKED about', async () => {
    serveCheckpoint(sealHomeHistory());

    await tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID);

    expect(installHouseCheckpointPlaintext).toHaveBeenCalledWith(
      expect.anything(),
      HOUSEHOLD_ID,
    );
  });

  it('says plainly that there is nothing to bootstrap FROM, rather than half-joining', async () => {
    // "The owner never published one" and "we could not read the one that
    // exists" are different diagnoses, and both used to return a bare false.
    (fetchLatestCheckpoint as jest.Mock).mockResolvedValue(null);

    await expect(tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID)).resolves.toBe(false);
    expect(installHouseCheckpointPlaintext).not.toHaveBeenCalled();
  });

  it('refuses a checkpoint signed by a device the home does not list as active', async () => {
    // The relay stores the chunks. Without the signer check it could substitute
    // a snapshot of its own and the joiner would install it as the home.
    const sealed = sealHomeHistory();
    serveCheckpoint(sealed);
    (fetchControlPlaneState as jest.Mock).mockResolvedValue({
      householdId: HOUSEHOLD_ID,
      keyEpoch: 1,
      securityRevision: 1,
      members: [],
      devices: [],
    });

    await expect(tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID)).rejects.toThrow();
    expect(installHouseCheckpointPlaintext).not.toHaveBeenCalled();
  });

  it('will not open a snapshot sealed under a key this device does not hold', async () => {
    // The rotation trap: the home moved to a new epoch, the newest snapshot is
    // still sealed under the old one, and a joiner handed only the current key
    // can read none of it.
    serveCheckpoint(sealHomeHistory(EXISTING_ROWS, generateHouseholdKeys(HOUSEHOLD_ID, 1)));
    sessionKeys = generateHouseholdKeys(HOUSEHOLD_ID, 2);

    await expect(tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID)).rejects.toThrow();
  });

  it('does not bootstrap a device that is still awaiting its key', async () => {
    (isAwaitingHouseEnrolment as jest.Mock).mockReturnValue(true);
    serveCheckpoint(sealHomeHistory());

    await expect(tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID)).resolves.toBe(false);
  });

  it('leaves a device that already has history alone', async () => {
    // `bootstrap` is for an EMPTY device. Installing over a ledger that has its
    // own writes would roll back ops this device authored and has not published.
    joinerVersionVector = { 'dev-joiner': 3, 'dev-owner': 42 };
    serveCheckpoint(sealHomeHistory());

    await expect(tryInstallLatestCheckpoint('bootstrap', HOUSEHOLD_ID)).resolves.toBe(false);
  });
});

describe('publishing the snapshot the joiner will need', () => {
  const publishedEpochKey = `lf.checkpoint.epoch:${HOUSEHOLD_ID}`;

  it('publishes when the log has grown past the watermark', async () => {
    (fetchLatestCheckpoint as jest.Mock).mockResolvedValue(null);

    await expect(maybePublishCheckpoint(HOUSEHOLD_ID)).resolves.toBe(true);
    expect(putCheckpointChunk).toHaveBeenCalled();
  });

  it('holds off when the newest generation is still current enough', async () => {
    const sealed = sealHomeHistory();
    (fetchLatestCheckpoint as jest.Mock).mockResolvedValue({
      generation: 4,
      chunkCount: sealed.chunks.length,
      expiresAt: new Date().toISOString(),
      manifest: sealed.manifest,
    });
    opsSinceCheckpoint = 3;
    storeMeta[publishedEpochKey] = '1';

    await expect(maybePublishCheckpoint(HOUSEHOLD_ID)).resolves.toBe(false);
    expect(putCheckpointChunk).not.toHaveBeenCalled();
  });

  it('publishes anyway when FORCED — the member being approved needs one now', async () => {
    // The ordinary gate is 100 ops, which an owner with a modest home never
    // clears, so the home can sit on a years-old generation while somebody is
    // about to bootstrap from it.
    const sealed = sealHomeHistory();
    (fetchLatestCheckpoint as jest.Mock).mockResolvedValue({
      generation: 4,
      chunkCount: sealed.chunks.length,
      expiresAt: new Date().toISOString(),
      manifest: sealed.manifest,
    });
    opsSinceCheckpoint = 3;
    storeMeta[publishedEpochKey] = '1';

    await expect(maybePublishCheckpoint(HOUSEHOLD_ID, { force: true })).resolves.toBe(true);
  });

  it('republishes on its own after a rotation, without anybody remembering to force it', async () => {
    // A checkpoint is sealed once and never re-sealed, so the moment the key
    // rotates the newest snapshot becomes unreadable to everyone holding only
    // the new key — including every future joiner.
    const sealed = sealHomeHistory();
    (fetchLatestCheckpoint as jest.Mock).mockResolvedValue({
      generation: 4,
      chunkCount: sealed.chunks.length,
      expiresAt: new Date().toISOString(),
      manifest: sealed.manifest,
    });
    opsSinceCheckpoint = 3;
    storeMeta[publishedEpochKey] = '1';
    sessionKeys = generateHouseholdKeys(HOUSEHOLD_ID, 5);

    await expect(maybePublishCheckpoint(HOUSEHOLD_ID)).resolves.toBe(true);
    // …and records the epoch it published under, so it does not republish for
    // ever afterwards.
    expect(storeMeta[publishedEpochKey]).toBe('5');
  });

  it('is owner-only — a member must not publish the home’s snapshot', async () => {
    sessionRole = 'member';
    (fetchLatestCheckpoint as jest.Mock).mockResolvedValue(null);

    await expect(maybePublishCheckpoint(HOUSEHOLD_ID)).resolves.toBe(false);
    expect(putCheckpointChunk).not.toHaveBeenCalled();
  });

  it('lets FORCE past a stale local role flag, because the server already said owner', async () => {
    // Both forced callers have just had this device authorised as an owner by
    // the control plane — only an owner may approve an invite or revoke a
    // device — whereas `my_role` is a local string a restore can carry wrongly.
    // Trusting it there would skip the one publish a joining member depends on.
    sessionRole = 'member';
    (fetchLatestCheckpoint as jest.Mock).mockResolvedValue(null);

    await expect(maybePublishCheckpoint(HOUSEHOLD_ID, { force: true })).resolves.toBe(true);
  });

  it('never publishes from a device that is still awaiting its own key', async () => {
    (isAwaitingHouseEnrolment as jest.Mock).mockReturnValue(true);

    await expect(maybePublishCheckpoint(HOUSEHOLD_ID, { force: true })).resolves.toBe(false);
    expect(putCheckpointChunk).not.toHaveBeenCalled();
  });
});
