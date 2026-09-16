export { isHouseLocalFirst, isHouseP2PEnabled } from './flag';
export {
  HouseInviteAlreadyApprovedError,
  HouseInviteExpiringError,
  HouseInviteGoneError,
  HouseLocalEnrolmentPendingError,
  HouseLocalNotReadyError,
  HouseLocalUnknownPropertyError,
  HouseLocalUnsupportedError,
} from './errors';
export {
  HOUSE_DETERMINISTIC_ID_TABLES,
  HOUSE_LEDGER_PHYSICAL_TABLES,
  HOUSE_LEDGER_TABLE_KEYS,
  HOUSE_LEDGER_TABLE_NAMES,
  HOUSE_WINDOWED_DATE_FIELDS,
  type HouseLedgerTableName,
} from './schema';
export { houseDeterministicIds, isoNow, newLocalId } from './ids';
export {
  adoptJoinedHousehold,
  applyLocalHouseRestore,
  clearLocalHouseConflicts,
  closeLocalHouseSession,
  compactLocalHouseLogIfSafe,
  emptyHouseTables,
  exportHouseCheckpointPlaintext,
  getHouseLedgerRevision,
  getLocalHouseConflicts,
  getLocalHouseDeviceId,
  getLocalHouseIdentity,
  getLocalHouseLedger,
  getLocalHouseMemberId,
  getLocalHouseOpLog,
  getLocalHouseStore,
  getLocalHouseholdKeys,
  installHouseCheckpointPlaintext,
  installHouseholdKeys,
  isAwaitingHouseEnrolment,
  isLocalHouseSessionOpen,
  mutateLocalHouseLedger,
  noteRemoteHouseOpsApplied,
  openHouseDeviceForEnrolment,
  openLocalHouseSession,
  openLocalHouseSessionForTests,
  rememberPublishedHouseCheckpoint,
  resetLocalHouseSession,
  subscribeToHouseLedgerChanges,
  type HouseLedger,
  type HouseLedgerChange,
} from './engine';
export {
  abandonHouseEnrolment,
  activateLocalHouseProperty,
  closeAllLocalHouseSessions,
  createLocalHouseProperty,
  getActiveHouseholdId,
  getLocalHouseConflictsFor,
  getLocalHouseLedgerFor,
  getLocalHouseSession,
  hasLocalHouseProperty,
  listLocalHouseProperties,
  removeLocalHouseProperty,
  renameLocalHouseProperty,
  type HousePropertySummary,
  type HouseSessionHandle,
} from './engine';
export {
  applyLedgerDelta,
  captureLedgerSnapshot,
  chunkRowsForOp,
  diffLedger,
  type LedgerConflict,
  type LedgerDelta,
} from './projection';
export {
  ensureHouseLocalSession,
  syncHouseholdStoreFromLocalLedger,
  teardownHouseLocalSession,
} from './ensureSession';
/**
 * Being taken OUT of a home — the counterpart to the leave/delete pair on
 * `HousePropertiesScreen`, for the two exits that happen on somebody else's
 * phone. See `membershipWatch`.
 */
export {
  dismissHouseMembershipLoss,
  hydrateHouseMembershipLosses,
  purgeRevokedHouseProperties,
  resetHouseMembershipWatch,
  useHouseMembershipLosses,
  type HouseMembershipLoss,
} from './membershipWatch';
/**
 * Why the member is — or is not — looking at their own home.
 *
 * A separate block because these four are read by a SCREEN rather than by the
 * bootstrap: `HouseRecoverHomeScreen` subscribes to the state, names the homes
 * it carries, and offers `startNewHouseholdOnThisDevice` as the explicit escape
 * hatch the automatic path deliberately no longer takes.
 */
export {
  getHouseLocalBootstrapState,
  startNewHouseholdOnThisDevice,
  subscribeToHouseLocalBootstrapState,
  type HouseLocalBootstrapState,
} from './ensureSession';
export {
  approveLocalFirstInvite,
  buildHouseInviteLink,
  claimLocalFirstInvite,
  createLocalFirstInvite,
  deriveJoinRequestSas,
  fetchControlPlaneState,
  forgetLocalFirstDevice,
  houseHouseholdControlPlaneStatus,
  houseHouseholdIsOnControlPlane,
  houseHouseholdWasRegistered,
  joinLocalFirstHousehold,
  leaveHouseHousehold,
  listControlPlaneHouseholds,
  listOutstandingInvites,
  listPendingJoinRequests,
  lookupLocalFirstInvite,
  lookupLocalFirstInviteById,
  parseInviteInput,
  removeHouseHouseholdMember,
  renameLocalFirstDevice,
  revokeLocalFirstDevice,
  revokeLocalFirstInvite,
  revokeRemoteHouseholdDevice,
  setHouseMemberRole,
  syncAllLocalHouseholdsToControlPlane,
  syncLocalHouseholdToControlPlane,
  HOUSE_INVITE_LINK_SCHEME,
  type ControlPlaneDevice,
  type ControlPlaneInvite,
  type ControlPlaneMember,
  type ControlPlaneState,
  type CreatedInvite,
  type OutstandingInvite,
  type PendingJoinRequest,
} from './controlPlaneClient';

/** Enrolment — the invite hand-off, and the two sides that wait on each other. */
export {
  HOUSE_INVITE_UPDATE_TYPES,
  signalHouseInviteUpdate,
  useHouseEnrolmentSignal,
} from './enrolmentSignal';
export { useHouseEnrolmentLive } from './enrolmentLive';
export { useHouseJoinRequests, type HouseJoinRequests } from './useHouseJoinRequests';
export { useHouseJoinWait, type HouseJoinWait } from './useHouseJoinWait';
export {
  buildHouseInviteShareText,
  describeInviteExpiry,
} from './inviteCopy';
export {
  captureHouseInviteLink,
  captureInitialHouseInviteLink,
  parseHouseInviteLink,
  takePendingHouseInvite,
  useHouseInviteLinkStore,
  type PendingHouseInvite,
} from './inviteLinkStore';
export {
  DEVICE_NAME_MAX_LENGTH,
  deviceLiveness,
  describeDevice,
  getLocalDeviceName,
  normalizeDeviceName,
  setLocalDeviceName,
  shortDeviceId,
  suggestDeviceName,
} from './deviceName';
export {
  buildHouseRoster,
  getHouseRoster,
  houseMemberName,
  publishHouseRoster,
  refreshHouseHouseholdRoster,
  republishActiveHouseRoster,
  selfHouseRoster,
  sortHouseRoster,
} from './householdRoster';
export { runHouseLocalSync, runHouseLocalSyncFor } from './sync/orchestrator';
export { useHouseSyncStatusStore, type HouseSyncStatus } from './sync/syncStatusStore';
export {
  HOUSE_NEVER_INVALIDATED_KEYS,
  HOUSE_TABLE_QUERY_KEYS,
  invalidateForTables,
  queryKeysForTables,
  startHouseLedgerRefreshBridge,
  stopHouseLedgerRefreshBridge,
} from './sync/ledgerRefresh';
export {
  HOUSE_LOCAL_REMINDER_COVERAGE,
  HOUSE_REMINDER_SLOTS,
  cancelHouseLocalReminders,
  getHouseLocalRemindersCopy,
  getHouseLocalRemindersDeniedCopy,
  syncHouseLocalReminders,
} from './reminders/houseLocalReminders';
export {
  HOUSE_WIDGET_TASK_FIELDS,
  clearHouseWidgetProjection,
  flushHouseWidgetProjection,
  getHouseWidgetProjectionCopy,
  startHouseWidgetProjection,
  stopHouseWidgetProjection,
} from './reminders/widgetProjection';
export {
  HOUSE_SYNC_WAKE_TYPE,
  handleHouseSyncWakeNotification,
  registerHouseLocalPushToken,
} from './pushWake';

/** H6 encrypted attachment channel (plan §8). */
export {
  HouseBlobCorruptError,
  HouseBlobKeyUnavailableError,
  HouseBlobQuotaError,
  HouseBlobTooLargeError,
  deleteHouseBlob,
  getHouseBlobUsage,
  houseBlobIsAvailable,
  isHouseBlobCached,
  newBlobId,
  resolveHouseBlobUri,
  uploadHouseBlob,
  type HouseBlobDescriptor,
} from './blobs';

/** H9 CSV export (plan §10). */
export {
  HOUSE_EXPORT_FORMAT,
  HOUSE_EXPORT_VERSION,
  exportHouseLedgerCsv,
  type HouseExportResult,
} from './export/houseLedgerExport';

/**
 * H9 encrypted backup (plan §10).
 *
 * One file can hold ONE home or EVERY home, a section each — `HOUSE_ALL_HOMES_ID`
 * is what asks for the second, and it travels every per-home path in the folder
 * as an ordinary household id. See `./backup/allHomes` and `./backup/houseBackup`.
 */
export { HOUSE_ALL_HOMES_ID, HOUSE_ALL_HOMES_LABEL, isAllHomesTarget } from './backup/allHomes';
export {
  HOUSE_MULTI_BACKUP_FORMAT,
  HOUSE_MULTI_BACKUP_VERSION,
  aggregateHouseSummaries,
  buildHouseBackupArchive,
  buildHouseBackupSnapshot,
  collectBlobManifest,
  confirmAndRestoreHouseBackup,
  houseBackupFileName,
  houseBackupTargets,
  houseLedgerSnapshot,
  houseRestoreOutcomeMessage,
  parseHouseBackupSnapshot,
  pickHouseBackupArchive,
  restoreHouseBackup,
  summarizeHouseDevice,
  summarizeHouseLedger,
  summarizeHouseProperty,
  verifyHouseBackup,
  writeHouseBackupToFile,
  type HouseBackupScope,
  type HouseBackupSection,
  type HouseBackupSummary,
  type HouseMultiBackupDocument,
  type HouseRestoreHouseholdResult,
  type HouseRestoreProgress,
  type HouseRestoreResult,
} from './backup/houseBackup';

/**
 * The rest of the backup machinery — destinations, the scheduler, the two task
 * slots, the per-home history — is deliberately NOT re-exported here. Reach it
 * by deep path:
 *
 *   `./backup/backupDestinations`  where an archive can go
 *   `./backup/autoBackup`          the foreground catch-up schedule
 *   `./backup/backupTaskStore`     the one in-flight seal
 *   `./backup/restoreTaskStore`    the one in-flight restore
 *   `./backup/backupHistory`       the last write, per home
 *
 * Not tidiness — module graph. `autoBackup` pulls `@services/notifications` and
 * `backupDestinations` pulls both cloud SDKs, and this barrel is imported by
 * screens that have no business loading either. `DataContext` already
 * lazy-`require`s the scheduler for exactly this reason.
 */

/**
 * H7 on-device AI — the P2 BYOK ladder (plan §9).
 *
 * Deliberately the narrowest re-export in this file. `./ai/index.ts` already
 * says screens must not reach past it into the individual modules; this block
 * says the same thing one level up, so a hook importing from
 * `@features/house/local` can run the ladder and render Stage C but cannot get
 * at `houseByokPort`, `generateHouseStructuredByok`, the egress allowlist
 * primitives or anything else that touches a key or a provider. `readKey` is
 * module-private in `houseByokClient.ts` and stays that way — a caller that
 * wants a different surface should go through `./ai` and justify it there.
 *
 * `HomeInsight` is aliased because there are two unrelated types with that
 * name: this one (rules over the local ledger) and the server's
 * `@/types/aihousekeeper` `HomeInsight` (a single composed hero brief). They
 * are not interchangeable — different fields, different lifecycle — and letting
 * an unqualified `HomeInsight` out of this barrel is how they get conflated at
 * a call site.
 */
export {
  buildHomeInsights,
  buildHouseAiContext,
  getHouseAiUnavailableCopy,
  inferGarbageDay,
  runHouseAiLadder,
  type GarbageDayAnswer,
  type HomeInsight as HouseAiHomeInsight,
  type HouseAiContext,
  type HouseAiLadderResult,
  type HouseAiUnavailableReason,
} from './ai';
