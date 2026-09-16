/**
 * House V2 encrypted backup of the local ledger (plan §10, stage H9).
 *
 * The archive format, the Argon2id recovery-key derivation and the 12-word
 * phrase all come from `@symply/local-first/backup` unchanged — this file is the
 * House wrapper, ported from `budget/local/backup/budgetBackup.ts`.
 *
 * **Three things differ from Budget's, and each is a House constraint:**
 *
 * 1. **A file may hold SEVERAL properties, one section each.** Budget has
 *    exactly one ledger, so its wrapper can read `getLocalLedger()` and be done.
 *    House holds 1–3 properties (H5), each with its own HDK, key epoch and
 *    membership. Q15 originally answered that with "one archive per property",
 *    and the hazard it was protecting against is real: rows from two households
 *    that only coincidentally share a device must never be poured into one
 *    undifferentiated pile, because a restore would then have to guess which
 *    property each row belonged to.
 *
 *    That hazard is about MIXING, not about co-location. So the file now carries
 *    a `households: [...]` array in which every home keeps its own ledger, its
 *    own identity, its own key epoch and its own attachment manifest, and
 *    restore walks it home by home into the matching local property. Nothing is
 *    merged, nothing is guessed, and a member with three homes gets one file to
 *    keep safe instead of three to keep in step. Per-property archives are still
 *    produced whenever a single property is named (`householdId`), and are still
 *    read on restore — see `parseHouseBackupSnapshot`.
 *
 * 2. **The archive names what is in it.** A member with three homes gets a file
 *    per home or one file for all of them; `symply-house-backup-2026-08-13.json`
 *    three times over is unusable either way.
 *
 * 3. **Blob bytes are NOT in the archive (Q15).** The ledger rows carry blob
 *    descriptors (`{blobId, mime, bytes, sha256, chunkCount, keyEpoch}`) and
 *    those travel; the attachment bytes stay in R2. An archive with 5 GB of
 *    photos in it is not a backup anyone can store or restore, and the bytes are
 *    re-fetchable for as long as the household exists. The consequence to accept:
 *    restoring into a household whose R2 objects are gone gives rows whose
 *    attachments resolve to "unavailable" — which is why the manifest is
 *    reported rather than hidden.
 *
 * **Restore honours D-20 "live wins"** via the engine's `applyLocalHouseRestore`:
 * restored values carry `RESTORE_HLC`, an ancient synthetic stamp, so any real
 * live write and any tombstone beats them, and a restore can never resurrect a
 * deleted row. That is unchanged by the multi-home file: each section merges
 * into its own property under exactly the same rule.
 */
// Side-effect FIRST, before `@symply/local-first` — @noble captures
// `globalThis.crypto` at module load and Hermes often ships without
// `getRandomValues`, so anything that pulls the package ahead of this file gets
// a crypto object that cannot generate randomness. Every `local*Api.ts` carries
// the same line for the same reason; this module did not, and it is the ONLY
// House module that imports `@symply/local-first` directly.
//
// The consequence was not theoretical. `HouseBackupScreen` imports this module
// (line 11) BEFORE `../engine` (line 16), and within this file the package
// import also preceded `../engine`, so on a real device Argon2id key derivation
// threw and "Create a backup" failed with the generic
// "We could not put that backup together just now."
//
// It was unreachable until 2026-08-14: nothing referenced `src/screens/house-v2/`
// until the surface was routed, so no screen had ever pulled this module into a
// graph. The first device run of `lf-009` found it.
import '../cryptoPolyfill';

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import {
  createBackupArchive,
  openBackupArchive,
  verifyBackupArchive,
  type BackupCreateResult,
  type BackupVerifyResult,
} from '@symply/local-first';

import {
  applyLocalHouseRestore,
  getActiveHouseholdId,
  getLocalHouseSession,
  isLocalHouseSessionOpen,
  listLocalHouseProperties,
  type HouseLedger,
} from '../engine';
// Static, not `await import(...)`: `ensureSession` does not import this module
// back, so there is no cycle to break — and the dynamic form throws "dynamic
// import callback was invoked without --experimental-vm-modules" under Jest.
import { ensureHouseLocalSession } from '../ensureSession';
import { HouseLocalNotReadyError } from '../errors';
import { HOUSE_LEDGER_TABLE_NAMES } from '../schema';

import { HOUSE_ALL_HOMES_ID, HOUSE_ALL_HOMES_LABEL, isAllHomesTarget } from './allHomes';

export type HouseBlobManifestEntry = {
  table: string;
  blobId: string;
  bytes: number;
  mime: string;
};

export type HouseBackupSummary = {
  householdId: string;
  propertyName: string;
  /** Row counts per ledger table, for the "what am I restoring" screen. */
  tableCounts: Record<string, number>;
  totalRows: number;
  /** Attachments referenced by the rows — descriptors only, never bytes. */
  blobManifest: HouseBlobManifestEntry[];
  /**
   * Present only on the COMBINED summary of a multi-home archive: the same
   * numbers again, split back out per home.
   *
   * A member with three homes reading "4,812 rows" learns nothing about whether
   * the cabin made it into the file, and that is the single question a
   * multi-home backup has to be able to answer. Absent on a single home's
   * summary, where it would only repeat the object it hangs off.
   */
  households?: HouseBackupSummary[];
};

// --- The multi-home archive --------------------------------------------------

/**
 * Inner format tag of a file that holds more than one property.
 *
 * Sits on the PLAINTEXT snapshot, inside the AEAD ciphertext, not on the archive
 * envelope: what homes a device holds is exactly the sort of thing an archive
 * sitting in someone's Drive should not announce.
 */
export const HOUSE_MULTI_BACKUP_FORMAT = 'symply-house-multi-household-backup';
export const HOUSE_MULTI_BACKUP_VERSION = 1;

/**
 * The pseudo-household id a multi-home archive is addressed to, re-exported so
 * callers have one place to import the whole backup vocabulary from. It is
 * DEFINED in `./allHomes` — a leaf, for the reasons that module gives.
 */
export { HOUSE_ALL_HOMES_ID, HOUSE_ALL_HOMES_LABEL, isAllHomesTarget } from './allHomes';

/**
 * One property's ledger as it travels: the tables plus the identity a restore
 * needs to place them, and nothing else. Typed loosely because it is data at
 * rest — it is re-read as a `HouseLedger` by the restore path, which is the only
 * thing that ever interprets it.
 */
export type HouseLedgerSnapshot = Record<string, unknown>;

/** One home's section of a backup file. */
export type HouseBackupSection = {
  householdId: string;
  propertyName: string;
  memberId: string;
  /** The device that sealed this section. */
  deviceId: string;
  /**
   * The household key epoch current when this section was sealed. Carried per
   * home because homes rotate independently — one envelope-level epoch would be
   * a fact about whichever home happened to be first.
   */
  keyEpoch: number;
  /**
   * True when this device had claimed the home but had not yet been handed the
   * household key. Such a section is normally EMPTY, and saying so is the
   * difference between "the cabin has no rows in this file because it had none"
   * and "…because the backup skipped it".
   */
  awaitingEnrolment: boolean;
  /** Counts + attachment manifest, so the file describes itself once opened. */
  summary: HouseBackupSummary;
  /** Every registered table for this home. No crypto material, no op log. */
  ledger: HouseLedgerSnapshot;
};

export type HouseMultiBackupDocument = {
  format: typeof HOUSE_MULTI_BACKUP_FORMAT;
  version: number;
  createdAt: string;
  /** The device that sealed the file — the same on every section. */
  deviceId: string;
  households: HouseBackupSection[];
};

/** How many homes a file holds, once it is open. */
export type HouseBackupScope = 'single' | 'multi';

/**
 * Serialise one property's ledger.
 *
 * Built by NAMING what travels rather than by copying the ledger and deleting
 * from it, which is the difference between a table that is missing from the
 * archive and a table that is missing from the archive *silently*. A ledger
 * object that has somehow lost an array (a partially hydrated session, a shape
 * written by an older build) yields `[]` here instead of `undefined`, and every
 * registered table is present whether or not the live object had it.
 *
 * Four things are deliberately left out:
 *
 *  - `crypto` — keys must live only inside the AEAD ciphertext and never in
 *    archive metadata; leaking the HDK would make the recovery phrase pointless.
 *  - `ops` — restore merges tables through LWW rather than replaying the log,
 *    so it is redundant, and encoding it was measured at a ~3.6× size blow-up on
 *    the Budget side.
 *  - `lww` — merge watermarks describe the device that wrote them. Restore
 *    deliberately stamps every restored value with `RESTORE_HLC` so live writes
 *    win (D-20), so carrying watermarks in would either be ignored or, if it
 *    were ever honoured, would let a backup beat work done since.
 *  - `conflicts` / `pendingEnrolment` — session state, not the member's data.
 *    Restoring a conflict list would re-raise banners for merges already settled.
 */
export function houseLedgerSnapshot(ledger: HouseLedger): HouseLedgerSnapshot {
  const snapshot: HouseLedgerSnapshot = {
    version: ledger.version ?? 1,
    household: ledger.household,
    memberId: ledger.memberId,
    deviceId: ledger.deviceId,
  };
  for (const table of HOUSE_LEDGER_TABLE_NAMES) {
    const rows = (ledger as unknown as Record<string, unknown>)[table];
    snapshot[table] = Array.isArray(rows) ? rows : [];
  }
  // Restore reads this key, so it must exist; it must also be empty, per above.
  snapshot.ops = [];
  return snapshot;
}

export function snapshotFromHouseLedger(ledger: HouseLedger): string {
  return JSON.stringify(houseLedgerSnapshot(ledger));
}

/**
 * Collect attachment descriptors referenced anywhere in the ledger.
 *
 * Walks values rather than naming columns: blob-bearing columns are spread
 * across 25 tables in the full wave plan, and a hand-maintained column list
 * would silently miss the next one. A descriptor is recognised by shape
 * (`blobId` + `sha256`), which is exactly what `HouseBlobDescriptor` is.
 */
export function collectBlobManifest(ledger: HouseLedger): HouseBlobManifestEntry[] {
  const out: HouseBlobManifestEntry[] = [];
  const seen = new Set<string>();

  const visit = (table: string, value: unknown, depth = 0): void => {
    if (!value || typeof value !== 'object' || depth > 4) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(table, item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.blobId === 'string' && typeof record.sha256 === 'string') {
      if (!seen.has(record.blobId)) {
        seen.add(record.blobId);
        out.push({
          table,
          blobId: record.blobId,
          bytes: typeof record.bytes === 'number' ? record.bytes : 0,
          mime: typeof record.mime === 'string' ? record.mime : 'application/octet-stream',
        });
      }
      return;
    }
    for (const nested of Object.values(record)) visit(table, nested, depth + 1);
  };

  for (const table of HOUSE_LEDGER_TABLE_NAMES) {
    visit(table, (ledger as unknown as Record<string, unknown>)[table]);
  }
  return out;
}

export function summarizeHouseLedger(ledger: HouseLedger): HouseBackupSummary {
  const tableCounts: Record<string, number> = {};
  let totalRows = 0;
  for (const table of HOUSE_LEDGER_TABLE_NAMES) {
    const rows = (ledger as unknown as Record<string, unknown>)[table];
    const count = Array.isArray(rows) ? rows.length : 0;
    tableCounts[table] = count;
    totalRows += count;
  }
  return {
    householdId: ledger.household.id,
    propertyName: ledger.household.name,
    tableCounts,
    totalRows,
    blobManifest: collectBlobManifest(ledger),
  };
}

/**
 * Roll several homes' summaries into the one a screen shows above them.
 *
 * The per-table counts add up and the attachment manifests concatenate, deduped
 * by blob id — two homes cannot share a blob today (blobs are sealed per
 * household), but a manifest that could double-count would make the "42.3 MB to
 * re-fetch" line wrong the day they can.
 */
export function aggregateHouseSummaries(summaries: HouseBackupSummary[]): HouseBackupSummary {
  const tableCounts: Record<string, number> = {};
  for (const table of HOUSE_LEDGER_TABLE_NAMES) tableCounts[table] = 0;
  let totalRows = 0;
  const blobManifest: HouseBlobManifestEntry[] = [];
  const seenBlobs = new Set<string>();

  for (const summary of summaries) {
    for (const [table, count] of Object.entries(summary.tableCounts)) {
      tableCounts[table] = (tableCounts[table] ?? 0) + count;
    }
    totalRows += summary.totalRows;
    for (const blob of summary.blobManifest) {
      if (seenBlobs.has(blob.blobId)) continue;
      seenBlobs.add(blob.blobId);
      blobManifest.push(blob);
    }
  }

  return {
    householdId: HOUSE_ALL_HOMES_ID,
    propertyName: HOUSE_ALL_HOMES_LABEL,
    tableCounts,
    totalRows,
    blobManifest,
    households: summaries,
  };
}

/**
 * What one property's archive WOULD contain, without sealing anything.
 *
 * The Backup screen shows this before the member commits: the per-table counts,
 * and — the part Q15 makes non-negotiable — the attachment manifest, whose
 * bytes are NOT in the file. Hydrates the property on demand, so a home the
 * member has not opened this launch can still be described. That costs one cold
 * read (~34–37 µs/row, H10), which is why the screen asks for it on an explicit
 * selection rather than on every render.
 *
 * Passing `HOUSE_ALL_HOMES_ID` describes what a whole-device archive would hold.
 * That hydrates EVERY property, which is the honest cost of the answer: there is
 * no way to say how many rows are in the cabin without reading the cabin.
 */
export async function summarizeHouseProperty(householdId: string): Promise<HouseBackupSummary> {
  if (!isLocalHouseSessionOpen()) throw new HouseLocalNotReadyError();
  if (isAllHomesTarget(householdId)) return summarizeHouseDevice();
  const session = await getLocalHouseSession(householdId);
  return summarizeHouseLedger(session.ledger);
}

/**
 * Which homes a whole-device backup covers, in the order they are sealed.
 *
 * Every property the device holds — including one still awaiting enrolment.
 * `autoBackup` skips those for its own per-home runs, and rightly: there is
 * usually nothing in them. But "usually" is not "never" — a member who restored
 * onto a fresh phone has rows in a placeholder property before any peer has let
 * that phone in (`backupRestoreFreshDevice.test.ts`), and a backup that quietly
 * dropped exactly those rows would be dropping the ones most recently rescued.
 * Empty sections cost bytes; missing ones cost a home.
 */
export function houseBackupTargets(): string[] {
  const properties = listLocalHouseProperties();
  const active = getActiveHouseholdId();
  // Active first so the file's first section is the home the member thinks of as
  // theirs, and so `restoreHouseBackup`'s primary result is the expected one.
  return [
    ...properties.filter((entry) => entry.householdId === active),
    ...properties.filter((entry) => entry.householdId !== active),
  ].map((entry) => entry.householdId);
}

/** What a whole-device archive would hold, combined and split out per home. */
export async function summarizeHouseDevice(householdIds?: string[]): Promise<HouseBackupSummary> {
  if (!isLocalHouseSessionOpen()) throw new HouseLocalNotReadyError();
  const ids = householdIds ?? houseBackupTargets();
  const summaries: HouseBackupSummary[] = [];
  for (const id of ids) {
    // Sequential: hydrating three cold properties in parallel triples the peak
    // memory of the widest read in the app to save time nobody is watching.
    const session = await getLocalHouseSession(id);
    summaries.push(summarizeHouseLedger(session.ledger));
  }
  return aggregateHouseSummaries(summaries);
}

/** Seal one live session into the section a multi-home file carries. */
async function sectionForHousehold(householdId: string): Promise<HouseBackupSection> {
  const session = await getLocalHouseSession(householdId);
  const ledger = session.ledger;
  return {
    householdId: ledger.household.id,
    propertyName: String(ledger.household.name ?? '').trim() || 'Home',
    memberId: ledger.memberId,
    deviceId: ledger.deviceId,
    keyEpoch: session.householdKeys.keyEpoch,
    awaitingEnrolment: session.awaitingEnrolment,
    summary: summarizeHouseLedger(ledger),
    ledger: houseLedgerSnapshot(ledger),
  };
}

/**
 * Read a decrypted snapshot as one or more home sections.
 *
 * Both shapes come through here, and which one arrived is reported rather than
 * hidden: a single-home archive (every file this app wrote before multi-home
 * backups, and every file a per-home backup writes now) parses as the ledger
 * itself, and a multi-home archive parses as its `households` array. A snapshot
 * that is neither is a corrupt or foreign file, and saying so beats restoring
 * zero rows and calling it a success.
 */
export function parseHouseBackupSnapshot(snapshotJson: string): {
  scope: HouseBackupScope;
  sections: HouseBackupSection[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshotJson);
  } catch {
    throw new Error('This backup file is damaged and could not be read.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('This backup file is damaged and could not be read.');
  }

  const document = parsed as Partial<HouseMultiBackupDocument> & Record<string, unknown>;
  if (document.format === HOUSE_MULTI_BACKUP_FORMAT) {
    if (!Array.isArray(document.households) || document.households.length === 0) {
      throw new Error('This backup file lists no homes, so there is nothing to restore.');
    }
    const sections = document.households.filter(
      (section): section is HouseBackupSection =>
        Boolean(section) &&
        typeof section.householdId === 'string' &&
        Boolean(section.ledger) &&
        typeof section.ledger === 'object',
    );
    if (sections.length === 0) {
      throw new Error('This backup file lists no homes, so there is nothing to restore.');
    }
    return { scope: 'multi', sections };
  }

  // The single-home shape: the snapshot IS the ledger.
  const ledger = parsed as HouseLedger;
  if (!ledger.household || typeof ledger.household.id !== 'string') {
    throw new Error('This backup file is damaged or not a Symply House backup.');
  }
  const summary = summarizeHouseLedger(ledger);
  return {
    scope: 'single',
    sections: [
      {
        householdId: ledger.household.id,
        propertyName: summary.propertyName || 'Home',
        memberId: ledger.memberId,
        deviceId: ledger.deviceId,
        keyEpoch: 0,
        awaitingEnrolment: false,
        summary,
        ledger: ledger as unknown as HouseLedgerSnapshot,
      },
    ],
  };
}

export type BuildHouseBackupOptions = {
  /**
   * Which property to archive.
   *
   * A real household id seals that one home. `HOUSE_ALL_HOMES_ID` seals every
   * home on the device into one file, sectioned per household. Defaults to the
   * active property, so nothing that was already calling this changes shape.
   */
  householdId?: string;
  /** An explicit set of homes — overrides `householdId`. */
  householdIds?: string[];
  /**
   * Seal under a caller-supplied phrase instead of minting a fresh one.
   *
   * Manual backups mint a phrase per archive and show it once. Scheduled backups
   * cannot — nobody is watching, and a per-run random phrase would make every
   * unattended archive permanently unopenable.
   */
  phrase?: string;
};

/** The plaintext a backup seals, before any key is derived. */
export type HouseBackupPlaintext = {
  /** What goes inside the AEAD ciphertext, verbatim. */
  snapshotJson: string;
  /** What the envelope is addressed to — a household id, or `HOUSE_ALL_HOMES_ID`. */
  householdId: string;
  deviceId: string;
  keyEpoch: number;
  createdAt: string;
  scope: HouseBackupScope;
  /**
   * The archive's contents. One home for a per-home file; the combined figures
   * (with `households` filled in) for a whole-device file, so a caller that only
   * knows about `summary` still reads true totals.
   */
  summary: HouseBackupSummary;
  /** Every home in the file, in section order. */
  householdIds: string[];
};

export type HouseBackupBuildResult = BackupCreateResult &
  Pick<HouseBackupPlaintext, 'summary' | 'scope' | 'householdIds'>;

/**
 * Everything a backup is, except sealed.
 *
 * Split out of `buildHouseBackupArchive` because reading the ledgers and reading
 * the crypto are separate concerns, and only one of them costs a minute of
 * Argon2id: the format — which homes are in the file, which rows are under which
 * home, which tables travelled — is decided here, and can be checked here.
 */
export async function buildHouseBackupSnapshot(
  options: BuildHouseBackupOptions = {},
): Promise<HouseBackupPlaintext> {
  if (!isLocalHouseSessionOpen()) {
    throw new HouseLocalNotReadyError();
  }

  const wantsEveryHome = options.householdIds != null || isAllHomesTarget(options.householdId);
  const ids = wantsEveryHome
    ? (options.householdIds ?? houseBackupTargets())
    : [options.householdId ?? getActiveHouseholdId()].filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      );
  if (ids.length === 0) throw new HouseLocalNotReadyError();

  const createdAt = new Date().toISOString();

  // One home, named explicitly: keep writing the per-home shape. It is what
  // every build before multi-home backups produced, it is what an older phone
  // can still open, and there is nothing for a `households` array to separate.
  if (!wantsEveryHome) {
    const session = await getLocalHouseSession(ids[0]);
    const ledger = session.ledger;
    return {
      snapshotJson: snapshotFromHouseLedger(ledger),
      householdId: ledger.household.id,
      deviceId: ledger.deviceId,
      keyEpoch: session.householdKeys.keyEpoch,
      createdAt,
      scope: 'single',
      summary: summarizeHouseLedger(ledger),
      householdIds: [ledger.household.id],
    };
  }

  const sections: HouseBackupSection[] = [];
  for (const id of ids) {
    // Sequential for the same reason `summarizeHouseDevice` is: hydrating every
    // property at once multiplies the peak memory of the widest read in the app.
    sections.push(await sectionForHousehold(id));
  }

  const document: HouseMultiBackupDocument = {
    format: HOUSE_MULTI_BACKUP_FORMAT,
    version: HOUSE_MULTI_BACKUP_VERSION,
    createdAt,
    deviceId: sections[0].deviceId,
    households: sections,
  };

  return {
    snapshotJson: JSON.stringify(document),
    // The envelope is addressed to "all homes" rather than to one of them.
    // Naming a real household here would both be arbitrary — which of three? —
    // and would let an older build try to pour every section into that one home;
    // it instead refuses the file by name, which is the right answer.
    householdId: HOUSE_ALL_HOMES_ID,
    deviceId: document.deviceId,
    // Envelope hint only. Homes rotate independently, so the honest per-home
    // epochs are on the sections; the highest is reported here so a support
    // question about "which epoch is this file from" has an upper bound.
    keyEpoch: sections.reduce((max, section) => Math.max(max, section.keyEpoch ?? 0), 0),
    createdAt,
    scope: 'multi',
    summary: aggregateHouseSummaries(sections.map((section) => section.summary)),
    householdIds: sections.map((section) => section.householdId),
  };
}

export async function buildHouseBackupArchive(
  options: BuildHouseBackupOptions = {},
): Promise<HouseBackupBuildResult> {
  const plaintext = await buildHouseBackupSnapshot(options);
  const archive = createBackupArchive(
    {
      snapshotJson: plaintext.snapshotJson,
      householdId: plaintext.householdId,
      deviceId: plaintext.deviceId,
      keyEpoch: plaintext.keyEpoch,
      createdAt: plaintext.createdAt,
    },
    options.phrase ? { phrase: options.phrase } : undefined,
  );
  return {
    ...archive,
    summary: plaintext.summary,
    scope: plaintext.scope,
    householdIds: plaintext.householdIds,
  };
}

export function verifyHouseBackup(archiveJson: string, phrase: string): BackupVerifyResult {
  return verifyBackupArchive(archiveJson, phrase);
}

/**
 * Archive file name — property-scoped, because a member holds 1–3 of them and
 * three files with the same name are indistinguishable in Files or Drive.
 */
export function houseBackupFileName(
  propertyName: string,
  day: string = new Date().toISOString().slice(0, 10),
): string {
  const slug =
    propertyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'home';
  return `symply-house-${slug}-${day}.backup.json`;
}

export type HouseRestoreOptions = {
  /** Skip re-deriving the key when the caller already verified the archive. */
  verifiedPayload?: { snapshotJson: string; householdId: string; deviceId: string; createdAt: string };
  /**
   * Allow restoring an archive whose household id differs from the live one.
   *
   * Off by default: silently rebinding a property to another household's rows is
   * a data-mixing bug, not a convenience. Honoured only for a SINGLE-home
   * archive — a multi-home file already says which home each section belongs to,
   * so there is nothing to rebind and rebinding anyway would be the mixing this
   * flag exists to make deliberate.
   */
  allowHouseholdReplace?: boolean;
  /**
   * Which home to restore INTO.
   *
   * For a single-home archive this is the property the rows land in (defaulting
   * to the active one). For a multi-home archive it narrows the file to one of
   * its sections; omit it — or pass `HOUSE_ALL_HOMES_ID` — to restore every
   * section this device has a home for.
   */
  householdId?: string;
};

/** What happened to one home's section of the file. */
export type HouseRestoreHouseholdStatus = 'restored' | 'not_on_device' | 'not_selected' | 'failed';

export type HouseRestoreHouseholdResult = {
  /** The household id as it appears in the archive. */
  householdId: string;
  propertyName: string;
  status: HouseRestoreHouseholdStatus;
  /** Safe to show: says what happened to this home and, if skipped, why. */
  message: string;
  /** The home's contents after the merge. Present only when it was restored. */
  summary?: HouseBackupSummary;
};

export type HouseRestoreResult = {
  /**
   * The home the restore is "about" — the first one actually restored. Unchanged
   * meaning for a single-home archive, which is what every existing caller reads.
   */
  householdId: string;
  /** That home's contents, or the combined figures when several were restored. */
  summary: HouseBackupSummary;
  /** Attachments the restored rows reference; their bytes are re-fetched from R2. */
  blobManifest: HouseBlobManifestEntry[];
  /** One entry per section in the file, restored or not. */
  households: HouseRestoreHouseholdResult[];
};

/**
 * Apply one already-parsed section into the home it names.
 *
 * **Hydrated first, always — this is what keeps D-20 true off the active home.**
 *
 * A whole-device restore reaches homes the member has not opened this launch,
 * and a cold session's `ledger` is the empty shell `emptyHouseTables()` produced:
 * its rows are on disk, unread, and so are its LWW watermarks. Merging into that
 * shell diffs the backup against nothing, so every archived row looks new and
 * there is no watermark to lose to — and the restore then writes month-old
 * values over work the member did last week. "Live wins" would hold for the home
 * they happened to have open and silently fail for the other two, which is worse
 * than not holding at all.
 *
 * The single-home path has always hydrated before applying (`restoreHouseBackup`
 * reads the session first). This makes the multi-home path do it too, rather
 * than depending on which home the member last looked at.
 */
async function applyHouseSection(
  section: HouseBackupSection,
  payload: { createdAt: string; deviceId: string },
  options: { replaceHousehold?: boolean; intoHouseholdId?: string } = {},
): Promise<HouseBackupSummary> {
  const target = options.intoHouseholdId ?? section.householdId;
  await getLocalHouseSession(target);
  await applyLocalHouseRestore(section.ledger as unknown as HouseLedger, {
    entityId: options.replaceHousehold ? section.householdId : target,
    // Without this the engine writes into whichever property happens to be
    // ACTIVE, which for a multi-home file would pour every section into one home
    // — the exact mixing the sectioned format exists to prevent.
    householdId: target,
    replaceHousehold: options.replaceHousehold === true,
    payload: {
      fromBackupAt: payload.createdAt,
      sourceDeviceId: payload.deviceId,
      householdReplaced: options.replaceHousehold === true,
      restoreEpoch: Date.now(),
    },
  });
  const after = await getLocalHouseSession(
    options.replaceHousehold ? section.householdId : target,
  );
  return summarizeHouseLedger(after.ledger);
}

export async function restoreHouseBackup(
  archiveJson: string,
  phrase: string,
  options: HouseRestoreOptions = {},
): Promise<HouseRestoreResult> {
  if (!isLocalHouseSessionOpen()) {
    throw new HouseLocalNotReadyError();
  }

  const payload = options.verifiedPayload ?? openBackupArchive(archiveJson, phrase);
  const { scope, sections } = parseHouseBackupSnapshot(payload.snapshotJson);

  if (scope === 'multi') {
    return restoreMultiHouseBackup(sections, payload, options);
  }

  // --- The single-home archive, unchanged -----------------------------------
  // "All homes" is a request about the FILE, and this file holds one home, so it
  // means the same thing as saying nothing: restore it where it belongs.
  const requested = isAllHomesTarget(options.householdId) ? null : options.householdId;
  const householdId = requested ?? getActiveHouseholdId();
  if (!householdId) throw new HouseLocalNotReadyError();

  const section = sections[0];
  const session = await getLocalHouseSession(householdId);
  const live = session.ledger;

  const replaceHousehold =
    options.allowHouseholdReplace === true && live.household.id !== section.householdId;
  if (live.household.id !== section.householdId && !replaceHousehold) {
    // Named for the member, not the engineer: with multi-property this is a
    // realistic mistake (picking the cabin's archive while the house is open),
    // not a corruption — so the only useful thing to say is what to do about it.
    const owner = localPropertyName(section.householdId);
    throw new Error(
      owner
        ? `This backup belongs to “${owner}”. Switch to that home and try again.`
        : "This backup belongs to a home that isn't on this device. Join that home here first, then restore.",
    );
  }

  const summary = await applyHouseSection(
    section,
    { createdAt: payload.createdAt, deviceId: payload.deviceId },
    { replaceHousehold, intoHouseholdId: householdId },
  );
  return {
    householdId: summary.householdId,
    summary,
    blobManifest: summary.blobManifest,
    households: [
      {
        householdId: summary.householdId,
        propertyName: summary.propertyName,
        status: 'restored',
        message: `${summary.propertyName || 'Your home'} is back on this device.`,
        summary,
      },
    ],
  };
}

/**
 * Walk a multi-home file, home by home, into the homes this device holds.
 *
 * Three rules, and each of them is about not guessing:
 *
 *  - a section is only ever applied to the home whose id it carries. There is no
 *    "replace" here: the file already says which home each row belongs to, and
 *    overriding that would be exactly the mixing the format prevents;
 *  - a section for a home this device does not hold is REPORTED, not dropped
 *    silently and not forced somewhere. That is the member who left a household,
 *    or who has not joined it on this phone yet, and the honest answer is "join
 *    it here first";
 *  - one home failing never costs the others theirs. A file is restored as far
 *    as it can be, and what did not land is named.
 */
async function restoreMultiHouseBackup(
  sections: HouseBackupSection[],
  payload: { snapshotJson: string; householdId: string; deviceId: string; createdAt: string },
  options: HouseRestoreOptions,
): Promise<HouseRestoreResult> {
  const onDevice = new Set(listLocalHouseProperties().map((entry) => entry.householdId));
  const only =
    options.householdId && !isAllHomesTarget(options.householdId) ? options.householdId : null;

  if (only && !sections.some((section) => section.householdId === only)) {
    const wanted = localPropertyName(only) ?? 'that home';
    throw new Error(
      `This backup holds ${sections
        .map((section) => `“${section.propertyName}”`)
        .join(', ')} — it has nothing for ${wanted}.`,
    );
  }

  const results: HouseRestoreHouseholdResult[] = [];
  const restored: HouseBackupSummary[] = [];

  for (const section of sections) {
    const name = section.propertyName || 'Home';
    if (only && section.householdId !== only) {
      results.push({
        householdId: section.householdId,
        propertyName: name,
        status: 'not_selected',
        message: `Left alone — you chose to restore only one home from this backup.`,
      });
      continue;
    }
    if (!onDevice.has(section.householdId)) {
      results.push({
        householdId: section.householdId,
        propertyName: name,
        status: 'not_on_device',
        message: `“${name}” is not on this device. Join that home here, then restore this backup again.`,
      });
      continue;
    }
    try {
      const summary = await applyHouseSection(section, {
        createdAt: payload.createdAt,
        deviceId: payload.deviceId,
      });
      restored.push(summary);
      results.push({
        householdId: summary.householdId,
        propertyName: summary.propertyName || name,
        status: 'restored',
        message: `${summary.propertyName || name} is back on this device.`,
        summary,
      });
    } catch (error) {
      console.error('[house-restore] section failed', section.householdId, error);
      results.push({
        householdId: section.householdId,
        propertyName: name,
        status: 'failed',
        message:
          error instanceof Error && error.message
            ? error.message
            : `Could not restore “${name}”.`,
      });
    }
  }

  if (restored.length === 0) {
    const failure = results.find((entry) => entry.status === 'failed');
    throw new Error(
      failure?.message ??
        'None of the homes in this backup are on this device. Join them here first, then restore.',
    );
  }

  const summary = restored.length === 1 ? restored[0] : aggregateHouseSummaries(restored);
  return {
    householdId: restored[0].householdId,
    summary,
    blobManifest: summary.blobManifest,
    households: results,
  };
}

/** Write an archive to a shareable file and return its path. */
export async function writeHouseBackupToFile(
  archiveJson: string,
  propertyName: string,
): Promise<string> {
  const path = `${FileSystem.cacheDirectory ?? ''}${houseBackupFileName(propertyName)}`;
  await FileSystem.writeAsStringAsync(path, archiveJson);
  return path;
}

// --- Restore, as something a background runner can drive ---------------------

export type HouseRestoreProgressStage =
  | 'preparing'
  | 'deriving_key'
  | 'decrypting'
  | 'applying'
  | 'done';

export type HouseRestoreProgress = {
  stage: HouseRestoreProgressStage;
  /** Rough 0–1 floor for UI; decrypt may animate ahead on the UI thread. */
  progress: number;
  message: string;
};

export type HouseRestorePickResult =
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }
  | {
      status: 'needs_phrase';
      archiveJson: string;
      householdHint: string | null;
      /**
       * The hinted home's name, when this device holds it. Lets the caller say
       * "this is your Lake Cabin" — or, when it is null, warn before Argon2
       * spends a minute proving the archive was never for this device.
       *
       * `HOUSE_ALL_HOMES_LABEL` for a whole-device file: which homes are inside
       * is sealed, and deliberately so, but the envelope says there is more than
       * one and the member should be told that much before they commit minutes.
       */
      propertyName: string | null;
      /** True when the envelope is addressed to every home rather than to one. */
      coversAllHomes: boolean;
      createdAtHint: string | null;
    };

/**
 * The home an archive envelope names, resolved for display.
 *
 * Three answers, and they are genuinely different: a home on this device (say
 * its name), the whole-device file (say so), or a home that is not here (null —
 * "switch to it" is not advice anyone can act on).
 */
export function describeArchiveHouseholdHint(householdHint: string | null): string | null {
  if (!householdHint) return null;
  if (isAllHomesTarget(householdHint)) return HOUSE_ALL_HOMES_LABEL;
  return localPropertyName(householdHint);
}

/**
 * Name a property the way the member does, when this device holds it.
 *
 * Returns null for a home that is not on this device — a real case now that
 * archives travel between members, and one the caller has to word differently
 * because "switch to it" is not advice anyone can act on.
 */
export function localPropertyName(householdId: string): string | null {
  const known = listLocalHouseProperties().find((entry) => entry.householdId === householdId);
  const name = known?.name.trim();
  return name ? name : null;
}

/** Pick a backup archive file; caller collects the recovery phrase next. */
export async function pickHouseBackupArchive(): Promise<HouseRestorePickResult> {
  try {
    // Prefer `*/*` so AirDropped `*.backup.json` files show up — MIME filters
    // often hide custom double-extensions on iOS Files.
    const picked = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) {
      return { status: 'cancelled' };
    }
    const archiveJson = await FileSystem.readAsStringAsync(picked.assets[0].uri);
    let householdHint: string | null = null;
    let createdAtHint: string | null = null;
    try {
      const meta = JSON.parse(archiveJson) as {
        meta?: { householdId?: string; createdAt?: string };
      };
      householdHint = meta.meta?.householdId ?? null;
      createdAtHint = meta.meta?.createdAt ?? null;
    } catch {
      // Not readable as an archive envelope — verify will name the problem.
    }
    return {
      status: 'needs_phrase',
      archiveJson,
      householdHint,
      propertyName: describeArchiveHouseholdHint(householdHint),
      coversAllHomes: isAllHomesTarget(householdHint),
      createdAtHint,
    };
  } catch {
    return { status: 'failed', message: 'Could not open that backup file.' };
  }
}

/**
 * The one line a finished restore says, for a toast that has to survive being
 * read minutes later on a different screen.
 *
 * One home reads as it always did. Several read as a count, and — the part that
 * matters — anything the file could NOT put back is named rather than averaged
 * away. "3 homes restored" over a file that silently skipped the cabin is the
 * failure mode this whole per-section design exists to prevent, so it must not
 * be reintroduced in the sentence at the end of it.
 */
export function houseRestoreOutcomeMessage(result: HouseRestoreResult): string {
  const restored = result.households.filter((entry) => entry.status === 'restored');
  const missed = result.households.filter(
    (entry) => entry.status === 'not_on_device' || entry.status === 'failed',
  );

  if (restored.length <= 1 && missed.length === 0) {
    // The section's own name, not the summary's: they agree on every real
    // restore, and the section is the one that is still right when the summary
    // is the combined figures.
    const name = restored[0]?.propertyName || result.summary.propertyName;
    return `${name || 'Your home'} is back on this device.`;
  }

  const head =
    restored.length === 1
      ? `${restored[0].propertyName} is back on this device`
      : `${restored.length} homes are back on this device`;
  if (missed.length === 0) return `${head}.`;
  return `${head} — ${missed.map((entry) => entry.propertyName).join(', ')} could not be restored.`;
}

/**
 * Verify, then apply — the whole restore, reporting progress as it goes.
 *
 * Split out of the screen so it can run under `restoreTaskStore` with nobody
 * watching: Argon2id on a phone is minutes, and a member who walks away must
 * still get their home back. Never throws; every failure comes back as
 * `status: 'failed'` with copy that is safe to show.
 */
export async function confirmAndRestoreHouseBackup(
  archiveJson: string,
  phrase: string,
  options: HouseRestoreOptions & { onProgress?: (update: HouseRestoreProgress) => void } = {},
): Promise<{
  status: 'ok' | 'failed';
  message: string;
  summary?: HouseBackupSummary;
  /** Per-home outcomes — one entry for a per-home file, several for a whole-device one. */
  households?: HouseRestoreHouseholdResult[];
}> {
  const report = (update: HouseRestoreProgress) => {
    try {
      options.onProgress?.(update);
    } catch {
      // UI progress must never fail the restore.
    }
  };

  report({ stage: 'preparing', progress: 0.02, message: 'Preparing…' });
  // Double yield so the progress bar can paint + start its UI-thread animation
  // before synchronous Argon2 blocks Hermes.
  await new Promise<void>((resolve) => setTimeout(resolve, 32));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => setTimeout(resolve, 48));

  report({ stage: 'deriving_key', progress: 0.08, message: 'Decrypting…' });
  console.log('[house-restore] verify…', 'archiveBytes=', archiveJson.length);
  const t0 = Date.now();
  let verified: BackupVerifyResult;
  try {
    verified = verifyHouseBackup(archiveJson, phrase);
  } catch (error) {
    console.error('[house-restore] verify threw', error);
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Verify crashed.',
    };
  }
  console.log('[house-restore] verify done', 'ms=', Date.now() - t0, 'status=', verified.status);
  if (verified.status !== 'ok' || !verified.payload) {
    console.warn('[house-restore] verify failed', verified.message);
    return { status: 'failed', message: verified.message };
  }

  report({ stage: 'decrypting', progress: 0.9, message: 'Opening backup…' });
  await new Promise<void>((resolve) => setTimeout(resolve, 16));

  try {
    // A long Argon2 pass can outlive an in-flight ensureSession (or a fresh
    // install with tokens but no open ledger yet). Re-open before mutating.
    if (!isLocalHouseSessionOpen()) {
      report({ stage: 'applying', progress: 0.92, message: 'Opening your home…' });
      await ensureHouseLocalSession();
    }
    if (!isLocalHouseSessionOpen()) {
      return {
        status: 'failed',
        message: 'Your home is not open on this device yet. Sign in once, then retry the restore.',
      };
    }

    report({ stage: 'applying', progress: 0.94, message: 'Writing rows…' });
    const restored = await restoreHouseBackup(archiveJson, phrase, {
      ...options,
      verifiedPayload: verified.payload,
    });
    report({ stage: 'done', progress: 1, message: 'Restored' });
    return {
      status: 'ok',
      message: houseRestoreOutcomeMessage(restored),
      summary: restored.summary,
      households: restored.households,
    };
  } catch (error) {
    console.error('[house-restore] apply failed', error);
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Restore failed.',
    };
  }
}
