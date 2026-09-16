// Must precede @symply/local-first — @noble caches crypto at module load.
import './cryptoPolyfill';

import {
  MemoryLocalFirstStore,
  OpLog,
  aeadDecrypt,
  aeadEncrypt,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  createOpId,
  createUnlockMaterial,
  generateDeviceIdentity,
  generateHouseholdKeys,
  hexToBytes,
  minVersionVector,
  openRowBody,
  randomBytes,
  rowAad,
  sealRowBody,
  utf8Decode,
  utf8Encode,
  type CheckpointPlaintext,
  type DeviceIdentity,
  type HouseholdKeys,
  type LocalFirstStore,
  type RowKeyRef,
  type StoredOperation,
  type StoredRowRecord,
  type VersionVector,
} from '@symply/local-first';

import { HealthLocalEnrolmentPendingError, HealthLocalNotReadyError } from './errors';
import { openHealthLocalFirstStore } from './health-local-first-store';
import { isoNow, newLocalId } from './ids';
import { clearLocalHealthPersistence, loadDbKeyHex, saveDbKeyHex } from './persistence';
import {
  ALWAYS_RESIDENT_BUCKET,
  applyLedgerDelta,
  bucketsForRange,
  captureLedgerSnapshot,
  chunkLedgerDelta,
  collectRowWrites,
  decodeLedgerOpPayload,
  diffLedger,
  drainParkedRows,
  encodeLedgerOpPayload,
  installRowEnvelopes,
  mergeRowEnvelopes,
  RESTORE_HLC,
  residentBuckets,
  restoreDeltaFromBackup,
  type LedgerConflict,
  type LedgerDelta,
  type LedgerLww,
  type RowEnvelope,
} from './projection';
import {
  HEALTH_LEDGER_TABLE_KEYS,
  HEALTH_LEDGER_TABLE_NAMES,
  type HealthLedgerTableName,
} from './schema';
import type {
  LocalBodyMeasurement,
  LocalHabitLog,
  LocalHealthEntry,
  LocalHealthGoal,
  LocalHealthHousehold,
  LocalNutritionEntry,
  LocalUserHabit,
  LocalWaterEntry,
  LocalWeightEntry,
} from './types';

export type * from './types';

/**
 * The Health Wave-A ledger — the 8 device-authoritative tables of ONE personal
 * household (plan §1.2, §1.5).
 *
 * Structurally this is House's `HouseLedger` with one difference that shapes the
 * whole file: **Health is a personal ledger.** One user, N devices, exactly one
 * household. House keeps `Map<householdId, EngineState>` because a member can
 * own one property and be a member of another; Health cannot have a second
 * household — He5 makes the control plane refuse a second `user_id` — so the
 * session below is a single `let state`, and every property-switching API House
 * exposes (`listLocalHouseProperties`, `activateLocalHouseProperty`,
 * `createLocalHouseProperty`, `removeLocalHouseProperty`, `getActiveHouseholdId`)
 * has no counterpart here. There is nothing to switch between.
 *
 * The second difference follows from the first: House distinguishes writers by
 * `memberId` (several people, one property). Health has one person, so the
 * writer identity that matters is the **device** — `deviceId` is what is
 * recorded as an op's `authorMemberId`, and what the local-echo guard in
 * `projectionFor` compares against. Using the user id there would make the
 * user's *other device* look like a local echo and silence every inbound
 * refresh (§7).
 */
export interface HealthLedger {
  version: 1;
  /** Control-plane binding — which personal household this ledger addresses. */
  household: LocalHealthHousehold;
  deviceId: string;
  // ---- Wave A, 8 tables (plan §1.5) ----
  weightEntries: LocalWeightEntry[];
  waterEntries: LocalWaterEntry[];
  nutritionEntries: LocalNutritionEntry[];
  healthEntries: LocalHealthEntry[];
  bodyMeasurements: LocalBodyMeasurement[];
  userHabits: LocalUserHabit[];
  habitLogs: LocalHabitLog[];
  healthGoals: LocalHealthGoal[];
  ops: StoredOperation[];
  /** Per-row/field merge watermarks for multi-device LWW (TRD §8.4). */
  lww?: LedgerLww;
  /** Auto-merges that discarded a device's intent, for the UI. */
  conflicts?: LedgerConflict[];
  /** Set between claiming a device-enrolment invite and receiving the HDK. */
  pendingEnrolment?: boolean;
  /** Persisted crypto material (required for multi-device sync). */
  crypto?: {
    signingPrivateKeyHex: string;
    signingPublicKeyHex: string;
    agreementPrivateKeyHex: string;
    agreementPublicKeyHex: string;
    hdkHex: string;
    keyEpoch: number;
    /**
     * Superseded HDKs, `epoch → hex` (plan §8; House H6 §8.2). Absent entirely
     * until this device has rotated at least once, so a session persisted
     * before the ring existed reads back unchanged.
     */
    retiredHdksByEpoch?: Record<string, string>;
  };
}

/**
 * How many superseded HDKs this device keeps beside the live one.
 *
 * Blobs are the first HDK-sealed data on this side that is *durable* rather
 * than transient — rows are sealed under the device-local DEK, ops expire with
 * the mailbox TTL, checkpoints are republished under the new epoch — so a
 * rotation that discarded the outgoing key would make every body photo and
 * clinical document uploaded before it permanently unopenable, on every device
 * except one that happens to still hold the plaintext in its cache.
 *
 * House retains every epoch it has ever held. Health bounds the ring, and the
 * reason is the material rather than the memory: each retained key is one more
 * copy of something that decrypts the member's records, living in the identity
 * record for the life of the install. Eight covers eight rotations — a personal
 * household rotates on a lost or revoked device, not on a schedule — and the
 * OLDEST epoch is dropped first, so what a bounded ring can lose is an
 * attachment sealed more than eight rotations ago. That read then refuses with
 * `HealthBlobKeyUnavailableError` rather than returning wrong bytes.
 */
export const HEALTH_RETAINED_KEY_EPOCHS = 8;

/** Every Wave-A table, empty. One place to add a table, not eight. */
export function emptyHealthTables(): Pick<HealthLedger, HealthLedgerTableName> {
  return {
    weightEntries: [],
    waterEntries: [],
    nutritionEntries: [],
    healthEntries: [],
    bodyMeasurements: [],
    userHabits: [],
    habitLogs: [],
    healthGoals: [],
  };
}

/**
 * Backfill every table a persisted snapshot may predate.
 *
 * Wave B (HealthKit ingest) and Wave C (cycle / mens-health) add tables to this
 * ledger at He11; a device that opens a Wave-A snapshot on a Wave-C build must
 * not find `undefined` where the projection expects an array.
 */
function normalizeLedger(ledger: HealthLedger): HealthLedger {
  const empty = emptyHealthTables();
  const tables = {} as Pick<HealthLedger, HealthLedgerTableName>;
  for (const table of Object.keys(empty) as HealthLedgerTableName[]) {
    const current = ledger[table];
    (tables as Record<string, unknown>)[table] = Array.isArray(current) ? current : [];
  }
  return {
    ...ledger,
    ...tables,
    lww: ledger.lww ?? {},
    conflicts: ledger.conflicts ?? [],
    pendingEnrolment: ledger.pendingEnrolment ?? false,
  };
}

/**
 * Which slice of the on-disk ledger is decrypted into memory right now.
 *
 * Present only while the ledger is PARTIAL. `EngineState.resident === null`
 * means "everything on disk is in memory" — the state a minted household, a
 * freshly installed checkpoint and an explicitly full hydration are all in — and
 * every guard in this file short-circuits on it. Two states, and the null one is
 * always the safe one: a bug that leaves residency tracking behind degrades to
 * today's unwindowed behaviour rather than to invisible rows.
 */
type HealthResidency = {
  /** `'YYYY-MM'` buckets already decrypted. Global, not per table — one store read covers all eight. */
  buckets: Set<string>;
  /**
   * Which buckets EXIST on disk per table, newest first, `'*'` excluded.
   * Loaded on first use rather than at cold open, because the common session
   * never widens and would pay a query for nothing.
   *
   * Safe to cache for the session: the only writers that can create a bucket
   * this map has never seen are (a) a local write, which puts its own rows in
   * memory, and (b) an inbound op, which `hydrateRowsForDelta` brings in by key.
   * Neither needs the census to find it.
   */
  census: Map<HealthLedgerTableName, string[]> | null;
};

/**
 * The one open session. `dbKey`, `store` and `identity` are device-scoped;
 * `householdKeys` (the HDK), the OpLog and the ledger belong to the single
 * personal household.
 */
type EngineState = {
  householdId: string;
  dbKey: Uint8Array;
  store: LocalFirstStore;
  identity: DeviceIdentity;
  householdKeys: HouseholdKeys;
  /**
   * HDKs this device held before the current epoch, `epoch → key`, bounded by
   * {@link HEALTH_RETAINED_KEY_EPOCHS}. Household-scoped like `householdKeys`
   * itself — there is only ever one household here, so unlike House there is no
   * second ring to keep apart.
   */
  retiredHouseholdKeys: Map<number, Uint8Array>;
  opLog: OpLog;
  ledger: HealthLedger;
  /**
   * False until this household's rows have been decrypted into memory. Kept
   * from House because the build/hydrate split is still useful on this side: a
   * background wake needs the OpLog and the sync cursors, not 10 years of rows
   * (House H10 measured cold open at 34–37 µs/row).
   */
  hydrated: boolean;
  /** Null when the ledger is whole in memory — see {@link HealthResidency}. */
  resident: HealthResidency | null;
  /** Set between claiming a device-enrolment invite and receiving the HDK. */
  awaitingKeys: boolean;
  /** Remote deltas merged but not yet persisted. */
  pendingRemoteDeltas: LedgerDelta[];
  /**
   * Version vector of the checkpoint this session most recently EXPORTED.
   *
   * The compaction watermark must describe what a published checkpoint actually
   * contains. Reading the live version vector at publish time would overstate it
   * by any op that landed between export and publish, and compaction would then
   * truncate ops no checkpoint holds. See `rememberPublishedHealthCheckpoint`.
   */
  lastExportedCheckpointVv: VersionVector | null;
};

let state: EngineState | null = null;

/**
 * Bumped whenever the projections change, so screens that read the ledger
 * synchronously can re-hydrate instead of serving a stale snapshot.
 */
let ledgerRevision = 0;

/**
 * Listeners receive WHICH TABLES moved and WHERE the change came from — never
 * row data, which would make the refresh bridge an analytics/log leak surface
 * (plan §7, §15).
 *
 * House carries `householdId` here because a background property must not
 * repaint the property the member is looking at. Health has exactly one
 * household, so that field would always be the same value; what a Health
 * subscriber needs instead is `origin`, because the four origins are treated
 * differently (plan §7 refresh contract):
 *
 *  - `'local'`  — this device's own write. A **no-op for subscribers**: the
 *                 screen that saved already rendered it, and fanning out here
 *                 refetches on every keystroke-sized save.
 *  - `'ingest'` — also this device (a HealthKit drain writes through
 *                 `mutateLocalHealthLedger`), but **no screen rendered it**,
 *                 which is the entire premise of the `'local'` no-op. Fans out.
 *  - `'inbound'`— a peer device's op merged in.
 *  - `'restore'`— session lifecycle / whole-ledger replacement, always paired
 *                 with the full table list.
 *
 * An empty `tables` array means "something changed but not a table" — a
 * conflict list cleared — and intersects no screen's table set, so it is a
 * revision bump rather than a data invalidation.
 */
export type HealthLedgerChange = {
  revision: number;
  tables: readonly HealthLedgerTableName[];
  origin: 'local' | 'ingest' | 'inbound' | 'restore';
};

const ledgerListeners = new Set<(change: HealthLedgerChange) => void>();

export function getHealthLedgerRevision(): number {
  return ledgerRevision;
}

export function subscribeToHealthLedgerChanges(
  listener: (change: HealthLedgerChange) => void,
): () => void {
  ledgerListeners.add(listener);
  return () => {
    ledgerListeners.delete(listener);
  };
}

/** Tables a delta actually touched — upserts and tombstones alike. */
function tablesInDelta(delta: LedgerDelta): HealthLedgerTableName[] {
  const touched = new Set<HealthLedgerTableName>();
  for (const table of Object.keys(delta.u ?? {}) as HealthLedgerTableName[]) touched.add(table);
  for (const table of Object.keys(delta.d ?? {}) as HealthLedgerTableName[]) touched.add(table);
  return [...touched];
}

/**
 * Fire-and-forget by contract: never awaited inside the projection apply loop,
 * and a throwing subscriber must not abort the merge that produced the change.
 */
function notifyLedgerChanged(
  tables: readonly HealthLedgerTableName[] = [],
  origin: HealthLedgerChange['origin'] = 'local',
): void {
  ledgerRevision += 1;
  const change: HealthLedgerChange = { revision: ledgerRevision, tables, origin };
  for (const listener of ledgerListeners) {
    try {
      listener(change);
    } catch (error) {
      console.warn('[HealthLocal] ledger listener failed', error);
    }
  }
}

/**
 * Projection handler wired into the OpLog so *every* verified op — local echo
 * and peer alike — merges into the ledger under LWW.
 *
 * Bound to a household id rather than reading `state` blindly: an OpLog built
 * before an account switch can still be referenced by an in-flight sync, and
 * merging its ops into the ledger that replaced it is exactly the cross-account
 * row bleed that would be invisible until two devices diverged.
 */
function projectionFor(householdId: string) {
  return {
    async apply(args: {
      opId: string;
      opType: string;
      entityType: string;
      entityId: string;
      plaintextPayload: Uint8Array;
      authorMemberId: string;
      hlc: string;
    }): Promise<void> {
      const session = state;
      if (!session || session.householdId !== householdId) return;
      let delta;
      try {
        delta = decodeLedgerOpPayload(JSON.parse(utf8Decode(args.plaintextPayload)));
      } catch {
        console.warn('[HealthLocal] unparsable op payload', args.opId, args.opType);
        return;
      }
      if (!delta) return;

      // A windowed ledger may not hold the rows this delta edits. Bring them in
      // BEFORE merging — see `hydrateRowsForDelta`, which is where the reason
      // this is not optional is written down.
      await hydrateRowsForDelta(session, delta);

      // DEVICE, not user: in a personal household every op carries the same
      // user, so comparing user ids would classify the user's other device as a
      // local echo and no inbound refresh would ever fire.
      const isLocalEcho = args.authorMemberId === session.ledger.deviceId;
      const result = applyLedgerDelta(session.ledger, delta, {
        hlc: args.hlc,
        authorMemberId: args.authorMemberId,
        opId: args.opId,
      });
      if (!isLocalEcho) {
        session.pendingRemoteDeltas.push(delta);
        if (result.applied > 0 || result.deleted > 0) {
          notifyLedgerChanged(tablesInDelta(delta), 'inbound');
        }
      }
    },
  };
}

function requireEngine(): EngineState {
  if (!state) {
    throw new HealthLocalNotReadyError();
  }
  return state;
}

export function isLocalHealthSessionOpen(): boolean {
  return state !== null;
}

export function getLocalHealthLedger(): HealthLedger {
  return requireEngine().ledger;
}

/** This device's id — the author identity on every op this device writes. */
export function getLocalHealthDeviceId(): string {
  return requireEngine().ledger.deviceId;
}

export function getLocalHealthIdentity(): DeviceIdentity {
  return requireEngine().identity;
}

export function getLocalHealthHouseholdKeys(): HouseholdKeys {
  return requireEngine().householdKeys;
}

/**
 * The HDK for a SUPERSEDED epoch, or null when this device does not hold it.
 *
 * One key by epoch rather than the whole ring: the only legitimate caller is
 * the blob reader resolving a descriptor sealed before a rotation, and handing
 * out the full set would make "which key opened this" a caller's decision.
 *
 * Null has two causes, and neither is recoverable here: this device enrolled
 * after that rotation, or the epoch aged out of the bounded ring. The user's
 * other, longer-lived device may still be able to open those bytes.
 */
export function getLocalHealthRetiredHouseholdKey(keyEpoch: number): Uint8Array | null {
  return requireEngine().retiredHouseholdKeys.get(keyEpoch) ?? null;
}

/** Epochs currently in the ring, oldest first — diagnostics and tests. */
export function getLocalHealthRetiredKeyEpochs(): number[] {
  return [...requireEngine().retiredHouseholdKeys.keys()].sort((a, b) => a - b);
}

export function getLocalHealthOpLog(): OpLog {
  return requireEngine().opLog;
}

export function getLocalHealthStore(): LocalFirstStore {
  return requireEngine().store;
}

/**
 * True between claiming a device-enrolment invite and receiving the household
 * data key. While set, this device holds the joined household id but still its
 * own pre-join HDK, so it must not author ops — they would be undecryptable by
 * the other device AND by this one once the real key installs.
 */
export function isAwaitingHealthEnrolment(): boolean {
  return state?.awaitingKeys === true;
}

/**
 * Install the HDK received from the user's already-enrolled device. Rebuilds the
 * OpLog, because both the key and the epoch it seals under change.
 *
 * Takes hex + epoch rather than House's `HouseholdKeys`: the key arrives over
 * the mailbox as a hex string, and the household id is not the caller's to
 * choose — it is whichever household this session is already bound to.
 *
 * **Retire, do not discard.** A rotation replaces the HDK with fresh random
 * bytes while every attachment already on the relay stays sealed under the
 * outgoing one, so dropping it here is what silently destroys a body photo.
 * Only a STRICTLY OLDER epoch retires: enrolment installs the first key through
 * this same function and HDK re-delivery replays the current one, and neither
 * is a rotation — retiring in either case would persist a meaningless entry or
 * shadow the live key with a copy of itself.
 */
export async function installHealthHouseholdKeys(input: {
  hdkHex: string;
  keyEpoch: number;
}): Promise<void> {
  const session = requireEngine();
  const next: HouseholdKeys = {
    householdId: session.householdId,
    hdk: hexToBytes(input.hdkHex),
    keyEpoch: input.keyEpoch,
  };
  const previous = session.householdKeys;
  if (previous?.hdk?.length && previous.keyEpoch < next.keyEpoch) {
    session.retiredHouseholdKeys.set(previous.keyEpoch, previous.hdk);
    pruneRetiredKeys(session.retiredHouseholdKeys);
  }
  session.householdKeys = next;
  session.awaitingKeys = false;
  session.ledger.pendingEnrolment = false;
  session.opLog = new OpLog({
    store: session.store,
    identity: session.identity,
    householdKeys: next,
    projection: projectionFor(session.householdId),
  });
  session.ledger.crypto = cryptoBundle(session.identity, next, session.retiredHouseholdKeys);
  await persistSession(session, null);
  // Enrolment completing is a session-lifecycle event, not a delta: the screens
  // that mounted while writes were paused have to converge without a navigation
  // event, and the peer's history is about to arrive behind them.
  notifyLedgerChanged(HEALTH_LEDGER_TABLE_NAMES, 'restore');
}

/**
 * Drop the oldest epochs until the ring is within {@link
 * HEALTH_RETAINED_KEY_EPOCHS}. Mutates in place.
 *
 * Sorted by epoch rather than trusting insertion order: a cold open rebuilds
 * the ring from a JSON object whose key order is not the rotation order, and
 * evicting by that order would drop an arbitrary key instead of the oldest.
 */
function pruneRetiredKeys(retired: Map<number, Uint8Array>): void {
  if (retired.size <= HEALTH_RETAINED_KEY_EPOCHS) return;
  const oldestFirst = [...retired.keys()].sort((a, b) => a - b);
  for (const epoch of oldestFirst.slice(0, retired.size - HEALTH_RETAINED_KEY_EPOCHS)) {
    retired.delete(epoch);
  }
}

function cryptoBundle(
  identity: DeviceIdentity,
  householdKeys: HouseholdKeys,
  retired?: ReadonlyMap<number, Uint8Array>,
) {
  const retiredHdksByEpoch: Record<string, string> = {};
  for (const [epoch, hdk] of retired ?? []) {
    retiredHdksByEpoch[String(epoch)] = bytesToHex(hdk);
  }
  return {
    signingPrivateKeyHex: bytesToHex(identity.signingPrivateKey),
    signingPublicKeyHex: bytesToHex(identity.signingPublicKey),
    agreementPrivateKeyHex: bytesToHex(identity.agreementPrivateKey),
    agreementPublicKeyHex: bytesToHex(identity.agreementPublicKey),
    hdkHex: bytesToHex(householdKeys.hdk),
    keyEpoch: householdKeys.keyEpoch,
    // Omitted entirely when nothing has rotated: a device that never rotated
    // keeps the exact on-disk shape it had before the ring existed.
    ...(Object.keys(retiredHdksByEpoch).length > 0 ? { retiredHdksByEpoch } : {}),
  };
}

/**
 * Rebuild the ring from a persisted crypto bundle — the cold-open half.
 *
 * Tolerant by design: a bundle written before the ring existed simply has no
 * field, and a malformed entry is skipped rather than thrown on, because
 * failing here would make the whole session unopenable to save one attachment.
 */
function retiredKeysFromCrypto(
  crypto: NonNullable<HealthLedger['crypto']> | undefined,
): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  for (const [epoch, hex] of Object.entries(crypto?.retiredHdksByEpoch ?? {})) {
    const parsed = Number(epoch);
    if (!Number.isInteger(parsed) || !hex) continue;
    try {
      out.set(parsed, hexToBytes(hex));
    } catch {
      console.warn('[HealthLocal] skipping unreadable retired key epoch', epoch);
    }
  }
  // A bundle written by a build with a larger bound must not reinstate it.
  pruneRetiredKeys(out);
  return out;
}

function identityFromCrypto(
  deviceId: string,
  crypto: NonNullable<HealthLedger['crypto']>,
): DeviceIdentity {
  return {
    deviceId,
    signingPrivateKey: hexToBytes(crypto.signingPrivateKeyHex),
    signingPublicKey: hexToBytes(crypto.signingPublicKeyHex),
    agreementPrivateKey: hexToBytes(crypto.agreementPrivateKeyHex),
    agreementPublicKey: hexToBytes(crypto.agreementPublicKeyHex),
  };
}

/**
 * Identity record, keyed by household exactly as House keys it. The family
 * layout is kept rather than flattened so the on-disk shape stays readable
 * beside the sibling apps; the id itself comes from `HOUSEHOLD_META`, which is
 * what a cold open reads first.
 */
const identityMetaKey = (householdId: string) => `ledger.identity.v2:${householdId}`;
/** The account this device's ledger belongs to — the different-user guard. */
const MEMBER_META = 'ledger.member_id';
const HOUSEHOLD_META = 'ledger.household_id';
const IDENTITY_AAD = utf8Encode('lf-meta:identity');

type PersistedIdentity = {
  household: LocalHealthHousehold;
  deviceId: string;
  pendingEnrolment?: boolean;
  conflicts?: LedgerConflict[];
  crypto?: HealthLedger['crypto'];
};

async function persistIdentity(session: EngineState): Promise<void> {
  session.ledger.crypto = cryptoBundle(
    session.identity,
    session.householdKeys,
    session.retiredHouseholdKeys,
  );
  const payload: PersistedIdentity = {
    household: session.ledger.household,
    deviceId: session.ledger.deviceId,
    pendingEnrolment: session.ledger.pendingEnrolment ?? false,
    conflicts: session.ledger.conflicts ?? [],
    crypto: session.ledger.crypto,
  };
  const sealed = aeadEncrypt(session.dbKey, utf8Encode(JSON.stringify(payload)), IDENTITY_AAD);
  await session.store.setMeta(identityMetaKey(session.householdId), bytesToBase64(sealed));
  await session.store.setMeta(MEMBER_META, session.ledger.household.userId);
  await session.store.setMeta(HOUSEHOLD_META, session.ledger.household.id);
}

function sealWrites(
  session: EngineState,
  writes: ReturnType<typeof collectRowWrites>,
  updatedHlc: string,
) {
  const householdId = session.ledger.household.id;
  const keyEpoch = session.householdKeys.keyEpoch;
  return writes.map((write) => {
    const sealed = sealRowBody(
      session.dbKey,
      utf8Encode(JSON.stringify(write.envelope)),
      rowAad(householdId, write.table, write.rowKey, keyEpoch),
    );
    return {
      householdId,
      table: write.table,
      rowKey: write.rowKey,
      bucket: write.bucket,
      deleted: write.deleted,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
      keyEpoch,
      updatedHlc,
    };
  });
}

async function persistRows(
  session: EngineState,
  delta: LedgerDelta | 'all' | null,
  opIds: readonly string[] = [],
): Promise<void> {
  await persistIdentity(session);
  if (delta) {
    const writes = collectRowWrites(session.ledger, delta);
    const hlc = session.ledger.ops[session.ledger.ops.length - 1]?.hlc ?? String(Date.now());
    await session.store.putRows(sealWrites(session, writes, hlc));
  }
  if (opIds.length > 0) {
    await session.store.markProjected(opIds, Date.now());
  }
}

async function persistSession(
  session: EngineState,
  delta: LedgerDelta | 'all' | null = 'all',
  opIds: readonly string[] = [],
): Promise<void> {
  await session.store.runInTransaction(async () => {
    await persistRows(session, delta, opIds);
  });
}

async function persist(
  delta: LedgerDelta | 'all' | null = 'all',
  opIds: readonly string[] = [],
): Promise<void> {
  await persistSession(requireEngine(), delta, opIds);
}

async function loadIdentity(
  store: LocalFirstStore,
  dbKey: Uint8Array,
  householdId: string,
): Promise<PersistedIdentity | null> {
  const sealedB64 = await store.getMeta(identityMetaKey(householdId));
  if (!sealedB64) return null;
  try {
    const plain = aeadDecrypt(dbKey, base64ToBytes(sealedB64), IDENTITY_AAD);
    return JSON.parse(utf8Decode(plain)) as PersistedIdentity;
  } catch {
    return null;
  }
}

type HealthRowEnvelopeWrite = {
  table: HealthLedgerTableName;
  rowKey: string;
  deleted: boolean;
  envelope: RowEnvelope;
};

/**
 * Decrypt sealed records into envelopes. The single AEAD loop in this file, and
 * the one He10 §4 measured at 86% of first paint — every caller that wants rows
 * in memory pays here, so there is exactly one place to count.
 */
function openStoredRows(
  session: Pick<EngineState, 'dbKey'>,
  stored: readonly StoredRowRecord[],
): HealthRowEnvelopeWrite[] {
  const writes: HealthRowEnvelopeWrite[] = [];
  for (const row of stored) {
    try {
      // `row.keyEpoch`, not the session's: rows sealed before a key rotation
      // carry the epoch they were sealed under, and it is part of their AAD.
      const plain = openRowBody(
        session.dbKey,
        row.nonce,
        row.ciphertext,
        rowAad(row.householdId, row.table, row.rowKey, row.keyEpoch),
      );
      writes.push({
        table: row.table as HealthLedgerTableName,
        rowKey: row.rowKey,
        deleted: row.deleted,
        envelope: JSON.parse(utf8Decode(plain)) as RowEnvelope,
      });
    } catch {
      console.warn('[HealthLocal] skipping undecryptable row', row.table, row.rowKey);
    }
  }
  return writes;
}

/**
 * Cold open — decrypt this household's rows into memory.
 *
 * **Windowed when the schema says so** (`residentWindowDays`, He10 §4). The
 * store adds `'*'` and every tombstone to whatever bucket list it is given, so
 * `userHabits`, `healthGoals` and the whole delete-vs-edit rule are inside the
 * window by construction — not by anyone remembering to list them. What is left
 * outside is exactly one thing: live rows of the five dated log tables, older
 * than the window, whose bodies are still on disk and are brought back by
 * `ensureHealthRowsResident` the moment a read or a merge addresses them.
 *
 * A brand that passes no window (Budget, House) takes the `null` branch and
 * reads every row, unchanged.
 */
async function loadRowsIntoLedger(session: EngineState): Promise<number> {
  const buckets = residentBuckets();
  const stored = await session.store.listRows({
    householdId: session.ledger.household.id,
    ...(buckets ? { buckets } : {}),
  });
  const writes = openStoredRows(session, stored);
  installRowEnvelopes(session.ledger, writes);
  session.resident = buckets ? { buckets: new Set(buckets), census: null } : null;
  return writes.length;
}

/** `YYYY-MM-DD` today, local — the same day key every dated Health row carries. */
function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** True when this key has never been loaded — `lww` presence IS residency. */
function isRowResident(ledger: HealthLedger, table: string, rowKey: string): boolean {
  return (ledger.lww as Record<string, Record<string, unknown>> | undefined)?.[table]?.[rowKey] !==
    undefined;
}

/**
 * Decrypt and merge a set of sealed records that are not in memory yet.
 *
 * Records already resident are dropped BEFORE the AEAD open, not after. That
 * matters: a bucket read always returns `'*'` and every tombstone alongside the
 * month asked for, so widening by one month would otherwise re-decrypt the
 * whole always-resident set each time — paying the cold-open cost again, once
 * per widening, for rows that never left memory.
 */
function mergeStoredRows(session: EngineState, stored: readonly StoredRowRecord[]): number {
  const pending = stored.filter((row) => !isRowResident(session.ledger, row.table, row.rowKey));
  if (pending.length === 0) return 0;
  return mergeRowEnvelopes(session.ledger, openStoredRows(session, pending));
}

/**
 * Buckets bound per `listRows` call. A caller may legitimately ask for a range
 * spanning the whole account (`listNutrition({ to })` with no `from`), and
 * SQLITE_MAX_VARIABLE_NUMBER is 999 on the oldest builds still shipping — a
 * decade of months plus the household id is close enough to that to be worth
 * not finding out on a user's phone.
 */
const HYDRATE_BUCKET_CHUNK = 200;

/** Load whole `'YYYY-MM'` buckets and mark them resident. */
async function hydrateBuckets(session: EngineState, buckets: readonly string[]): Promise<number> {
  const resident = session.resident;
  if (!resident || buckets.length === 0) return 0;
  const wanted = buckets.filter((bucket) => !resident.buckets.has(bucket));
  if (wanted.length === 0) return 0;
  let installed = 0;
  for (let i = 0; i < wanted.length; i += HYDRATE_BUCKET_CHUNK) {
    const stored = await session.store.listRows({
      householdId: session.ledger.household.id,
      buckets: wanted.slice(i, i + HYDRATE_BUCKET_CHUNK),
    });
    installed += mergeStoredRows(session, stored);
  }
  // Marked resident even when the read returned nothing: an empty month is
  // still a month this session has answered for, and re-asking would make every
  // scroll through a quiet year a query per screen.
  for (const bucket of wanted) resident.buckets.add(bucket);
  return installed;
}

/** `(table, bucket)` census, newest bucket first, `'*'` excluded. Cached per session. */
async function ensureCensus(
  session: EngineState,
): Promise<Map<HealthLedgerTableName, string[]>> {
  const resident = session.resident;
  if (resident?.census) return resident.census;
  const counts = await session.store.listRowBuckets(session.ledger.household.id);
  const census = new Map<HealthLedgerTableName, string[]>();
  for (const entry of counts) {
    if (entry.bucket === ALWAYS_RESIDENT_BUCKET) continue;
    if (!(entry.table in HEALTH_LEDGER_TABLE_KEYS)) continue;
    const table = entry.table as HealthLedgerTableName;
    const list = census.get(table);
    if (list) list.push(entry.bucket);
    else census.set(table, [entry.bucket]);
  }
  for (const list of census.values()) list.sort((a, b) => b.localeCompare(a));
  if (resident) resident.census = census;
  return census;
}

/**
 * What a caller needs resident before it reads. One entry per ledger table the
 * read touches — the same granularity `windows.ts` records a read at.
 */
export type HealthResidencyNeed = {
  table: HealthLedgerTableName;
  /** Inclusive day range, `YYYY-MM-DD`. Omit `from` for "back to the beginning". */
  from?: string;
  to?: string;
  /**
   * An undated row cap — `loadWeightLog`'s newest 500, `loadWorkouts`' newest
   * 400. Older buckets are hydrated one at a time until this many rows are in
   * memory or the table runs out, which is what makes a row-window read return
   * the same set it returned before the ledger was windowed.
   */
  minRows?: number;
  /**
   * Upper bound on the `minRows` walk, `YYYY-MM-DD`: only buckets at or before
   * this day are considered.
   *
   * The lookback reads need it. `dailySummary('2023-04-12')` wants the newest
   * weigh-in **on or before** that day; without a bound the walk starts at the
   * newest bucket on disk and hydrates two years of months it will then filter
   * straight back out. With it, the walk starts where the answer can be.
   */
  before?: string;
  /**
   * Counts what `minRows` is counting. Defaults to every live row of the table;
   * a read with a `rowFilter` (workouts out of `healthEntries`) or a date bound
   * must pass the matching count, or it stops widening far too early.
   */
  count?: (ledger: HealthLedger) => number;
};

function liveRowCount(ledger: HealthLedger, table: HealthLedgerTableName): number {
  const rows = (ledger as unknown as Record<string, unknown>)[table];
  if (!Array.isArray(rows)) return 0;
  let live = 0;
  for (const row of rows as Array<{ deleted_at?: unknown }>) {
    if (row.deleted_at == null) live += 1;
  }
  return live;
}

/**
 * Widen the resident window until `needs` are satisfied — **the read half of
 * the He10 §4 cold-open mitigation, and the half that makes it a mitigation
 * rather than data loss.**
 *
 * Every local facade read that can address a date outside the window calls this
 * first. The contract it upholds is blunt: *a windowed ledger returns the same
 * rows an unwindowed one would.* The window changes WHEN a row is decrypted,
 * never WHETHER it can be seen. A user scrolling to a weigh-in from three years
 * ago hydrates the month it lives in and sees it; the alternative — answering
 * from what happens to be in memory — is a chart that silently ends.
 *
 * No-op on a fully resident ledger (`resident === null`), which is every Budget
 * and House session and every Health session that has been hydrated whole.
 */
export async function ensureHealthRowsResident(
  needs: readonly HealthResidencyNeed[],
): Promise<void> {
  const session = state;
  if (!session?.resident || needs.length === 0) return;

  // Ranges first, and batched: Home fires seventeen loaders at once and they
  // overlap heavily, so one read for the union beats one read per loader.
  const missing = new Set<string>();
  let census: Map<HealthLedgerTableName, string[]> | null = null;
  for (const need of needs) {
    if (need.from === undefined && need.to === undefined) continue;
    let from = need.from;
    if (from === undefined) {
      // "Everything up to `to`" — the oldest bucket the table actually has.
      // Indexed rather than `.at(-1)`: this file runs on Hermes, which has no
      // JIT and a deliberately small builtin surface, and the sibling engines
      // avoid it for the same reason.
      census ??= await ensureCensus(session);
      const buckets = census.get(need.table) ?? [];
      const oldest = buckets.length > 0 ? buckets[buckets.length - 1] : undefined;
      if (oldest === undefined) continue;
      from = `${oldest}-01`;
    }
    for (const bucket of bucketsForRange(from, need.to ?? todayKey())) {
      if (!session.resident.buckets.has(bucket)) missing.add(bucket);
    }
  }
  if (missing.size > 0) await hydrateBuckets(session, [...missing]);

  // Row caps second, one bucket at a time. The count has to be re-taken after
  // each widening — a month of `healthEntries` holds ~77 rows but only ~19
  // workouts, so any attempt to predict from the census undershoots.
  for (const need of needs) {
    const minRows = need.minRows;
    if (minRows === undefined) continue;
    const counter = need.count ?? ((ledger: HealthLedger) => liveRowCount(ledger, need.table));
    if (counter(session.ledger) >= minRows) continue;
    census ??= await ensureCensus(session);
    const ceiling = need.before?.slice(0, 7);
    for (const bucket of census.get(need.table) ?? []) {
      if (ceiling !== undefined && bucket > ceiling) continue;
      if (session.resident.buckets.has(bucket)) continue;
      await hydrateBuckets(session, [bucket]);
      if (counter(session.ledger) >= minRows) break;
    }
  }
}

/**
 * Bring the WHOLE ledger into memory, then stop windowing this session.
 *
 * For the operations that read across the entire history and cannot express
 * that as a window: backup restore (whose delta is diffed against the live
 * ledger, so a row it cannot see reads as a create and an ancient restore stamp
 * would then win every field of a row it never compared against).
 *
 * The He9 archive does NOT need it: `exportHealthCheckpointPlaintext` reads the
 * store directly and unwindowed, so a backup is complete whatever is resident.
 *
 * ⚠️ **Wave D owes this a third caller.** `collectHealthBlobRefs`
 * (`blobs/healthBlobStore.ts`) walks the in-memory ledger for attachment
 * descriptors and treats what it does not find as an orphan to reclaim. No Wave
 * A table carries an attachment column today, so it finds nothing either way —
 * but the first table that does must hydrate whole before reconciling, or a
 * body photo from four years ago is deleted for not being in this month's
 * window. Rare, deliberately expensive, and always preferable to a merge that
 * decides against rows it did not load.
 */
export async function hydrateWholeHealthLedger(): Promise<void> {
  const session = state;
  if (!session?.resident) return;
  const stored = await session.store.listRows({ householdId: session.ledger.household.id });
  mergeStoredRows(session, stored);
  session.resident = null;
}

/**
 * Bring every row an incoming delta addresses into memory — **before** it is
 * merged.
 *
 * This is the correctness half of windowing, and skipping it is not a
 * performance regression but silent, permanent data loss. Concretely: a peer
 * patches a meal from 2023. That row is on disk but outside the window, so
 * `applyLedgerDelta` finds no target and no `n:1`, parks the patch as an orphan
 * — and `collectRowWrites` then persists the parked shadow with `row: null`,
 * overwriting the real sealed body. The meal is gone from every device, and
 * nothing anywhere reports it.
 *
 * Hydrating first also restores the merge inputs the LWW rules need: the row's
 * field stamps (so a peer's older edit loses instead of winning) and its
 * tombstone state. Tombstones are always resident anyway, so this is only ever
 * about live rows.
 *
 * Costs one Map lookup per touched key when everything is already resident,
 * which is the overwhelming majority of traffic — a peer edits today's rows.
 */
async function hydrateRowsForDelta(session: EngineState, delta: LedgerDelta): Promise<void> {
  if (!session.resident) return;
  const keys: RowKeyRef[] = [];
  for (const [table, rows] of Object.entries(delta.u ?? {}) as Array<
    [string, Array<{ k: string }>]
  >) {
    for (const row of rows) {
      if (!isRowResident(session.ledger, table, row.k)) keys.push({ table, rowKey: row.k });
    }
  }
  for (const [table, rowKeys] of Object.entries(delta.d ?? {}) as Array<[string, string[]]>) {
    for (const rowKey of rowKeys) {
      if (!isRowResident(session.ledger, table, rowKey)) keys.push({ table, rowKey });
    }
  }
  if (keys.length === 0) return;
  // `keys`, not `buckets`: the delta names row keys and nothing in it reveals
  // which month they belong to. A patch carries only the fields that changed.
  const stored = await session.store.listRows({
    householdId: session.ledger.household.id,
    keys,
  });
  mergeStoredRows(session, stored);
}

async function replayUnprojected(session: EngineState): Promise<void> {
  const pending = await session.store.listUnprojectedOperations(session.ledger.household.id);
  if (pending.length === 0) return;
  for (const op of pending) {
    try {
      const aad = utf8Encode(`${op.householdId}:${op.keyEpoch}:${op.opId}`);
      const plaintext = aeadDecrypt(session.householdKeys.hdk, op.payload, aad);
      const delta = decodeLedgerOpPayload(JSON.parse(utf8Decode(plaintext)));
      if (!delta) continue;
      await hydrateRowsForDelta(session, delta);
      applyLedgerDelta(session.ledger, delta, {
        hlc: op.hlc,
        authorMemberId: op.authorMemberId,
        opId: op.opId,
      });
    } catch {
      console.warn('[HealthLocal] unprojected op failed to replay', op.opId);
    }
  }
  await persistRows(
    session,
    'all',
    pending.map((op) => op.opId),
  );
}

/**
 * The control-plane binding row: which personal household this ledger is, and
 * whose. Deliberately metadata-only — there is no member list, because He5
 * refuses a second `user_id` and Settings copy says "your other device".
 */
function buildHealthHousehold(id: string, userId: string): LocalHealthHousehold {
  return { id, userId, createdAt: isoNow() };
}

async function appendLedgerOp(
  session: EngineState,
  opType: string,
  entityType: string,
  entityId: string,
  payload: unknown,
  extra?: { hlc?: string },
): Promise<StoredOperation> {
  const stored = await session.opLog.append({
    opId: createOpId(),
    // The device is the author in a personal household — see `projectionFor`.
    authorMemberId: session.ledger.deviceId,
    parents: [],
    opType,
    entityType,
    entityId,
    plaintextPayload: utf8Encode(JSON.stringify(payload)),
    ...(extra?.hlc ? { hlc: extra.hlc } : {}),
  });
  session.ledger.ops.push(stored);
  return stored;
}

/**
 * Serializes session open/close. Both callers are floated promises, so a fast
 * sign-out/sign-in can otherwise run teardown and open concurrently and the
 * different-user guard never fires.
 */
let sessionChain: Promise<unknown> = Promise.resolve();

function queueSessionWork<T>(work: () => Promise<T>): Promise<T> {
  const next = sessionChain.then(work, work);
  // Keep the chain alive even when a link rejects; the caller still sees the error.
  sessionChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Open (or reopen) this device's personal ledger.
 *
 * `householdId` is the **join** signal, and the only one this engine gets: a
 * first device mints its own `hh_local_*` id and publishes it to the control
 * plane, exactly as House does, so a caller only knows a household id when the
 * user already has one — i.e. when this device is enrolling as a second device.
 * A session minted against a supplied id is therefore marked enrolment-pending
 * and refuses writes until `installHealthHouseholdKeys` delivers the real HDK.
 * Without that, this device would author ops under a placeholder key that
 * neither device can read afterwards — silent loss, where the pending error is
 * loud.
 *
 * A persisted binding always wins over the argument: rebinding a ledger that
 * already holds rows is an enrolment/adopt operation, and this API surface does
 * not model one.
 */
export function openLocalHealthSession(input: {
  userId: string;
  householdId?: string;
  deviceId?: string;
}): Promise<HealthLedger> {
  return queueSessionWork(() => openLocalHealthSessionInner(input));
}

/**
 * Build the session from disk WITHOUT decrypting its rows. Returns null when
 * this device holds no usable identity for that household.
 */
async function buildSessionFromDisk(input: {
  store: LocalFirstStore;
  dbKey: Uint8Array;
  householdId: string;
  userId: string;
}): Promise<EngineState | null> {
  const parsed = await loadIdentity(input.store, input.dbKey, input.householdId);
  if (!parsed?.crypto?.hdkHex || !parsed.crypto.signingPrivateKeyHex) return null;

  const deviceId = parsed.deviceId || `dev_${input.userId.slice(0, 8)}`;
  const identity = identityFromCrypto(deviceId, parsed.crypto);
  const householdKeys: HouseholdKeys = {
    householdId: parsed.household.id,
    hdk: hexToBytes(parsed.crypto.hdkHex),
    keyEpoch: parsed.crypto.keyEpoch ?? 1,
  };
  const opLog = new OpLog({
    store: input.store,
    identity,
    householdKeys,
    projection: projectionFor(parsed.household.id),
  });
  // Restored, not rebuilt: a cold open after a rotation must still be able to
  // open attachments sealed under the previous epoch.
  const retiredHouseholdKeys = retiredKeysFromCrypto(parsed.crypto);
  const ops = await input.store.listOperationsByHlc(parsed.household.id);
  const ledger: HealthLedger = normalizeLedger({
    version: 1,
    household: parsed.household,
    deviceId,
    ...emptyHealthTables(),
    ops,
    lww: {},
    conflicts: parsed.conflicts ?? [],
    pendingEnrolment: parsed.pendingEnrolment ?? false,
    crypto: cryptoBundle(identity, householdKeys, retiredHouseholdKeys),
  });
  return {
    householdId: parsed.household.id,
    dbKey: input.dbKey,
    store: input.store,
    identity,
    householdKeys,
    retiredHouseholdKeys,
    opLog,
    ledger,
    hydrated: false,
    // Set by `loadRowsIntoLedger` once it knows which buckets it read. Null
    // until then, which is the safe reading: nothing is windowed yet.
    resident: null,
    awaitingKeys: ledger.pendingEnrolment === true,
    pendingRemoteDeltas: [],
    lastExportedCheckpointVv: null,
  };
}

/** Decrypt the household's rows into memory, once. Idempotent. */
async function hydrateSession(session: EngineState): Promise<EngineState> {
  if (session.hydrated) return session;
  await loadRowsIntoLedger(session);
  await replayUnprojected(session);
  session.hydrated = true;
  return session;
}

async function openLocalHealthSessionInner(input: {
  userId: string;
  householdId?: string;
  deviceId?: string;
}): Promise<HealthLedger> {
  if (state) {
    // An open session belongs to ONE account. Returning it without checking who
    // asked would hand the new user the previous user's health history.
    if (state.ledger.household.userId === input.userId) {
      // Still notify: `ensureHealthLocalSession()` is idempotent and is called
      // again on every foreground, and a screen that mounted after the first
      // open has no other event to converge on (plan §7).
      notifyLedgerChanged(HEALTH_LEDGER_TABLE_NAMES, 'restore');
      return state.ledger;
    }
    console.log('[HealthLocal] session open for a different user — closing before reopen');
    await closeLocalHealthSessionInner();
  }

  let dbKeyHex = await loadDbKeyHex();
  let dbKey: Uint8Array;
  if (dbKeyHex) {
    dbKey = hexToBytes(dbKeyHex);
  } else {
    const material = createUnlockMaterial();
    dbKey = material.localDatabaseKey;
    await saveDbKeyHex(bytesToHex(dbKey));
  }

  const store = await openHealthLocalFirstStore(dbKey);
  const storedUserId = await store.getMeta(MEMBER_META);
  if (storedUserId && storedUserId !== input.userId) {
    console.log('[HealthLocal] different user on this device — resetting local ledger');
    await store.close();
    await clearLocalHealthPersistence();
    const material = createUnlockMaterial();
    dbKey = material.localDatabaseKey;
    dbKeyHex = bytesToHex(dbKey);
    await saveDbKeyHex(dbKeyHex);
    const fresh = await openHealthLocalFirstStore(dbKey);
    const minted = await mintPersonalHousehold(input, dbKey, fresh);
    // Account switch: every table just became a different person's data.
    notifyLedgerChanged(HEALTH_LEDGER_TABLE_NAMES, 'restore');
    return minted;
  }

  const persistedHouseholdId = await store.getMeta(HOUSEHOLD_META);
  if (persistedHouseholdId) {
    if (input.householdId && input.householdId !== persistedHouseholdId) {
      console.warn(
        '[HealthLocal] ignoring householdId argument — this device is already bound',
        persistedHouseholdId,
      );
    }
    const session = await buildSessionFromDisk({
      store,
      dbKey,
      householdId: persistedHouseholdId,
      userId: input.userId,
    });
    if (session) {
      state = session;
      await hydrateSession(session);
      // Cold start: screens that mounted before the ledger existed converge here
      // or never (plan §7 — omitting this leaves Home permanently empty).
      notifyLedgerChanged(HEALTH_LEDGER_TABLE_NAMES, 'restore');
      return session.ledger;
    }
  }

  const ledger = await mintPersonalHousehold(input, dbKey, store);
  notifyLedgerChanged(HEALTH_LEDGER_TABLE_NAMES, 'restore');
  return ledger;
}

/**
 * A device with no ledger provisions its personal household.
 *
 * Health seeds nothing: House plants preset spaces and seasonal checklists,
 * Budget plants ten categories, but a health log starts empty by definition —
 * the first row is the user's first weigh-in. The goal row is authored by
 * onboarding through the normal write path, not injected here.
 */
async function mintPersonalHousehold(
  input: { userId: string; householdId?: string; deviceId?: string },
  dbKey: Uint8Array,
  store: LocalFirstStore,
): Promise<HealthLedger> {
  const joining = typeof input.householdId === 'string' && input.householdId.length > 0;
  const householdId = input.householdId ?? newLocalId('hh_local');
  const deviceId = input.deviceId ?? newLocalId('dev');
  const identity = generateDeviceIdentity(deviceId);
  // Placeholder when joining: the real HDK arrives from the enrolled device and
  // replaces this one in `installHealthHouseholdKeys`.
  const householdKeys = generateHouseholdKeys(householdId, 1);
  const opLog = new OpLog({
    store,
    identity,
    householdKeys,
    projection: projectionFor(householdId),
  });
  const household = buildHealthHousehold(householdId, input.userId);

  const ledger: HealthLedger = {
    version: 1,
    household,
    deviceId,
    ...emptyHealthTables(),
    ops: [],
    lww: {},
    conflicts: [],
    pendingEnrolment: joining,
    crypto: cryptoBundle(identity, householdKeys),
  };

  const session: EngineState = {
    householdId,
    dbKey,
    store,
    identity,
    householdKeys,
    // A minted household has rotated nothing, and a joining device holds only
    // its own placeholder key — neither has an epoch worth keeping.
    retiredHouseholdKeys: new Map(),
    opLog,
    ledger,
    // Minted in memory, so hydrated by construction — there is nothing on disk
    // to read back, and therefore nothing outside the window either.
    hydrated: true,
    resident: null,
    awaitingKeys: joining,
    pendingRemoteDeltas: [],
    lastExportedCheckpointVv: null,
  };
  state = session;

  if (joining) {
    // No HOUSEHOLD_CREATE op: this household already exists and its history is
    // about to arrive from the enrolled device. Authoring one under the
    // placeholder key would ship an op nobody can decrypt.
    await persistSession(session, 'all');
    return ledger;
  }

  await appendLedgerOp(session, 'HOUSEHOLD_CREATE', 'household', householdId, {
    userId: input.userId,
  });
  const createdId = session.ledger.ops[session.ledger.ops.length - 1]?.opId;
  await persistSession(session, 'all', createdId ? [createdId] : []);
  return ledger;
}

async function closeLocalHealthSessionInner(): Promise<void> {
  if (!state) return;
  const store = state.store;
  state = null;
  await store.close();
}

export function closeLocalHealthSession(): Promise<void> {
  return queueSessionWork(closeLocalHealthSessionInner);
}

export function resetLocalHealthSession(): Promise<void> {
  return queueSessionWork(async () => {
    await closeLocalHealthSessionInner();
    await clearLocalHealthPersistence();
  });
}

/**
 * The one write path. Capture → mutate → diff → op append (HDK-sealed,
 * Ed25519-signed) → per-row DEK seal → putRows + markProjected, all inside one
 * store transaction, with the enrolment-pending guard and NO implicit sync kick.
 *
 * Bulk callers must pre-chunk with `chunkRowsForOp` and call this once per
 * chunk. One op per row is quadratic: every call re-captures and re-diffs the
 * whole ledger.
 *
 * `opts.origin` exists for exactly one caller shape: the He11 HealthKit drain
 * writes through here on this device, so it is technically a local echo, but no
 * screen rendered it. Tagging it `'ingest'` is what makes Home repaint after a
 * background drain (plan §7).
 */
export async function mutateLocalHealthLedger(
  mutator: (ledger: HealthLedger) => void,
  op: { opType: string; entityType: string; entityId: string; payload: unknown },
  opts?: { origin?: 'local' | 'ingest' },
): Promise<HealthLedger> {
  const session = requireEngine();
  if (session.awaitingKeys) {
    throw new HealthLocalEnrolmentPendingError();
  }
  // Snapshot BEFORE the mutator: mutators edit rows in place, so the pre-image
  // has to be materialized eagerly or the diff has nothing to compare against.
  const before = captureLedgerSnapshot(session.ledger);
  mutator(session.ledger);
  const delta = diffLedger(before, session.ledger);
  await session.store.runInTransaction(async () => {
    await appendLedgerOp(
      session,
      op.opType,
      op.entityType,
      op.entityId,
      encodeLedgerOpPayload(op.payload, delta),
    );
    const opId = session.ledger.ops[session.ledger.ops.length - 1]?.opId;
    await persistRows(session, delta ?? null, opId ? [opId] : []);
  });
  // The OpLog's own projection pass saw this op as a local echo and stayed
  // silent, so this is the single emission for a local write.
  notifyLedgerChanged(delta ? tablesInDelta(delta) : [], opts?.origin ?? 'local');
  return session.ledger;
}

/**
 * Device-local backup restore: merge backup tables through LWW with a synthetic
 * ancient stamp so live field writes and tombstones win. The op payload carries
 * a real delta so the user's other device converges instead of silently forking.
 *
 * House's `replaceHousehold` has no counterpart: the personal household binding
 * is this device's, and swapping its id would invalidate the AAD of every row
 * already sealed on disk.
 */
export async function applyLocalHealthRestore(
  backup: HealthLedger,
  op: { entityId: string; payload: Record<string, unknown> },
): Promise<HealthLedger> {
  const session = requireEngine();
  if (session.awaitingKeys) {
    throw new HealthLocalEnrolmentPendingError();
  }
  // `restoreDeltaFromBackup` diffs the backup against the LIVE ledger, so a row
  // outside the resident window would read as a create and the backup's ancient
  // stamp would then win every field of a row it never actually compared
  // against. A restore is rare and already expensive; correctness wins.
  await hydrateWholeHealthLedger();

  const delta = restoreDeltaFromBackup(session.ledger, backup);
  const restoreEpoch =
    typeof op.payload.restoreEpoch === 'number' ? op.payload.restoreEpoch : Date.now();
  const chunks = delta ? chunkLedgerDelta(delta) : [];
  const opIds: string[] = [];

  await session.store.runInTransaction(async () => {
    if (chunks.length === 0) {
      const stored = await appendLedgerOp(
        session,
        'BACKUP_RESTORE',
        'household',
        op.entityId,
        encodeLedgerOpPayload({ ...op.payload, restoreEpoch }, { v: 1 }),
        { hlc: RESTORE_HLC },
      );
      opIds.push(stored.opId);
    } else {
      for (const chunk of chunks) {
        const stored = await appendLedgerOp(
          session,
          'BACKUP_RESTORE',
          'household',
          op.entityId,
          encodeLedgerOpPayload({ ...op.payload, restoreEpoch }, chunk),
          { hlc: RESTORE_HLC },
        );
        opIds.push(stored.opId);
      }
    }
    drainParkedRows(session.ledger);
    await persistRows(session, delta ?? 'all', opIds);
  });
  // A restore can touch any table, so this is one of the few legitimate
  // whole-ledger invalidations.
  notifyLedgerChanged(HEALTH_LEDGER_TABLE_NAMES, 'restore');
  return session.ledger;
}

/**
 * Record ops that sync already verified, decrypted and projected (the OpLog's
 * projection handler runs inside `applyRemote`), then persist the merged ledger
 * so a relaunch keeps the other device's changes.
 *
 * The `'inbound'` notification already fired per delta inside `projectionFor`;
 * this is the durability half and stays silent.
 */
export async function noteRemoteHealthOpsApplied(ops: StoredOperation[]): Promise<void> {
  const session = requireEngine();
  for (const op of ops) {
    if (!session.ledger.ops.some((existing) => existing.opId === op.opId)) {
      session.ledger.ops.push(op);
    }
  }
  const deltas = session.pendingRemoteDeltas;
  session.pendingRemoteDeltas = [];
  await session.store.runInTransaction(async () => {
    if (deltas.length === 0) {
      await persistIdentity(session);
    } else {
      for (const delta of deltas) {
        await persistRows(session, delta);
      }
    }
    await session.store.markProjected(
      ops.map((op) => op.opId),
      Date.now(),
    );
  });
}

/** Auto-merges that discarded a device's intent, newest last. */
export function getLocalHealthConflicts(): LedgerConflict[] {
  return requireEngine().ledger.conflicts ?? [];
}

/** Dismiss the surfaced conflict log once the user has seen it. */
export async function clearLocalHealthConflicts(): Promise<void> {
  const session = requireEngine();
  session.ledger.conflicts = [];
  await persist(null);
  // No table moved — a revision bump, not a data invalidation.
  notifyLedgerChanged([], 'local');
}

/** Compaction watermark: the version vector the last checkpoint covers. */
const checkpointVvMetaKey = (householdId: string) => `lf.checkpoint.vv:${householdId}`;
/** Last generation this device published — publish is idempotent on it (DoD He8). */
const checkpointGenerationMetaKey = (householdId: string) =>
  `lf.checkpoint.generation:${householdId}`;

/** Snapshot the current projection as HDK-sealable checkpoint plaintext. */
export async function exportHealthCheckpointPlaintext(): Promise<CheckpointPlaintext> {
  const session = await hydrateSession(requireEngine());
  const householdId = session.ledger.household.id;
  const records = await session.store.listRows({ householdId });
  const rows: CheckpointPlaintext['rows'] = [];
  for (const record of records) {
    const body = openRowBody(
      session.dbKey,
      record.nonce,
      record.ciphertext,
      rowAad(householdId, record.table, record.rowKey, record.keyEpoch),
    );
    rows.push({
      table: record.table,
      rowKey: record.rowKey,
      bucket: record.bucket,
      deleted: record.deleted,
      bodyJson: utf8Decode(body),
      updatedHlc: record.updatedHlc,
    });
  }
  const versionVector = await session.store.getVersionVector(householdId);
  // Remembered so that publishing this checkpoint records a watermark that
  // describes THIS export, not whatever landed while it was in flight.
  session.lastExportedCheckpointVv = versionVector;
  return {
    v: 1,
    householdId,
    keyEpoch: session.householdKeys.keyEpoch,
    versionVector,
    household: session.ledger.household,
    rows,
  };
}

/**
 * Replace the projection with a verified checkpoint, then replay local ops
 * newer than the checkpoint watermark (unpublished tail).
 */
export async function installHealthCheckpointPlaintext(plain: CheckpointPlaintext): Promise<void> {
  const session = await hydrateSession(requireEngine());
  if (session.awaitingKeys) {
    throw new HealthLocalEnrolmentPendingError();
  }
  const householdId = session.ledger.household.id;
  if (plain.householdId !== householdId) {
    throw new Error('installHealthCheckpointPlaintext: household mismatch');
  }
  const writes: Array<{
    table: HealthLedgerTableName;
    rowKey: string;
    deleted: boolean;
    envelope: RowEnvelope;
  }> = [];
  for (const row of plain.rows) {
    if (!(row.table in HEALTH_LEDGER_TABLE_KEYS)) continue;
    const envelope = JSON.parse(row.bodyJson) as RowEnvelope;
    writes.push({
      table: row.table as HealthLedgerTableName,
      rowKey: row.rowKey,
      deleted: row.deleted,
      envelope,
    });
  }
  await session.store.clearRows(householdId);
  installRowEnvelopes(session.ledger, writes);
  // The checkpoint IS the whole projection — `clearRows` just deleted everything
  // it did not carry — so this session now holds every row there is. Dropping
  // residency here is not an optimisation: leaving a stale bucket set behind
  // would have the guards hydrate against rows that no longer exist.
  session.resident = null;
  if (plain.household && typeof plain.household === 'object') {
    // `CheckpointPlaintext.household` is `unknown` by design — the core does not
    // know any app's household shape. The id and the owning user stay this
    // session's: they address the rows on disk and the account that opened them.
    session.ledger.household = {
      ...session.ledger.household,
      ...(plain.household as LocalHealthHousehold),
      id: householdId,
      userId: session.ledger.household.userId,
    };
  }
  for (const [deviceId, seq] of Object.entries(plain.versionVector)) {
    await session.store.setAuthorBaseline(householdId, deviceId, seq);
  }
  await persistSession(session, 'all');

  const tail = await session.store.listOperationsSince(householdId, plain.versionVector);
  for (const op of tail) {
    try {
      const aad = utf8Encode(`${op.householdId}:${op.keyEpoch}:${op.opId}`);
      const payload = JSON.parse(
        utf8Decode(aeadDecrypt(session.householdKeys.hdk, op.payload, aad)),
      );
      const delta = decodeLedgerOpPayload(payload);
      if (!delta) continue;
      await hydrateRowsForDelta(session, delta);
      applyLedgerDelta(session.ledger, delta, {
        hlc: op.hlc,
        authorMemberId: op.authorMemberId,
        opId: op.opId,
      });
    } catch {
      console.warn('[HealthLocal] checkpoint tail replay failed', op.opId);
    }
  }
  await persistSession(session, 'all');
  await session.store.setMeta(
    checkpointVvMetaKey(session.householdId),
    JSON.stringify(plain.versionVector),
  );
  // The checkpoint replaced the whole projection with the other device's — this
  // is remote data landing, at whole-ledger scale.
  notifyLedgerChanged(HEALTH_LEDGER_TABLE_NAMES, 'inbound');
}

/** Truncate the op log below checkpoint VV ∩ every active peer VV. */
export async function compactLocalHealthLogIfSafe(): Promise<number> {
  const session = requireEngine();
  const raw = await session.store.getMeta(checkpointVvMetaKey(session.householdId));
  if (!raw) return 0;
  let checkpointVv: VersionVector;
  try {
    checkpointVv = JSON.parse(raw) as VersionVector;
  } catch {
    return 0;
  }
  const householdId = session.ledger.household.id;
  const ours = await session.store.getVersionVector(householdId);
  const peers = await session.store.listSyncPeerStates(householdId);
  const retain = minVersionVector([checkpointVv, ours, ...peers.map((peer) => peer.knownVv)]);
  if (Object.keys(retain).length === 0) return 0;
  return session.store.compactOperations(householdId, retain);
}

/**
 * Record that generation `generation` was published for this household.
 *
 * The generation is the publish-idempotency key (DoD He8). The compaction
 * watermark it advances is the version vector captured when the checkpoint was
 * EXPORTED — deliberately not the live one, which would include ops that landed
 * after the export and would authorize truncating ops no checkpoint contains. If
 * this session never exported (a publish resumed after a relaunch), the
 * generation is recorded and the watermark is left where it was: compaction then
 * stays conservative instead of trusting a vector it cannot justify.
 */
export async function rememberPublishedHealthCheckpoint(generation: number): Promise<void> {
  const session = requireEngine();
  await session.store.setMeta(
    checkpointGenerationMetaKey(session.householdId),
    String(generation),
  );
  if (session.lastExportedCheckpointVv) {
    await session.store.setMeta(
      checkpointVvMetaKey(session.householdId),
      JSON.stringify(session.lastExportedCheckpointVv),
    );
  }
}

/**
 * Test helper — **cold-open the session that is already open**, against the
 * same store, without SecureStore or MMKV.
 *
 * The real cold open is `openLocalHealthSession`, and it cannot run under Jest:
 * it reads the DEK out of `expo-secure-store` and opens a native SQLite file.
 * Everything AFTER those two steps — `buildSessionFromDisk`, the windowed
 * `listRows`, the AEAD open loop, `installRowEnvelopes`, the unprojected replay
 * — is what this re-runs, over the store instance the current session is
 * already holding. That is the only way a suite can assert what a cold open
 * actually installs, which is the whole subject of `residentWindow.test.ts`.
 *
 * `openLocalHealthSessionForTests` cannot answer that question: it MINTS a
 * session in memory and is fully resident by construction, so a window has
 * nothing to leave behind.
 *
 * The store is deliberately NOT closed and reopened — a `MemoryLocalFirstStore`
 * would lose every row, which is the opposite of a cold open.
 */
export async function reopenLocalHealthSessionForTests(): Promise<HealthLedger> {
  const previous = requireEngine();
  const { store, dbKey, householdId } = previous;
  const userId = previous.ledger.household.userId;
  // Flush identity + rows first: a reopen that read a half-written store would
  // be testing the writer, not the reader.
  await persistSession(previous, 'all');
  state = null;

  const session = await buildSessionFromDisk({ store, dbKey, householdId, userId });
  if (!session) throw new HealthLocalNotReadyError();
  state = session;
  await hydrateSession(session);
  notifyLedgerChanged(HEALTH_LEDGER_TABLE_NAMES, 'restore');
  return session.ledger;
}

/**
 * Test helper — which `'YYYY-MM'` buckets this session has decrypted, or null
 * when the whole ledger is in memory.
 *
 * Exported so a suite can assert residency as a FACT rather than inferring it
 * from row counts, and so the resident fraction quoted in the He10 baseline is
 * a number something checks.
 */
export function getLocalHealthResidentBucketsForTests(): string[] | null {
  const resident = state?.resident;
  return resident ? [...resident.buckets].sort() : null;
}

/** Test helper — inject an in-memory session without SecureStore/MMKV. */
export async function openLocalHealthSessionForTests(input: {
  userId?: string;
  householdId?: string;
  deviceId?: string;
}): Promise<HealthLedger> {
  // Inner, not the queued export: this helper builds its own session directly,
  // so going through the chain would let it deadlock if ever called from within
  // a queued operation.
  await closeLocalHealthSessionInner();
  const dbKey = randomBytes(32);
  const store = new MemoryLocalFirstStore();
  await store.open(dbKey);
  const userId = input.userId ?? newLocalId('user_test');
  const householdId = input.householdId ?? newLocalId('hh_test');
  const deviceId = input.deviceId ?? newLocalId('dev_test');
  const identity = generateDeviceIdentity(deviceId);
  const householdKeys = generateHouseholdKeys(householdId, 1);
  const opLog = new OpLog({
    store,
    identity,
    householdKeys,
    projection: projectionFor(householdId),
  });
  const ledger: HealthLedger = {
    version: 1,
    household: buildHealthHousehold(householdId, userId),
    deviceId,
    ...emptyHealthTables(),
    ops: [],
    lww: {},
    conflicts: [],
    pendingEnrolment: false,
    crypto: cryptoBundle(identity, householdKeys),
  };
  state = {
    householdId,
    dbKey,
    store,
    identity,
    householdKeys,
    retiredHouseholdKeys: new Map(),
    opLog,
    ledger,
    hydrated: true,
    resident: null,
    awaitingKeys: false,
    pendingRemoteDeltas: [],
    lastExportedCheckpointVv: null,
  };
  // Same session-lifecycle emission as the real open — a suite that subscribes
  // and then opens is testing the cold-start path, and it must see it.
  notifyLedgerChanged(HEALTH_LEDGER_TABLE_NAMES, 'restore');
  return ledger;
}
