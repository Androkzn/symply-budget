/**
 * Budget's binding of the shared sync-error classifier.
 *
 * The logic moved to `@symply/local-first` when House V2 needed the same
 * classification (House plan §5, stage H4) — it never contained anything
 * Budget-specific. Re-exported under the original names so the ~10 call sites
 * and `__tests__/syncErrors.test.ts` are unchanged.
 */
export {
  classifySyncError,
  isTerminalSyncError,
  type SyncErrorCode,
} from '@symply/local-first';
