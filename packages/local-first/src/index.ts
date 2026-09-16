export {
  LOCAL_FIRST_PROTOCOL_VERSION,
  LOCAL_FIRST_SCHEMA_VERSION,
  type Bytes,
  type DeviceId,
  type DeviceIdentity,
  type HouseholdId,
  type HouseholdKeys,
  type MemberId,
  type MemberRole,
  type OpId,
  type UnlockMaterial,
} from './types';

export { base64DecodedLength, base64ToBytes, bytesToBase64 } from './crypto/base64';
export {
  bytesEqual,
  bytesToHex,
  concatBytes,
  hexToBytes,
  randomBytes,
  utf8Decode,
  utf8Encode,
  zeroize,
} from './crypto/bytes';
export { aeadDecrypt, aeadEncrypt } from './crypto/aead';
export {
  AI_KEY_SHARE_VERSION,
  aiKeyHint,
  aiKeyShareAad,
  deriveAiKeyShareKey,
  openAiKeyShare,
  sealAiKeyShare,
  type AiKeyShareContext,
} from './crypto/ai-key-share';
export { deriveEnrolmentSas, formatEnrolmentSas, type EnrolmentSasInput } from './crypto/sas';
export { generateSigningKeyPair, signDetached, verifyDetached } from './crypto/sign';
export {
  createUnlockMaterial,
  deriveRecoveryKey,
  deriveUnlockKeyFromPin,
  generateDeviceIdentity,
  generateHouseholdKeys,
  unwrapHouseholdDataKey,
  unwrapLocalDatabaseKey,
  wrapHouseholdDataKey,
  wrapLocalDatabaseKey,
} from './crypto/keys';

export type { Clock, FileStore, SecureKeyStore } from './adapters/types';
export { systemClock } from './adapters/types';

export type {
  LocalFirstStore,
  RowBucketCount,
  RowKeyRef,
  RowLoadQuery,
  StoredOperation,
  StoredRowRecord,
  SyncPeerState,
  VersionVector,
} from './store/types';
export { ALWAYS_RESIDENT_BUCKET, SQLITE_MIGRATION_V1, SQLITE_MIGRATION_V2 } from './store/types';
export { openRowBody, rowAad, sealRowBody, ROW_NONCE_LENGTH } from './store/row-aead';
export { MemoryLocalFirstStore } from './store/memory-store';
export type { SqliteDriver } from './store/sqlite-driver';
export { SqliteLocalFirstStore } from './store/sqlite-store';

export type {
  AppliedOperationResult,
  OperationInput,
  ProjectionHandler,
} from './oplog/types';
export { HybridLogicalClock, parseHlc, HLC_MAX_DRIFT_MS, isHlcTooFarInFuture } from './oplog/hlc';
export { OpLog, createOpId, SeqRegressionError } from './oplog/oplog';
export { canonicalSignBytes } from './oplog/encode';

export type {
  ControlPlaneClient,
  MailboxBlob,
  SyncCheckpoint,
  SyncEngine,
  SyncPeer,
  SyncTransportKind,
} from './sync/types';
export { MemoryControlPlaneClient, StubSyncEngine } from './sync/stubs';
export {
  MAILBOX_BATCH_VERSION,
  UnsupportedBatchVersionError,
  deserializeOperation,
  openOpBatch,
  sealOpBatch,
  serializeOperation,
  type OpBatch,
  type SerializedStoredOperation,
} from './sync/batch';
export {
  MAX_MAILBOX_CIPHERTEXT_B64,
  MAX_PULL_PAGES,
  MIN_PUSH_INTERVAL_MS,
  MailboxOpTooLargeError,
  MailboxPayloadTooLargeError,
  MailboxSyncEngine,
  SENT_VV_TTL_MS,
  advanceVvWithOps,
  base64Length,
  lagOps,
  minVersionVector,
  vvCovers,
  vvEquals,
  vvMax,
  type MailboxSyncResult,
} from './sync/mailbox-engine';
export {
  LoopbackPeerTransport,
  PeerSyncSession,
  type PeerSyncMessage,
  type PeerSyncResult,
  type PeerTransport,
} from './sync/peer-session';
export {
  CATCH_UP_OPS_THRESHOLD,
  CATCH_UP_STALE_MS,
  CHECKPOINT_FORMAT,
  CHECKPOINT_PUBLISH_MIN_OPS,
  CHECKPOINT_RETAIN_GENERATIONS,
  CHECKPOINT_TTL_MS,
  checkpointChunkB64Length,
  checkpointChunkFitsCap,
  openCheckpoint,
  sealCheckpoint,
  type CheckpointManifest,
  type CheckpointPlaintext,
  type CheckpointRow,
} from './sync/checkpoint';
export {
  classifySyncError,
  isTerminalSyncError,
  type SyncErrorCode,
} from './sync/errors';
export {
  generateInviteSecret,
  generateOobChallenge,
  generateShortCode,
  type OobChallenge,
} from './sync/invite-phrases';

export {
  LEDGER_INDEX_THRESHOLD,
  MAX_OP_DELTA_BYTES,
  MAX_OP_DELTA_ROWS,
  MAX_PARKED_ROWS,
  MAX_TRACKED_CONFLICTS,
  RESTORE_AUTHOR,
  RESTORE_HLC,
  bucketsForRange,
  chunkRowsForOp,
  compareStamps,
  createLedgerProjection,
  decodeLedgerOpPayload,
  decodeRowLww,
  defineLedgerSchema,
  deterministicRowId,
  encodeLedgerOpPayload,
  encodeRowLww,
  isDeterministicRowId,
  isEncodedRowLww,
  planTableStrategy,
  restoreStamp,
  type ApplyDeltaResult,
  type EncodedRowLww,
  type LedgerConflict,
  type LedgerConflictKind,
  type LedgerDelta,
  type LedgerLww,
  type LedgerOpPayload,
  type LedgerProjection,
  type LedgerRow,
  type LedgerSchema,
  type LedgerSchemaInput,
  type LedgerSnapshot,
  type OpStamp,
  type ParkedField,
  type PersistedRowLww,
  type ProjectableLedger,
  type RowDelta,
  type RowEnvelope,
  type RowEnvelopeWrite,
  type RowLww,
  type RowWrite,
} from './projection';

export {
  addMinor,
  assertMinorUnits,
  formatMinor,
  subMinor,
  type MinorUnits,
} from './money/minor-units';

export {
  generateRecoveryPhrase,
  isValidRecoveryPhrase,
  normalizeRecoveryPhrase,
  recoveryPhraseFromEntropyHex,
  recoveryPhraseToSecret,
  randomRecoverySalt,
} from './backup/phrase';
export {
  BACKUP_ARCHIVE_FORMAT,
  BACKUP_ARCHIVE_VERSION,
  createBackupArchive,
  openBackupArchive,
  parseBackupArchiveJson,
  verifyBackupArchive,
  type BackupArchiveDocument,
  type BackupArchiveKdfMeta,
  type BackupCreateResult,
  type BackupPlaintextPayload,
  type BackupVerifyResult,
  type BackupVerifyStatus,
} from './backup/archive';
export {
  BACKUP_BUNDLE_AAD,
  BACKUP_BUNDLE_VERSION,
  bundleSectionAad,
  createBackupBundle,
  openBackupBundle,
  parseBackupBundleJson,
  readBackupFileKind,
  verifyBackupBundle,
  type BackupBundleCreateResult,
  type BackupBundleDocument,
  type BackupBundleSectionDocument,
  type BackupBundleSectionPayload,
  type BackupBundleSectionResult,
  type BackupBundleSectionStatus,
  type BackupBundleVerifyResult,
  type BackupBundleVerifyStatus,
  type BackupFileKind,
} from './backup/bundle';
export {
  RECOVERY_KDF_LEGACY,
  RECOVERY_KDF_MOBILE,
  type RecoveryKdfParams,
} from './crypto/keys';
