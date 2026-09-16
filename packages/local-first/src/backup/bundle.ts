/**
 * Multi-household backup bundle — one file, one recovery phrase, one section
 * per household (TRD §11, BR-016).
 *
 * ## Why a bundle replaced the per-household archive
 *
 * `archive.ts` (v2) seals exactly one household. A device that holds three
 * budgets therefore produced three files, each under its OWN twelve words, each
 * with its own schedule and its own retention. The member had to keep three
 * secrets to be covered, and losing any one of them lost a budget silently — the
 * other two archives still restored, so nothing ever looked broken. A bundle
 * makes "back up" mean the same thing as "my data is safe" again.
 *
 * ## One KDF pass, N sealed sections
 *
 * The naive bundle is a list of v2 archives. It is also unusable: opening one
 * costs an Argon2id pass (`RECOVERY_KDF_MOBILE` is budgeted at up to ~2.5 min on
 * device), so three households would be three passes — seven minutes to restore,
 * and the same again to seal.
 *
 * So the phrase is stretched ONCE, against one bundle-wide salt, and the
 * resulting recovery key seals each household separately with AES-GCM. Argon2
 * cost is flat in the number of households; AES-GCM is fast enough that the
 * per-section work disappears next to it. What the separate sections buy:
 *
 *  - **Selective restore.** Opening the holiday budget does not require
 *    decrypting the main one.
 *  - **Damage containment.** A section whose bytes were corrupted in transit
 *    fails on its own tag check; every other household still opens. A single
 *    ciphertext over all three would lose all three.
 *  - **No cross-household substitution.** Each section's AAD binds its
 *    `householdId`, so a section lifted from another bundle (or renamed inside
 *    this one) fails to decrypt rather than restoring household A's data under
 *    household B's name.
 *
 * ## What is in the clear
 *
 * Household *ids* — opaque `hh_local_<hex>` handles — and the count of them.
 * That matches v2, whose `meta.householdId` was always cleartext, and it is what
 * lets a restore screen say "3 budgets in this file" before spending a minute on
 * Argon2. Household *names* are deliberately NOT in the clear: "Nan's care
 * costs" is a fact about a person, and the picker can show names from the
 * plaintext once the single KDF pass has run anyway.
 */

import { aeadDecrypt, aeadEncrypt } from '../crypto/aead';
import { base64ToBytes, bytesToBase64 } from '../crypto/base64';
import { utf8Decode, utf8Encode } from '../crypto/bytes';
import { deriveRecoveryKey, RECOVERY_KDF_MOBILE, type RecoveryKdfParams } from '../crypto/keys';

import {
  BACKUP_ARCHIVE_FORMAT,
  BACKUP_ARCHIVE_VERSION,
  kdfMetaOf,
  kdfParamsFromMeta,
  type BackupArchiveKdfMeta,
} from './archive';
import {
  generateRecoveryPhrase,
  isValidRecoveryPhrase,
  normalizeRecoveryPhrase,
  randomRecoverySalt,
  recoveryPhraseToSecret,
} from './phrase';

export const BACKUP_BUNDLE_VERSION = 3;
export const BACKUP_BUNDLE_AAD = 'local-first-backup-v3';

/**
 * Per-section AAD. The household id is authenticated but not encrypted, so a
 * section cannot be moved between households or between bundles: GCM's tag check
 * fails before a single byte of plaintext is returned.
 */
export function bundleSectionAad(householdId: string): Uint8Array {
  return utf8Encode(`${BACKUP_BUNDLE_AAD}|${householdId}`);
}

/** What one household contributes to a bundle, before sealing. */
export interface BackupBundleSectionPayload {
  /** Opaque ledger/snapshot JSON (caller-defined), exactly as v2. */
  snapshotJson: string;
  householdId: string;
  /**
   * Sealed, not in the outer meta — see the module header. Restore UIs read it
   * from here after the one KDF pass.
   */
  householdName: string;
  deviceId: string;
  keyEpoch: number;
  createdAt: string;
  /**
   * Opaque caller-defined blob sidecar — Budget puts wish/receipt attachment
   * bytes here. Kept beside `snapshotJson` rather than inside it so the ledger
   * projection never has to step over a megabyte of base64 to find its tables,
   * and so a caller that does not carry blobs pays nothing for the field.
   */
  attachmentsJson?: string;
}

export interface BackupBundleSectionDocument {
  householdId: string;
  /** AES-GCM envelope (base64): nonce || ciphertext||tag. */
  ciphertextB64: string;
}

export interface BackupBundleDocument {
  format: typeof BACKUP_ARCHIVE_FORMAT;
  version: typeof BACKUP_BUNDLE_VERSION;
  /** Argon2 salt (base64) — one for the whole bundle, one derivation. */
  saltB64: string;
  meta: {
    createdAt: string;
    /** The device that sealed it; a hint for "which phone was this?". */
    deviceId: string;
    kdf: BackupArchiveKdfMeta;
    /** Ids only. Names live inside the ciphertext. */
    householdIds: string[];
  };
  households: BackupBundleSectionDocument[];
}

export interface BackupBundleCreateResult {
  phrase: string;
  bundle: BackupBundleDocument;
  bundleJson: string;
}

export type BackupBundleSectionStatus = 'ok' | 'decrypt_failed' | 'corrupt';

export interface BackupBundleSectionResult {
  householdId: string;
  status: BackupBundleSectionStatus;
  /** Present only when `status === 'ok'`. */
  payload?: BackupBundleSectionPayload;
  message: string;
}

export type BackupBundleVerifyStatus =
  | 'ok'
  | 'partial'
  | 'invalid_phrase'
  | 'decrypt_failed'
  | 'corrupt';

export interface BackupBundleVerifyResult {
  status: BackupBundleVerifyStatus;
  /** One entry per section, in file order, whatever the overall status. */
  households: BackupBundleSectionResult[];
  meta?: BackupBundleDocument['meta'];
  message: string;
}

/**
 * Tell the two file shapes apart without decrypting either.
 *
 * Restore is the caller that needs this: a member's Files folder holds both
 * shapes for as long as pre-bundle archives survive, and picking the wrong
 * parser would report a perfectly good v2 archive as damaged.
 */
export type BackupFileKind = 'bundle' | 'archive' | 'unknown';

export function readBackupFileKind(json: string): BackupFileKind {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return 'unknown';
  }
  if (!parsed || typeof parsed !== 'object') return 'unknown';
  const doc = parsed as { format?: unknown; version?: unknown };
  if (doc.format !== BACKUP_ARCHIVE_FORMAT) return 'unknown';
  if (doc.version === BACKUP_BUNDLE_VERSION) return 'bundle';
  if (doc.version === BACKUP_ARCHIVE_VERSION) return 'archive';
  return 'unknown';
}

/**
 * Seal every household in `sections` into one bundle.
 *
 * `sections` may be empty in principle; callers should refuse before getting
 * here, because a bundle with no households is a backup that protects nothing
 * while looking exactly like one that does.
 */
export function createBackupBundle(
  sections: BackupBundleSectionPayload[],
  options?: {
    phrase?: string;
    salt?: Uint8Array;
    kdf?: RecoveryKdfParams;
    deviceId?: string;
    createdAt?: string;
  },
): BackupBundleCreateResult {
  const phrase = normalizeRecoveryPhrase(options?.phrase ?? generateRecoveryPhrase());
  if (!isValidRecoveryPhrase(phrase)) {
    throw new Error('createBackupBundle: invalid recovery phrase');
  }
  if (sections.length === 0) {
    throw new Error('createBackupBundle: no households to back up');
  }
  const seen = new Set<string>();
  for (const section of sections) {
    if (!section.householdId) {
      throw new Error('createBackupBundle: section without a household id');
    }
    // A duplicate id would make the section AAD ambiguous and let a restore
    // apply one household's rows twice while reporting two households covered.
    if (seen.has(section.householdId)) {
      throw new Error(`createBackupBundle: duplicate household ${section.householdId}`);
    }
    seen.add(section.householdId);
  }

  const salt = options?.salt ?? randomRecoverySalt();
  const kdf = options?.kdf ?? RECOVERY_KDF_MOBILE;
  const createdAt = options?.createdAt ?? new Date().toISOString();
  const deviceId = options?.deviceId ?? sections[0].deviceId;

  const secret = recoveryPhraseToSecret(phrase);
  const recoveryKey = deriveRecoveryKey(secret, salt, kdf);
  try {
    const households = sections.map((section) => ({
      householdId: section.householdId,
      ciphertextB64: bytesToBase64(
        aeadEncrypt(
          recoveryKey,
          utf8Encode(JSON.stringify(section)),
          bundleSectionAad(section.householdId),
        ),
      ),
    }));

    const bundle: BackupBundleDocument = {
      format: BACKUP_ARCHIVE_FORMAT,
      version: BACKUP_BUNDLE_VERSION,
      saltB64: bytesToBase64(salt),
      meta: {
        createdAt,
        deviceId,
        kdf: kdfMetaOf(kdf),
        householdIds: sections.map((section) => section.householdId),
      },
      households,
    };
    return {
      phrase,
      bundle,
      // Not pretty-printed, unlike v2: a bundle carries every household on the
      // device plus attachment bytes, and two-space indentation on a 30 MB file
      // is megabytes of spaces to encrypt, upload and store.
      bundleJson: JSON.stringify(bundle),
    };
  } finally {
    recoveryKey.fill(0);
  }
}

export function parseBackupBundleJson(json: string): BackupBundleDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Backup file is not valid JSON');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as BackupBundleDocument).format !== BACKUP_ARCHIVE_FORMAT ||
    (parsed as BackupBundleDocument).version !== BACKUP_BUNDLE_VERSION
  ) {
    throw new Error('Unsupported backup file format');
  }
  const doc = parsed as BackupBundleDocument;
  if (typeof doc.saltB64 !== 'string' || !Array.isArray(doc.households)) {
    throw new Error('Backup file is missing its households');
  }
  return doc;
}

/**
 * Decrypt every section (BR-051 dry-run: nothing is applied).
 *
 * Section failures are reported per household rather than collapsing the whole
 * file: with several budgets in one bundle, losing one to a bad byte must not be
 * indistinguishable from losing all of them. `status` is `partial` exactly when
 * at least one section opened and at least one did not.
 */
export function verifyBackupBundle(
  bundleJson: string,
  phrase: string,
): BackupBundleVerifyResult {
  const normalized = normalizeRecoveryPhrase(phrase);
  if (!isValidRecoveryPhrase(normalized)) {
    return {
      status: 'invalid_phrase',
      households: [],
      message: 'That recovery phrase is not valid. Check the words and try again.',
    };
  }

  let bundle: BackupBundleDocument;
  try {
    bundle = parseBackupBundleJson(bundleJson);
  } catch {
    return {
      status: 'corrupt',
      households: [],
      message: 'This backup file is damaged or not a Symply backup.',
    };
  }

  const kdf = kdfParamsFromMeta(bundle.meta?.kdf);
  const secret = recoveryPhraseToSecret(normalized);
  const recoveryKey = deriveRecoveryKey(secret, base64ToBytes(bundle.saltB64), kdf);
  try {
    const households = bundle.households.map((section): BackupBundleSectionResult =>
      openSection(recoveryKey, section),
    );

    const opened = households.filter((entry) => entry.status === 'ok').length;
    if (households.length === 0) {
      return {
        status: 'corrupt',
        households,
        meta: bundle.meta,
        message: 'This backup file has no households in it.',
      };
    }
    if (opened === 0) {
      return {
        status: 'decrypt_failed',
        households,
        meta: bundle.meta,
        message: 'Could not open this backup with that recovery phrase.',
      };
    }
    if (opened < households.length) {
      const lost = households.length - opened;
      return {
        status: 'partial',
        households,
        meta: bundle.meta,
        message:
          lost === 1
            ? 'Backup verified, but one household in it is damaged and cannot be restored.'
            : `Backup verified, but ${lost} households in it are damaged and cannot be restored.`,
      };
    }
    return {
      status: 'ok',
      households,
      meta: bundle.meta,
      message:
        households.length === 1
          ? 'Backup verified. You can restore when you are ready.'
          : `Backup verified — ${households.length} households. You can restore when you are ready.`,
    };
  } finally {
    recoveryKey.fill(0);
  }
}

function openSection(
  recoveryKey: Uint8Array,
  section: BackupBundleSectionDocument,
): BackupBundleSectionResult {
  const householdId = typeof section?.householdId === 'string' ? section.householdId : '';
  if (!householdId || typeof section?.ciphertextB64 !== 'string') {
    return {
      householdId,
      status: 'corrupt',
      message: 'This part of the backup is damaged.',
    };
  }
  try {
    const opened = aeadDecrypt(
      recoveryKey,
      base64ToBytes(section.ciphertextB64),
      bundleSectionAad(householdId),
    );
    const payload = JSON.parse(utf8Decode(opened)) as BackupBundleSectionPayload;
    if (typeof payload.snapshotJson !== 'string' || payload.householdId !== householdId) {
      // The id mismatch is not paranoia about a hand-edited file — the AAD
      // already rules that out — it is the check that catches a section sealed
      // by a future/buggy writer whose outer id disagrees with its own payload,
      // which would restore into the wrong household.
      return {
        householdId,
        status: 'corrupt',
        message: 'This part of the backup is damaged.',
      };
    }
    return { householdId, status: 'ok', payload, message: 'Ready to restore.' };
  } catch {
    return {
      householdId,
      status: 'decrypt_failed',
      message: 'Could not open this part of the backup.',
    };
  }
}

/**
 * Open a bundle, throwing unless at least one household came out.
 * Callers decide what to do with a `partial` — see `verifyBackupBundle`.
 */
export function openBackupBundle(
  bundleJson: string,
  phrase: string,
): BackupBundleVerifyResult {
  const result = verifyBackupBundle(bundleJson, phrase);
  if (result.status !== 'ok' && result.status !== 'partial') {
    throw new Error(result.message);
  }
  return result;
}
