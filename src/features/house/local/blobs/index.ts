/**
 * House V2 encrypted attachment channel (plan §8, stage H6).
 *
 * The one import surface screens and api facades should use. `blobCrypto` and
 * `blobTransport` are internals — a caller that reaches past this barrel to seal
 * a chunk itself is one refactor away from re-sealing on retry, which is the
 * nonce-reuse bug the whole staging design exists to prevent.
 */
export {
  BLOB_MAX_PLAINTEXT_BYTES,
  BLOB_PLAINTEXT_CHUNK,
  blobChunkCount,
} from './blobCrypto';

export {
  HouseBlobIncompleteError,
  HouseBlobQuotaError,
  type RemoteBlobManifest,
  type RemoteBlobUsage,
} from './blobTransport';

export {
  BLOB_CACHE_BUDGET_BYTES,
  BLOB_KEY_PREFIX,
  blobKeyFor,
  isBlobKey,
  HouseBlobCorruptError,
  HouseBlobKeyUnavailableError,
  HouseBlobTooLargeError,
  cachedBlobUri,
  clearHouseBlobLocalState,
  deleteHouseBlob,
  evictHouseBlobCache,
  getHouseBlobUsage,
  houseBlobIsAvailable,
  isHouseBlobCached,
  newBlobId,
  resolveHouseBlobUri,
  stageHouseBlobOrigin,
  uploadHouseBlob,
  type HouseBlobDescriptor,
  type HouseBlobProgress,
} from './houseBlobStore';
