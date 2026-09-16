/**
 * The background restore slot.
 *
 * Opening an archive used to be owned by the screen that started it: it awaited
 * the promise and held the progress in `useState`, so leaving the screen threw
 * the progress away and reported the outcome to nobody. What is pinned here is
 * the contract that replaced it — starting a restore returns immediately, live
 * progress is readable by anything mounted, only one runs at a time, the result
 * arrives as a toast, and a failed attempt keeps the archive so a mistyped word
 * costs a retype rather than another trip through Google Drive.
 */
const mockConfirmAndRestore = jest.fn();
jest.mock('../backup/budgetBackup', () => ({
  confirmAndRestoreBudgetBackupFile: (...a: unknown[]) => mockConfirmAndRestore(...a),
}));

const mockRememberRestorePhrase = jest.fn().mockResolvedValue(undefined);
jest.mock('../backup/restorePhraseMemory', () => ({
  rememberRestorePhrase: (...a: unknown[]) => mockRememberRestorePhrase(...a),
}));

const mockShowToast = jest.fn();
jest.mock('@services/toastManager', () => ({
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));

import type {
  BudgetRestoreHouseholdOutcome,
  BudgetRestoreSummary,
} from '../backup/budgetBackup';
import {
  consumeBudgetRestoreOutcomes,
  consumeBudgetRestoreSummary,
  isBudgetRestoreRunning,
  startBudgetRestore,
  takeBudgetRestoreAttempt,
  useBudgetRestoreTaskStore,
} from '../backup/restoreTaskStore';

const PHRASE = 'abuse boss fly battle rubber wasp afraid hamster guide essence vibrant tattoo';
const ARCHIVE = '{"meta":{"householdId":"hh_local_1"}}';

const summary = (patch: Partial<BudgetRestoreSummary> = {}): BudgetRestoreSummary => ({
  householdId: 'hh_local_1',
  householdName: 'E2E Restore HH',
  spendings: 12,
  categories: 4,
  monthlyBudgets: 1,
  plannedItems: 0,
  income: 2,
  monthlyPayments: 0,
  loans: 0,
  mortgages: 0,
  mortgageStatements: 0,
  registeredAccounts: 0,
  savingsGoals: 3,
  ...patch,
});

/**
 * One household's leg of a finished restore.
 *
 * `confirmAndRestoreBudgetBackupFile` reports per household because a bundle
 * can land three budgets and fail a fourth — a single summary has nowhere to
 * say so.
 */
const restored = (
  patch: Partial<BudgetRestoreHouseholdOutcome> = {},
): BudgetRestoreHouseholdOutcome => ({
  householdId: 'hh_local_1',
  householdName: 'E2E Restore HH',
  status: 'restored',
  message: '12 spendings restored.',
  summary: summary(),
  ...patch,
});

/** A whole-file outcome with `households` filled in. */
const fileResult = (patch: Partial<{
  status: 'ok' | 'partial' | 'failed';
  message: string;
  households: BudgetRestoreHouseholdOutcome[];
}> = {}) => ({
  status: 'ok' as const,
  message: 'done',
  households: [restored()],
  ...patch,
});

/** Let the fire-and-forget chain inside startBudgetRestore settle. */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  useBudgetRestoreTaskStore.getState().reset();
});

describe('startBudgetRestore', () => {
  it('returns before the restore finishes, so leaving the screen is safe', async () => {
    let resolveRestore: (value: unknown) => void = () => {};
    mockConfirmAndRestore.mockReturnValue(
      new Promise((resolve) => {
        resolveRestore = resolve;
      }),
    );

    expect(startBudgetRestore(ARCHIVE, PHRASE)).toBe(true);
    // Still decrypting — and the caller already has control back.
    expect(isBudgetRestoreRunning()).toBe(true);
    expect(mockShowToast).not.toHaveBeenCalled();

    resolveRestore(fileResult());
    await flush();

    expect(useBudgetRestoreTaskStore.getState().status).toBe('ok');
    expect(mockShowToast).toHaveBeenCalledWith(
      'success',
      'Restore finished — your budget is back on this device.',
      6000,
    );
  });

  it('publishes progress a screen can render without owning the run', async () => {
    mockConfirmAndRestore.mockImplementation(
      async (_archive: string, _phrase: string, options: { onProgress?: (u: unknown) => void }) => {
        options.onProgress?.({ stage: 'deriving_key', progress: 0.08, message: 'Decrypting…' });
        return fileResult();
      },
    );

    startBudgetRestore(ARCHIVE, PHRASE);
    // The floor and the wording both land in the store, where a re-mounted
    // screen can pick them up mid-run.
    await flush();

    const finished = useBudgetRestoreTaskStore.getState();
    expect(finished.startedAt).toEqual(expect.any(Number));
    expect(finished.progress).toBe(1);
  });

  it('parks the breakdown instead of stuffing the counts into a toast', async () => {
    mockConfirmAndRestore.mockResolvedValue(
      fileResult({
        message: 'long multi-line breakdown',
        households: [restored({ summary: summary({ spendings: 42 }) })],
      }),
    );

    startBudgetRestore(ARCHIVE, PHRASE);
    await flush();

    const parked = consumeBudgetRestoreSummary();
    expect(parked?.spendings).toBe(42);
    // Handed over exactly once — the modal is not a thing to see twice.
    expect(consumeBudgetRestoreSummary()).toBeNull();
  });

  it('remembers the phrase only once it has actually opened an archive', async () => {
    mockConfirmAndRestore.mockResolvedValue({
      status: 'failed',
      message: 'Wrong phrase.',
      households: [],
    });
    startBudgetRestore(ARCHIVE, PHRASE);
    await flush();
    expect(mockRememberRestorePhrase).not.toHaveBeenCalled();

    mockConfirmAndRestore.mockResolvedValue(fileResult({ message: 'ok' }));
    useBudgetRestoreTaskStore.getState().reset();
    startBudgetRestore(ARCHIVE, PHRASE);
    await flush();
    expect(mockRememberRestorePhrase).toHaveBeenCalledWith(PHRASE);
  });

  it('keeps the archive after a failure so a typo is not a second trip to Drive', async () => {
    mockConfirmAndRestore.mockResolvedValue({
      status: 'failed',
      message: 'That phrase does not open this backup.',
      households: [],
    });

    startBudgetRestore(ARCHIVE, PHRASE);
    await flush();

    expect(mockShowToast).toHaveBeenCalledWith(
      'error',
      'That phrase does not open this backup.',
      6000,
    );
    const attempt = takeBudgetRestoreAttempt();
    expect(attempt).toEqual({ archiveJson: ARCHIVE, phrase: PHRASE });
    // Handing it back ends the failure: the member owns the words again.
    expect(useBudgetRestoreTaskStore.getState().status).toBe('idle');
    expect(takeBudgetRestoreAttempt()).toBeNull();
  });

  it('drops the phrase from memory the moment a restore succeeds', async () => {
    mockConfirmAndRestore.mockResolvedValue(fileResult({ message: 'ok' }));

    startBudgetRestore(ARCHIVE, PHRASE);
    await flush();

    expect(useBudgetRestoreTaskStore.getState().attempt).toBeNull();
  });

  it('reports a throw as a failure instead of leaving the slot stuck', async () => {
    mockConfirmAndRestore.mockRejectedValue(new Error('hermes died'));

    startBudgetRestore(ARCHIVE, PHRASE);
    await flush();

    expect(useBudgetRestoreTaskStore.getState().status).toBe('failed');
    expect(mockShowToast).toHaveBeenCalledWith('error', 'Unexpected restore error.', 6000);
    expect(isBudgetRestoreRunning()).toBe(false);
  });

  it('names the count when a bundle brought several budgets back', async () => {
    mockConfirmAndRestore.mockResolvedValue(
      fileResult({
        households: [
          restored(),
          restored({ householdId: 'hh_local_2', householdName: 'Holiday', status: 'adopted' }),
        ],
      }),
    );

    startBudgetRestore(ARCHIVE, PHRASE);
    await flush();

    expect(mockShowToast).toHaveBeenCalledWith(
      'success',
      'Restore finished — 2 budgets are back on this device.',
      6000,
    );
    // Every household is parked, not just the first — the modal has to be able
    // to say which budgets came back.
    expect(consumeBudgetRestoreOutcomes()).toHaveLength(2);
    expect(consumeBudgetRestoreOutcomes()).toEqual([]);
  });

  it('says so in the toast when one household in the file did not come back', async () => {
    mockConfirmAndRestore.mockResolvedValue(
      fileResult({
        status: 'partial',
        message: 'Restored 1 of 2 budgets — 1 could not be restored.',
        households: [
          restored(),
          restored({
            householdId: 'hh_local_2',
            householdName: 'Holiday',
            status: 'failed',
            message: 'This household could not be opened from the backup file.',
            summary: undefined,
          }),
        ],
      }),
    );

    startBudgetRestore(ARCHIVE, PHRASE);
    await flush();

    // A partial restore must not toast as a plain success: the member may never
    // open the modal, and this is the only place they would learn of the loss.
    expect(mockShowToast).toHaveBeenCalledWith(
      'success',
      'Restored 1 of 2 budgets — 1 could not be restored.',
      6000,
    );
  });

  it('is single-flight — a second restore is refused, never run into the same ledger', () => {
    mockConfirmAndRestore.mockReturnValue(new Promise(() => {}));

    expect(startBudgetRestore(ARCHIVE, PHRASE)).toBe(true);
    expect(startBudgetRestore(ARCHIVE, PHRASE)).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith('info', 'A restore is already running.');
    expect(mockConfirmAndRestore).toHaveBeenCalledTimes(1);
  });

  it('ignores a displaced run — its progress and its outcome are both stale news', async () => {
    let reportFirst: ((u: unknown) => void) | undefined;
    let settleFirst: (value: unknown) => void = () => {};
    mockConfirmAndRestore.mockImplementationOnce(
      (_a: string, _p: string, options: { onProgress?: (u: unknown) => void }) => {
        reportFirst = options.onProgress;
        return new Promise((resolve) => {
          settleFirst = resolve;
        });
      },
    );

    startBudgetRestore(ARCHIVE, PHRASE);
    // A run that died between two awaits leaves the claim behind; only a very
    // old one is displaced, because a live restore genuinely runs for minutes.
    useBudgetRestoreTaskStore.setState({ startedAt: Date.now() - 16 * 60 * 1000 });

    mockConfirmAndRestore.mockReturnValueOnce(new Promise(() => {}));
    expect(startBudgetRestore(ARCHIVE, PHRASE)).toBe(true);

    reportFirst?.({ stage: 'preparing', progress: 0.02, message: 'Preparing…' });
    settleFirst(fileResult({ message: 'stale' }));
    await flush();

    // The live run still owns the slot, and nothing was toasted over it.
    expect(useBudgetRestoreTaskStore.getState().status).toBe('running');
    expect(mockShowToast).not.toHaveBeenCalledWith(
      'success',
      expect.anything(),
      expect.anything(),
    );
  });
});
