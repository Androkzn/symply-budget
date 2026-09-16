/**
 * Stage He9 — the **local encrypted archive** of the Health ledger (plan §10).
 *
 * ## What this is, and the one thing it deliberately is not
 *
 * He9's stated shape is "Archive v2 + D-20 live-wins, one archive per user".
 * Almost all of that machinery already exists and is NOT duplicated here:
 *
 *  - `engine.ts#exportHealthCheckpointPlaintext` produces the snapshot,
 *  - `@symply/local-first#sealCheckpoint` encrypts and signs it,
 *  - `engine.ts#applyLocalHealthRestore` already implements D-20 live-wins
 *    (restored values carry `RESTORE_HLC`, so a live write or a tombstone beats
 *    them and a restore can never resurrect a deleted row),
 *  - `sync/checkpoints.ts` publishes the same sealed bytes to the relay (He8).
 *
 * What was missing is the *artefact*: those bytes written to a file the person
 * can hand to the OS share sheet. That is this file, and that is all of it.
 *
 * ⚠️ **There is no restore path here, on purpose — see `Q8` below.**
 *
 * ## Why this seals under the HDK and not under a recovery phrase
 *
 * `@symply/local-first` already exports `createBackupArchive` /
 * `openBackupArchive` — an Argon2id, 12-word-recovery-phrase archive, used by
 * `budget/local/backup/budgetBackup.ts` and `house/local/backup/houseBackup.ts`.
 * Reaching for it here would be the obvious move and it is **the wrong one at
 * this stage**: a user-held recovery phrase is literally option (a) of §16 Q8,
 * which is open. Adopting it would answer an open product/security question by
 * writing code, and it would introduce onboarding obligations ("write these
 * twelve words down, they are the only copy") that nobody has signed off.
 *
 * Sealing under the household data key introduces **no new key material and no
 * new decision**. The archive is exactly as openable as the ledger already is:
 * by a device that already holds the HDK. That makes this a *durability copy*
 * of the ledger — the artefact §17's abort row permits — and never a claim that
 * a fresh device can be restored from it.
 *
 * ## Q8, stated in code rather than in a comment
 *
 * §16 Q8 — *"How is the He9 archive keyed, given a `ThisDeviceOnly` DEK?"* — is
 * open, and §17 says the fallback is *"Ship no restore claim; ≥2-device
 * durability copy only"*. §5 is blunter: *"Single-device restore is a total-loss
 * path."* An engineer arriving here to "just wire up restore" must trip over
 * that, not read past it, so the restore verb exists and throws:
 * `restoreHealthLedgerFromArchive()` → `HealthArchiveKeyingUndecidedError`.
 *
 * ## The envelope carries no health data in the clear
 *
 * Everything the person logged lives inside the AEAD chunks. The header holds
 * only what `openCheckpoint` needs to verify and decrypt — ids, the key epoch,
 * the manifest with its version vector, root hash and signature. The version
 * vector does leak an op count per device, which is unavoidable when reusing
 * the checkpoint seal and is already what the relay sees (§Appendix C.1). Row
 * counts are deliberately **not** in the file: they are returned in memory for
 * the confirmation UI instead, because this file leaves the device for a
 * destination the app does not control.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import {
  base64ToBytes,
  bytesToBase64,
  openCheckpoint,
  sealCheckpoint,
  type CheckpointManifest,
  type CheckpointPlaintext,
} from '@symply/local-first';

import {
  exportHealthCheckpointPlaintext,
  getLocalHealthHouseholdKeys,
  getLocalHealthIdentity,
  isLocalHealthSessionOpen,
} from './engine';
import { HealthLocalNotReadyError } from './errors';

/* ==================================================================== */
/* Q8 — the undecided keying, as a tripwire                              */
/* ==================================================================== */

/**
 * The open question, verbatim enough to be greppable and machine-readable.
 *
 * Exported (rather than left as prose) so `he9Backup.copy.test.ts` can assert it
 * is still declared open, and so a future engineer resolving Q8 has exactly one
 * place to change: flip `status`, and every guard below stops being satisfiable
 * by accident.
 */
export const HEALTH_ARCHIVE_KEYING_QUESTION = {
  id: 'Q8',
  status: 'open',
  question: 'How is the He9 archive keyed, given a ThisDeviceOnly DEK?',
  options: [
    'a) user-held recovery phrase / passphrase-wrapped archive',
    'b) escrow the DEK to iCloud Keychain (drop ThisDeviceOnly)',
    'c) require >= 2 enrolled devices before the ledger counts as durable',
  ],
  /** §17: what may ship while it stays open. */
  fallback: 'Ship no restore claim; >=2-device durability copy only',
  /** Not an option: Apple treats Quick Start carrying a ThisDeviceOnly item as a bug. */
  ruledOut: 'Do not rely on Quick Start',
} as const;

/**
 * Thrown by every entry point that would need Q8 answered.
 *
 * A named error rather than a `TODO`: a `TODO` can be deleted by someone who
 * does not know what it guarded, whereas deleting this produces a call to a
 * function that no longer exists.
 */
export class HealthArchiveKeyingUndecidedError extends Error {
  readonly code = 'health_archive_keying_undecided';
  constructor(attempted: string) {
    super(
      `Health He9: "${attempted}" cannot be built until §16 Q8 is answered — ` +
        `${HEALTH_ARCHIVE_KEYING_QUESTION.question} ` +
        `Until then §17 permits only: ${HEALTH_ARCHIVE_KEYING_QUESTION.fallback}.`,
    );
    this.name = 'HealthArchiveKeyingUndecidedError';
  }
}

/* ==================================================================== */
/* Envelope                                                              */
/* ==================================================================== */

export const HEALTH_ARCHIVE_FORMAT = 'symply-health-archive';
export const HEALTH_ARCHIVE_VERSION = 1;

/**
 * The generation stamped into the chunk AAD.
 *
 * `sync/checkpoints.ts` mints published generations as `max(known) + 1`, so the
 * relay's numbering starts at 1 and can never reach 0. Pinning the archive to 0
 * keeps its AAD disjoint from every published checkpoint: an archive chunk can
 * never be mistaken for — or replayed as — generation N of the relay's series,
 * in either direction.
 */
export const HEALTH_ARCHIVE_GENERATION = 0;

/**
 * How this archive is keyed, recorded *inside* the file.
 *
 * A reader (including a future version of this app) must be able to tell what
 * would open the file without guessing. When Q8 lands, a phrase-wrapped archive
 * gets a different value here and the two are distinguishable on sight.
 */
export const HEALTH_ARCHIVE_KEYING = 'household-key-held-by-enrolled-devices';

export type HealthArchiveEnvelope = {
  format: typeof HEALTH_ARCHIVE_FORMAT;
  version: typeof HEALTH_ARCHIVE_VERSION;
  /** ISO stamp taken on the device at archive time. */
  createdAt: string;
  householdId: string;
  keyEpoch: number;
  keying: typeof HEALTH_ARCHIVE_KEYING;
  /** Plain-language statements about what this file is. See `HEALTH_ARCHIVE_NOTES`. */
  notes: readonly string[];
  manifest: CheckpointManifest;
  /** AEAD ciphertext, one entry per checkpoint chunk. */
  chunksBase64: string[];
};

/**
 * What the file says about itself.
 *
 * Written for the person who finds this file in two years and has to work out
 * whether it is worth keeping. Every sentence is a fact about the artefact, and
 * none of them says the file can restore a new phone — because it cannot, and a
 * hopeful sentence here would be read as a promise. `he9Backup.copy.test.ts`
 * greps these for restore claims.
 */
export const HEALTH_ARCHIVE_NOTES: readonly string[] = [
  'This file is an encrypted copy of the health records held by Symply Health on this device.',
  'It can only be opened by a device that is already set up with your Symply Health data.',
  'It is not a way to move your records onto a new device.',
  'Nothing readable is stored outside the encrypted section of this file.',
] as const;

/* ==================================================================== */
/* Build                                                                 */
/* ==================================================================== */

export type HealthArchiveSummary = {
  householdId: string;
  createdAt: string;
  /** Every row in the archive, tombstones included — they are what makes it converge. */
  totalRows: number;
  /** Rows that still exist as far as the person is concerned. */
  liveRows: number;
  /** Live rows per ledger table, for the "what is in this file" confirmation. */
  tableCounts: Record<string, number>;
  chunkCount: number;
  /** Size of the serialised envelope. Reported, never guessed at by the UI. */
  bytes: number;
};

export type HealthArchive = {
  envelope: HealthArchiveEnvelope;
  json: string;
  summary: HealthArchiveSummary;
};

function requireOpenSession(): void {
  if (!isLocalHealthSessionOpen()) throw new HealthLocalNotReadyError();
}

function summarise(
  plaintext: CheckpointPlaintext,
  envelope: HealthArchiveEnvelope,
  json: string,
): HealthArchiveSummary {
  const tableCounts: Record<string, number> = {};
  let liveRows = 0;
  for (const row of plaintext.rows) {
    if (row.deleted) continue;
    liveRows += 1;
    tableCounts[row.table] = (tableCounts[row.table] ?? 0) + 1;
  }
  return {
    householdId: envelope.householdId,
    createdAt: envelope.createdAt,
    totalRows: plaintext.rows.length,
    liveRows,
    tableCounts,
    chunkCount: envelope.chunksBase64.length,
    bytes: json.length,
  };
}

/**
 * Snapshot the ledger and seal it under the household data key.
 *
 * No network, no file system: the caller gets bytes. Keeping the crypto path
 * I/O-free is what lets `he9Backup.archive.test.ts` assert "the archive is never
 * plaintext" against the real seal rather than against a mocked writer.
 */
export async function buildHealthLedgerArchive(options?: {
  now?: Date;
}): Promise<HealthArchive> {
  requireOpenSession();

  const identity = getLocalHealthIdentity();
  const keys = getLocalHealthHouseholdKeys();
  // The same snapshot the He8 publisher takes — one producer of checkpoint
  // plaintext, so an archive and a published checkpoint can never disagree
  // about what "the ledger" means.
  const plaintext = await exportHealthCheckpointPlaintext();

  const sealed = sealCheckpoint({
    plaintext,
    hdk: keys.hdk,
    generation: HEALTH_ARCHIVE_GENERATION,
    signerDeviceId: identity.deviceId,
    signingPrivateKey: identity.signingPrivateKey,
  });

  const envelope: HealthArchiveEnvelope = {
    format: HEALTH_ARCHIVE_FORMAT,
    version: HEALTH_ARCHIVE_VERSION,
    createdAt: (options?.now ?? new Date()).toISOString(),
    householdId: plaintext.householdId,
    keyEpoch: plaintext.keyEpoch,
    keying: HEALTH_ARCHIVE_KEYING,
    notes: [...HEALTH_ARCHIVE_NOTES],
    manifest: sealed.manifest,
    chunksBase64: sealed.chunks.map((chunk) => bytesToBase64(chunk)),
  };

  const json = JSON.stringify(envelope, null, 2);
  return { envelope, json, summary: summarise(plaintext, envelope, json) };
}

/** `symply-health-archive-2026-08-14.json` — dated, so repeats do not collide. */
export function healthArchiveFileName(day: string): string {
  return `symply-health-archive-${day}.json`;
}

/* ==================================================================== */
/* Read back — verification, NOT restore                                 */
/* ==================================================================== */

export function parseHealthArchiveJson(json: string): HealthArchiveEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('This file is not a Symply Health archive.');
  }
  const candidate = parsed as Partial<HealthArchiveEnvelope> | null;
  if (
    !candidate ||
    candidate.format !== HEALTH_ARCHIVE_FORMAT ||
    candidate.version !== HEALTH_ARCHIVE_VERSION ||
    !Array.isArray(candidate.chunksBase64) ||
    !candidate.manifest
  ) {
    throw new Error('This file is not a Symply Health archive.');
  }
  return candidate as HealthArchiveEnvelope;
}

/**
 * Verify and decrypt an archive **without touching the ledger**.
 *
 * This is the honest half of "restore": it proves the file still opens on this
 * device, which is the only durability claim the archive can currently support.
 * It returns the plaintext and stops. Installing it is a separate act that Q8
 * gates — see `restoreHealthLedgerFromArchive`.
 *
 * The signature is verified against **this device's** signing key unless a
 * public key is passed in. An archive written by the person's other device
 * cannot be verified offline (the key lives on the control plane, which is what
 * `sync/checkpoints.ts` queries), and silently skipping the check would turn a
 * signed artefact into an unsigned one.
 */
export function openHealthLedgerArchive(
  envelope: HealthArchiveEnvelope,
  options?: { signerPublicKey?: Uint8Array },
): CheckpointPlaintext {
  requireOpenSession();

  const identity = getLocalHealthIdentity();
  const keys = getLocalHealthHouseholdKeys();

  const signerPublicKey = options?.signerPublicKey ?? identity.signingPublicKey;
  if (!options?.signerPublicKey && envelope.manifest.signerDeviceId !== identity.deviceId) {
    throw new Error(
      "This archive was saved by your other device. Open it there, or pass that device's signing key.",
    );
  }

  return openCheckpoint({
    chunks: envelope.chunksBase64.map((chunk) => base64ToBytes(chunk)),
    manifest: envelope.manifest,
    hdk: keys.hdk,
    signerPublicKey,
  });
}

/**
 * "Does my archive still open?" — the check a durability screen can offer today.
 *
 * Returns row counts and nothing else. Explicitly not a preview of a restore,
 * because there is no restore to preview.
 */
export function verifyHealthLedgerArchive(json: string): {
  ok: true;
  createdAt: string;
  householdId: string;
  totalRows: number;
  liveRows: number;
} {
  const envelope = parseHealthArchiveJson(json);
  const plaintext = openHealthLedgerArchive(envelope);
  let liveRows = 0;
  for (const row of plaintext.rows) if (!row.deleted) liveRows += 1;
  return {
    ok: true,
    createdAt: envelope.createdAt,
    householdId: envelope.householdId,
    totalRows: plaintext.rows.length,
    liveRows,
  };
}

/**
 * **Not implemented, and not an oversight.** Always throws.
 *
 * Restoring an archive onto a device is the operation Q8 keys. Two facts make
 * every implementation of it a product decision rather than an engineering one:
 *
 *  1. On a **fresh** device there is no HDK to decrypt this file with, and the
 *     DEK that would have carried one is `ThisDeviceOnly` — Apple states such an
 *     item is *"useless if it's restored to a different device"* (§5). So the
 *     only way to make this work is to pick (a), (b) or (c) from Q8.
 *  2. On an **already enrolled** device the file opens, but installing it is a
 *     merge with real semantics (D-20 live-wins, `applyLocalHealthRestore`) and
 *     shipping the verb without the answer to (1) would put a "Restore from
 *     backup" row in front of a person whose phone is already gone.
 *
 * §17: *"Ship no restore claim."* This is that, enforced.
 */
export function restoreHealthLedgerFromArchive(): never {
  throw new HealthArchiveKeyingUndecidedError('restoreHealthLedgerFromArchive');
}

/* ==================================================================== */
/* The verb                                                              */
/* ==================================================================== */

export type HealthArchiveStatus = 'shared' | 'unsupported' | 'failed';

export interface HealthArchiveResult {
  status: HealthArchiveStatus;
  /** Friendly copy for the UI. NEVER a system or network error string. */
  message: string;
  summary: HealthArchiveSummary | null;
}

export const HEALTH_ARCHIVE_FAILED_MESSAGE =
  'We could not put your encrypted copy together just now. Try again in a moment.';

export const HEALTH_ARCHIVE_NO_SHEET_MESSAGE =
  'This device has no way to share files, so the encrypted copy could not be handed over.';

/**
 * Seal the ledger, write one file, hand it to the share sheet.
 *
 * The file goes to the app's CACHE directory and is deleted once the sheet
 * closes — the same discipline `healthExport.ts` documents, and it matters more
 * here: a sealed archive still sitting in app storage is a second copy of the
 * whole health record on a handset that may be shared, and by the time
 * `shareAsync` resolves the destination the person chose already has its own.
 */
export async function shareHealthLedgerArchive(options?: {
  now?: Date;
}): Promise<HealthArchiveResult> {
  const now = options?.now ?? new Date();

  let archive: HealthArchive;
  try {
    archive = await buildHealthLedgerArchive({ now });
  } catch {
    return { status: 'failed', message: HEALTH_ARCHIVE_FAILED_MESSAGE, summary: null };
  }

  const path = `${FileSystem.cacheDirectory ?? ''}${healthArchiveFileName(
    now.toISOString().slice(0, 10),
  )}`;

  try {
    await FileSystem.writeAsStringAsync(path, archive.json);
  } catch {
    return { status: 'failed', message: HEALTH_ARCHIVE_FAILED_MESSAGE, summary: archive.summary };
  }

  try {
    if (!(await Sharing.isAvailableAsync())) {
      return {
        status: 'unsupported',
        message: HEALTH_ARCHIVE_NO_SHEET_MESSAGE,
        summary: archive.summary,
      };
    }
    await Sharing.shareAsync(path, {
      // Valid JSON with base64 ciphertext inside, so it survives every share
      // target that mangles unknown types. The bytes are opaque either way.
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Save an encrypted copy',
    });
    return {
      status: 'shared',
      message:
        archive.summary.liveRows === 0
          ? 'Your encrypted copy is ready. There are no health records on this device yet, so it is empty.'
          : `Your encrypted copy is ready — ${archive.summary.liveRows} record${
              archive.summary.liveRows === 1 ? '' : 's'
            }.`,
      summary: archive.summary,
    };
  } catch {
    return { status: 'failed', message: HEALTH_ARCHIVE_FAILED_MESSAGE, summary: archive.summary };
  } finally {
    // Best effort: a failure here leaves a file in the app's own cache, which
    // the OS reclaims — but never leave it on purpose.
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
  }
}
