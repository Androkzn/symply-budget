export { isBudgetLocalFirst } from './flag';
export {
  BudgetLocalNotReadyError,
  BudgetLocalUnknownHouseholdError,
  BudgetLocalUnsupportedError,
  CategoryNameConflictError,
} from './errors';
export {
  clearLocalConflicts,
  closeLocalBudgetSession,
  getLedgerRevision,
  getLocalConflicts,
  getLocalLedger,
  isLocalBudgetSessionOpen,
  openLocalBudgetSession,
  openLocalBudgetSessionForTests,
  resetLocalBudgetSession,
  subscribeToLedgerChanges,
  type BudgetLedgerChange,
} from './engine';
/**
 * The BR-016 multi-household surface, kept in its own block for the same reason
 * House keeps its H5 exports separate: everything above reads or writes THE
 * ACTIVE household, everything here names one. A caller that reaches for
 * `getLocalLedger()` on a background household gets the wrong ledger silently;
 * one that reaches for `getLocalLedgerFor(id)` cannot.
 */
export {
  activateLocalBudgetHousehold,
  closeAllLocalBudgetSessions,
  createLocalBudgetHousehold,
  getActiveBudgetHouseholdId,
  getLocalBudgetSession,
  getLocalConflictsFor,
  getLocalLedgerFor,
  listLocalBudgetHouseholds,
  removeLocalBudgetHousehold,
  type BudgetHouseholdSummary,
  type BudgetSessionHandle,
} from './engine';
export {
  applyLedgerDelta,
  captureLedgerSnapshot,
  diffLedger,
  type LedgerConflict,
  type LedgerDelta,
} from './projection';
export {
  ensureBudgetLocalSession,
  syncHouseholdStoreFromLocalLedger,
  teardownBudgetLocalSession,
} from './ensureSession';
export { localBudgetApi } from './localBudgetApi';
export {
  cleanUpPreviousLocalBudgetData,
  eraseLocalBudgetData,
  getPreviousLocalBudgetData,
  type ArchivedLocalLedger,
  type LocalBudgetCleanupResult,
} from './localDataReset';
/**
 * Being taken OUT of a household — the counterpart to the leave/delete pair on
 * `BudgetHouseholdScreen`, for the two exits that happen on somebody else's
 * phone. See `membershipWatch`.
 */
export {
  dismissBudgetMembershipLoss,
  hydrateBudgetMembershipLosses,
  purgeRevokedBudgetHouseholds,
  resetBudgetMembershipWatch,
  useBudgetMembershipLosses,
  type BudgetMembershipLoss,
} from './membershipWatch';
export {
  approveLocalFirstInvite,
  awaitBudgetControlPlaneRegistration,
  budgetHouseholdIsOnControlPlane,
  budgetHouseholdWasRegistered,
  claimLocalFirstInvite,
  createLocalFirstInvite,
  deriveJoinRequestSas,
  listControlPlaneHouseholds,
  markBudgetHouseholdOnControlPlane,
  resetBudgetControlPlaneCache,
  syncLocalHouseholdToControlPlane,
  type PendingJoinRequest,
} from './controlPlaneClient';
export { runBudgetLocalSync } from './sync/orchestrator';
export { syncBudgetLocalReminders } from './reminders/budgetLocalReminders';
export {
  budgetLocalUnsupportedCopyFromError,
  getBudgetLocalUnsupportedCopy,
  isBudgetLocalUnsupportedError,
} from './ai/localAiUnsupported';
export { useBudgetSyncStatusStore } from './sync/syncStatusStore';
