/**
 * Health V2 encrypted attachment channel (plan §8, stage He6).
 *
 * The one import surface screens and api facades should use. `blobCrypto` and
 * `blobTransport` are internals — a caller that reaches past this barrel to seal
 * a chunk itself is one refactor away from re-sealing on retry, which is the
 * nonce-reuse bug the staging design exists to prevent.
 *
 * Scope note: He6 ships the **transport**, not the photo product surface. Wave D
 * (`user_files` / body photos) is out of scope per plan §1.6 and §8, so nothing
 * here is wired to a screen yet and no ledger row carries a descriptor. What is
 * missing is a Wave D field and a picker, not a channel.
 */
export {
  HEALTH_BLOB_FORMAT_VERSION,
  HEALTH_BLOB_MAX_PLAINTEXT_BYTES,
  HEALTH_BLOB_PLAINTEXT_CHUNK,
  healthBlobChunkCount,
  healthBlobPlaintextHash,
} from './blobCrypto';

export {
  HealthBlobIncompleteError,
  HealthBlobMissingError,
  HealthBlobQuotaError,
  type RemoteHealthBlobManifest,
  type RemoteHealthBlobUsage,
} from './blobTransport';

export {
  HEALTH_BLOB_RECONCILE_MIN_INTERVAL_MS,
  resetHealthBlobReconcileScheduleForTests,
  scheduleHealthBlobReconcile,
  type HealthBlobReconcileReason,
} from './reconcileScheduler';

export {
  HEALTH_BLOB_CACHE_BUDGET_BYTES,
  HealthBlobCorruptError,
  HealthBlobKeyUnavailableError,
  HealthBlobTooLargeError,
  cachedHealthBlobUri,
  clearHealthBlobLocalState,
  collectHealthBlobRefs,
  deleteHealthBlob,
  evictHealthBlobCache,
  getHealthBlobUsage,
  healthBlobIsAvailable,
  isHealthBlobCached,
  isHealthBlobDescriptor,
  reconcileHealthBlobs,
  resolveHealthBlobUri,
  stageHealthBlobOrigin,
  tryResolveHealthBlobUri,
  uploadHealthBlob,
  type HealthBlobDescriptor,
  type HealthBlobProgress,
  type HealthBlobReconciliation,
  type HealthBlobResolution,
  type HealthBlobUnavailableReason,
} from './healthBlobStore';
