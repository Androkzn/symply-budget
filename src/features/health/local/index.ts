/**
 * Public surface of the Health local-first ledger.
 *
 * Mirrors `src/features/house/local/index.ts`, minus everything House exports
 * for multi-property sessions — Health is a personal ledger with exactly one
 * household (plan §1.2), so there is nothing to list, activate or remove.
 *
 * Stages that land later (`ensureSession`, `controlPlaneClient`, `sync/*`,
 * `healthLedgerStore`) add their own blocks here as they arrive; this barrel
 * only re-exports modules that exist, so a missing stage is a missing export
 * rather than a broken build.
 */
export { isHealthLocalFirst, isHealthP2PEnabled } from './flag';
export {
  HealthLedgerDekMissingError,
  HealthLocalEnrolmentPendingError,
  HealthLocalNotReadyError,
  HealthLocalUnsupportedError,
} from './errors';
export {
  HEALTH_DETERMINISTIC_ID_TABLES,
  HEALTH_LEDGER_PHYSICAL_TABLES,
  HEALTH_LEDGER_TABLE_KEYS,
  HEALTH_LEDGER_TABLE_NAMES,
  HEALTH_RANDOM_ID_TABLES,
  HEALTH_WINDOWED_DATE_FIELDS,
  type HealthLedgerTableName,
} from './schema';
export { healthDeterministicIds, isoNow, localDateKey, newLocalId } from './ids';
export {
  HEALTH_RETAINED_KEY_EPOCHS,
  applyLocalHealthRestore,
  clearLocalHealthConflicts,
  closeLocalHealthSession,
  compactLocalHealthLogIfSafe,
  emptyHealthTables,
  exportHealthCheckpointPlaintext,
  getHealthLedgerRevision,
  getLocalHealthConflicts,
  getLocalHealthDeviceId,
  getLocalHealthHouseholdKeys,
  getLocalHealthIdentity,
  getLocalHealthLedger,
  getLocalHealthOpLog,
  getLocalHealthRetiredHouseholdKey,
  getLocalHealthRetiredKeyEpochs,
  getLocalHealthStore,
  installHealthCheckpointPlaintext,
  installHealthHouseholdKeys,
  isAwaitingHealthEnrolment,
  isLocalHealthSessionOpen,
  mutateLocalHealthLedger,
  noteRemoteHealthOpsApplied,
  openLocalHealthSession,
  openLocalHealthSessionForTests,
  rememberPublishedHealthCheckpoint,
  resetLocalHealthSession,
  subscribeToHealthLedgerChanges,
  type HealthLedger,
  type HealthLedgerChange,
} from './engine';
export {
  applyLedgerDelta,
  captureLedgerSnapshot,
  chunkRowsForOp,
  diffLedger,
  type LedgerConflict,
  type LedgerDelta,
} from './projection';
export type {
  HealthEntrySource,
  HealthLedgerRowBase,
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

/**
 * He3 kernel — the shared foundation the storage-cutover facades build on
 * (plan §7).
 *
 * ⚠️ A local api facade must NOT reach these through this barrel. Importing
 * `@features/health/local` from an api module pulls the sync orchestrator, the
 * status store and the control-plane client into the module graph on every call
 * from every screen; that is the first of the two lessons in
 * `localApiProxy.ts`'s header, and it is why the Proxy's own `require` targets
 * `./flag` directly. Facades import `./localApiProxy`, `./localWrite` and
 * `./windows` by path. These exports are for tests, screens and tooling.
 */
export { createHealthLocalProxy, parityGap, type HealthLocalProxyOptions } from './localApiProxy';
export {
  activeHouseholdId,
  activeUserId,
  allRowsOf,
  ledger,
  nowIso,
  rowById,
  rowsOf,
  writeLocal,
  writeLocalBulk,
  type LocalOpDescriptor,
  type LocalWriteOptions,
} from './localWrite';
export {
  HEALTH_UNSUPPORTED_COPY,
  HEALTH_UNSUPPORTED_FALLBACK,
  getHealthUnsupportedCopy,
  type HealthUnsupportedCopy,
} from './unsupportedCopy';
export {
  toUserFacingError,
  unsupportedMethodOf,
  userFacingMessage,
  type UserFacingError,
} from './memberFacingError';
export {
  HEALTH_HOME_LOADERS,
  HEALTH_HOME_LOADER_COUNT,
  HEALTH_LOADER_NAMES,
  HEALTH_READ_WINDOWS,
  applyHealthReadWindow,
  maxDaysForWindow,
  maxRowsForWindow,
  type ApplyWindowOptions,
  type HealthLedgerRead,
  type HealthLoaderName,
  type HealthLoaderWindow,
  type HealthReadWindow,
} from './windows';

/**
 * He6 encrypted blob channel. Exported last because it is Wave B/D plumbing:
 * no Wave A table carries a blob descriptor yet, so `collectHealthBlobRefs`
 * correctly returns empty until a Wave C/D task writes one.
 */
export {
  HEALTH_BLOB_CACHE_BUDGET_BYTES,
  HEALTH_BLOB_FORMAT_VERSION,
  HEALTH_BLOB_MAX_PLAINTEXT_BYTES,
  HEALTH_BLOB_PLAINTEXT_CHUNK,
  HEALTH_BLOB_RECONCILE_MIN_INTERVAL_MS,
  HealthBlobCorruptError,
  HealthBlobIncompleteError,
  HealthBlobKeyUnavailableError,
  HealthBlobMissingError,
  HealthBlobQuotaError,
  HealthBlobTooLargeError,
  cachedHealthBlobUri,
  clearHealthBlobLocalState,
  collectHealthBlobRefs,
  deleteHealthBlob,
  evictHealthBlobCache,
  getHealthBlobUsage,
  healthBlobChunkCount,
  healthBlobIsAvailable,
  healthBlobPlaintextHash,
  isHealthBlobCached,
  isHealthBlobDescriptor,
  reconcileHealthBlobs,
  resolveHealthBlobUri,
  scheduleHealthBlobReconcile,
  stageHealthBlobOrigin,
  tryResolveHealthBlobUri,
  uploadHealthBlob,
  type HealthBlobDescriptor,
  type HealthBlobProgress,
  type HealthBlobReconcileReason,
  type HealthBlobReconciliation,
  type HealthBlobResolution,
  type HealthBlobUnavailableReason,
} from './blobs';

/**
 * He9 — the local encrypted archive.
 *
 * `restoreHealthLedgerFromArchive` deliberately ALWAYS throws:
 * `HEALTH_ARCHIVE_KEYING_QUESTION` (Q8) is still open, and a restore path
 * shipped before it is answered would pick the answer by accident. It is
 * exported present-and-throwing rather than omitted so the blocker is read
 * by whoever reaches for it.
 */
export {
  HEALTH_ARCHIVE_FAILED_MESSAGE,
  HEALTH_ARCHIVE_FORMAT,
  HEALTH_ARCHIVE_GENERATION,
  HEALTH_ARCHIVE_KEYING,
  HEALTH_ARCHIVE_KEYING_QUESTION,
  HEALTH_ARCHIVE_NOTES,
  HEALTH_ARCHIVE_NO_SHEET_MESSAGE,
  HEALTH_ARCHIVE_VERSION,
  HealthArchiveKeyingUndecidedError,
  buildHealthLedgerArchive,
  healthArchiveFileName,
  openHealthLedgerArchive,
  parseHealthArchiveJson,
  restoreHealthLedgerFromArchive,
  shareHealthLedgerArchive,
  verifyHealthLedgerArchive,
  type HealthArchive,
  type HealthArchiveEnvelope,
  type HealthArchiveResult,
  type HealthArchiveStatus,
  type HealthArchiveSummary,
} from './backupArchive';

/**
 * He9 — what actually protects this member's data right now.
 *
 * `level` collapses to `'unknown'` when the control plane cannot be read:
 * rendering "safe on two devices" from a cached hope is the one answer this
 * must never give.
 */
export {
  HEALTH_DURABILITY_COPY,
  getHealthDurabilityStatus,
  healthDurabilityCopyFor,
  healthDurabilityCopyStrings,
  healthDurabilityLevelOf,
  type HealthDurabilityCopyEntry,
  type HealthDurabilityLevel,
  type HealthDurabilityStatus,
} from './durability';
