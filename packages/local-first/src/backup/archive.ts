/**
 * Encrypted household backup archive (TRD §11).
 *
 * Brand-agnostic: a household is a household. Budget shipped it first; House
 * consumes the same archive format from H9.
 *
 * Outer JSON is metadata-only; ciphertext is AES-GCM under a Recovery Key
 * derived from the 12-word phrase via Argon2id (`deriveRecoveryKey`).
 */

import { aeadDecrypt, aeadEncrypt } from '../crypto/aead';
import { base64ToBytes, bytesToBase64 } from '../crypto/base64';
import { utf8Decode, utf8Encode } from '../crypto/bytes';
import {
  deriveRecoveryKey,
  RECOVERY_KDF_LEGACY,
  RECOVERY_KDF_MOBILE,
  type RecoveryKdfParams,
} from '../crypto/keys';

import {
  generateRecoveryPhrase,
  isValidRecoveryPhrase,
  normalizeRecoveryPhrase,
  randomRecoverySalt,
  recoveryPhraseToSecret,
} from './phrase';

export const BACKUP_ARCHIVE_FORMAT = 'symply-local-first-backup';
export const BACKUP_ARCHIVE_VERSION = 2;
export const BACKUP_AAD = 'local-first-backup-v2';

export interface BackupPlaintextPayload {
  /** Opaque ledger/snapshot JSON (caller-defined). */
  snapshotJson: string;
  householdId: string;
  deviceId: string;
  keyEpoch: number;
  createdAt: string;
}

export interface BackupArchiveKdfMeta {
  t: number;
  m: number;
  p: number;
  dkLen: number;
}

/**
 * Shared with the v3 bundle (`bundle.ts`), which reads its KDF parameters out of
 * its own meta the same way — one Argon2 pass has to be reproducible from the
 * file alone, whichever shape the file is.
 */
export function kdfParamsFromMeta(kdf: BackupArchiveKdfMeta | undefined): RecoveryKdfParams {
  if (
    kdf &&
    typeof kdf.t === 'number' &&
    typeof kdf.m === 'number' &&
    typeof kdf.p === 'number' &&
    typeof kdf.dkLen === 'number'
  ) {
    return { t: kdf.t, m: kdf.m, p: kdf.p, dkLen: kdf.dkLen };
  }
  return RECOVERY_KDF_LEGACY;
}

export function kdfMetaOf(params: RecoveryKdfParams): BackupArchiveKdfMeta {
  return { t: params.t, m: params.m, p: params.p, dkLen: params.dkLen };
}

export interface BackupArchiveDocument {
  format: typeof BACKUP_ARCHIVE_FORMAT;
  version: number;
  /** Argon2 salt (base64). */
  saltB64: string;
  /** AES-GCM envelope (base64): nonce || ciphertext||tag. */
  ciphertextB64: string;
  /** Non-sensitive hints for restore UX. */
  meta: {
    householdId: string;
    createdAt: string;
    keyEpoch: number;
    /** Present on archives sealed with mobile-tuned Argon2. Absent ⇒ legacy. */
    kdf?: BackupArchiveKdfMeta;
  };
}

function kdfParamsFromArchive(archive: BackupArchiveDocument): RecoveryKdfParams {
  return kdfParamsFromMeta(archive.meta?.kdf);
}

const kdfMeta = kdfMetaOf;

export interface BackupCreateResult {
  phrase: string;
  archive: BackupArchiveDocument;
  archiveJson: string;
}

export type BackupVerifyStatus = 'ok' | 'invalid_phrase' | 'decrypt_failed' | 'corrupt';

export interface BackupVerifyResult {
  status: BackupVerifyStatus;
  payload?: BackupPlaintextPayload;
  message: string;
}

function sealPayload(
  payload: BackupPlaintextPayload,
  phrase: string,
  salt: Uint8Array,
  kdf: RecoveryKdfParams,
): BackupArchiveDocument {
  const secret = recoveryPhraseToSecret(phrase);
  const recoveryKey = deriveRecoveryKey(secret, salt, kdf);
  try {
    const plain = utf8Encode(JSON.stringify(payload));
    const sealed = aeadEncrypt(recoveryKey, plain, utf8Encode(BACKUP_AAD));
    return {
      format: BACKUP_ARCHIVE_FORMAT,
      version: BACKUP_ARCHIVE_VERSION,
      saltB64: bytesToBase64(salt),
      ciphertextB64: bytesToBase64(sealed),
      meta: {
        householdId: payload.householdId,
        createdAt: payload.createdAt,
        keyEpoch: payload.keyEpoch,
        kdf: kdfMeta(kdf),
      },
    };
  } finally {
    recoveryKey.fill(0);
  }
}

export function createBackupArchive(
  payload: BackupPlaintextPayload,
  options?: { phrase?: string; salt?: Uint8Array; kdf?: RecoveryKdfParams },
): BackupCreateResult {
  const phrase = normalizeRecoveryPhrase(options?.phrase ?? generateRecoveryPhrase());
  if (!isValidRecoveryPhrase(phrase)) {
    throw new Error('createBackupArchive: invalid recovery phrase');
  }
  const salt = options?.salt ?? randomRecoverySalt();
  const kdf = options?.kdf ?? RECOVERY_KDF_MOBILE;
  const archive = sealPayload(payload, phrase, salt, kdf);
  return {
    phrase,
    archive,
    archiveJson: JSON.stringify(archive, null, 2),
  };
}

export function parseBackupArchiveJson(json: string): BackupArchiveDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Backup archive is not valid JSON');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as BackupArchiveDocument).format !== BACKUP_ARCHIVE_FORMAT ||
    (parsed as BackupArchiveDocument).version !== BACKUP_ARCHIVE_VERSION
  ) {
    throw new Error('Unsupported backup archive format');
  }
  const doc = parsed as BackupArchiveDocument;
  if (typeof doc.saltB64 !== 'string' || typeof doc.ciphertextB64 !== 'string') {
    throw new Error('Backup archive missing ciphertext');
  }
  return doc;
}

/**
 * Restore dry-run (BR-051): decrypt + parse without applying to the live ledger.
 */
export function verifyBackupArchive(
  archiveJson: string,
  phrase: string,
): BackupVerifyResult {
  const normalized = normalizeRecoveryPhrase(phrase);
  if (!isValidRecoveryPhrase(normalized)) {
    return {
      status: 'invalid_phrase',
      message: 'That recovery phrase is not valid. Check the words and try again.',
    };
  }

  let archive: BackupArchiveDocument;
  try {
    archive = parseBackupArchiveJson(archiveJson);
  } catch {
    return {
      status: 'corrupt',
      message: 'This backup file is damaged or not a Symply backup.',
    };
  }

  const secret = recoveryPhraseToSecret(normalized);
  const kdf = kdfParamsFromArchive(archive);
  const recoveryKey = deriveRecoveryKey(secret, base64ToBytes(archive.saltB64), kdf);
  try {
    const opened = aeadDecrypt(
      recoveryKey,
      base64ToBytes(archive.ciphertextB64),
      utf8Encode(BACKUP_AAD),
    );
    const payload = JSON.parse(utf8Decode(opened)) as BackupPlaintextPayload;
    if (typeof payload.snapshotJson !== 'string' || typeof payload.householdId !== 'string') {
      return {
        status: 'corrupt',
        message: 'This backup file is damaged or not a Symply backup.',
      };
    }
    return {
      status: 'ok',
      payload,
      message: 'Backup verified. You can restore when you are ready.',
    };
  } catch {
    return {
      status: 'decrypt_failed',
      message: 'Could not open this backup with that recovery phrase.',
    };
  } finally {
    recoveryKey.fill(0);
  }
}

/**
 * Open a verified archive. Throws if decrypt fails.
 * Caller decides merge-on-restore policy (live wins — D-20).
 */
export function openBackupArchive(
  archiveJson: string,
  phrase: string,
): BackupPlaintextPayload {
  const result = verifyBackupArchive(archiveJson, phrase);
  if (result.status !== 'ok' || !result.payload) {
    throw new Error(result.message);
  }
  return result.payload;
}
