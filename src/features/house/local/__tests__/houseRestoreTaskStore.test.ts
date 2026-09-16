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
 *
 * Ported from `budget/local/__tests__/restoreTaskStore.test.ts`. The one place
 * House deliberately DIVERGES is `allowHouseholdReplace`, and that divergence
 * has its own describe block below.
 */
const mockConfirmAndRestore = jest.fn();
jest.mock('../backup/houseBackup', () => ({
  confirmAndRestoreHouseBackup: (...a: unknown[]) => mockConfirmAndRestore(...a),
}));

const mockRememberRestorePhrase = jest.fn().mockResolvedValue(undefined);
jest.mock('../backup/restorePhraseMemory', () => ({
  rememberRestorePhrase: (...a: unknown[]) => mockRememberRestorePhrase(...a),
}));

const mockShowToast = jest.fn();
jest.mock('@services/toastManager', () => ({
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));

import type { HouseBackupSummary } from '../backup/houseBackup';
import {
  consumeHouseRestoreSummary,
  isHouseRestoreRunning,
  startHouseRestore,
  takeHouseRestoreAttempt,
  useHouseRestoreTaskStore,
} from '../backup/restoreTaskStore';

const PHRASE = 'apple bridge cactus dolphin ember forest garden harbor island jungle kettle lantern';
const ARCHIVE = '{"meta":{"householdId":"hh_local_maple"}}';

const summary = (patch: Partial<HouseBackupSummary> = {}): HouseBackupSummary => ({
  householdId: 'hh_local_maple',
  propertyName: 'Maple Street',
  tableCounts: { tasks: 12, spaces: 3 },
  totalRows: 15,
  blobManifest: [],
  ...patch,
});

/** Let the fire-and-forget chain inside startHouseRestore settle. */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  useHouseRestoreTaskStore.getState().reset();
});

describe('startHouseRestore', () => {
  it('returns before the restore finishes, so leaving the screen is safe', async () => {
    let resolveRestore: (value: unknown) => void = () => {};
    mockConfirmAndRestore.mockReturnValue(
      new Promise((resolve) => {
        resolveRestore = resolve;
      }),
    );

    expect(startHouseRestore(ARCHIVE, PHRASE)).toBe(true);
    // Still decrypting — and the caller already has control back.
    expect(isHouseRestoreRunning()).toBe(true);
    expect(mockShowToast).not.toHaveBeenCalled();

    resolveRestore({
      status: 'ok',
      message: 'Maple Street is back on this device.',
      summary: summary(),
    });
    await flush();

    expect(useHouseRestoreTaskStore.getState().status).toBe('ok');
    // The restore's own sentence, not a fixed one: it is the only thing that can
    // name a home a multi-home file failed to put back.
    expect(mockShowToast).toHaveBeenCalledWith(
      'success',
      'Maple Street is back on this device.',
      6000,
    );
  });

  it('publishes progress a screen can render without owning the run', async () => {
    mockConfirmAndRestore.mockImplementation(
      async (_archive: string, _phrase: string, options: { onProgress?: (u: unknown) => void }) => {
        options.onProgress?.({ stage: 'deriving_key', progress: 0.08, message: 'Decrypting…' });
        return { status: 'ok', message: 'done', summary: summary() };
      },
    );

    startHouseRestore(ARCHIVE, PHRASE);
    await flush();

    const finished = useHouseRestoreTaskStore.getState();
    // `startedAt` is what lets a re-mounted card resume the bar where the run
    // actually is rather than snapping back to zero.
    expect(finished.startedAt).toEqual(expect.any(Number));
    expect(finished.progress).toBe(1);
  });

  it('parks the breakdown instead of stuffing the counts into a toast', async () => {
    mockConfirmAndRestore.mockResolvedValue({
      status: 'ok',
      message: 'ok',
      summary: summary({ totalRows: 42 }),
    });

    startHouseRestore(ARCHIVE, PHRASE);
    await flush();

    const parked = consumeHouseRestoreSummary();
    expect(parked?.summary.totalRows).toBe(42);
    // Handed over exactly once — the modal is not a thing to see twice.
    expect(consumeHouseRestoreSummary()).toBeNull();
  });

  /**
   * A multi-home file is restored as far as it can be, and the part that could
   * not be placed has to survive all the way to the screen. Totals alone cannot
   * carry it: a home that was skipped contributes no rows, so it is invisible in
   * every number the modal shows.
   */
  it('parks what happened to EACH home, not just the totals', async () => {
    mockConfirmAndRestore.mockResolvedValue({
      status: 'ok',
      message: '2 homes are back on this device — Lake Cabin could not be restored.',
      summary: summary({ totalRows: 90 }),
      households: [
        { householdId: 'hh_local_maple', propertyName: 'Maple Street', status: 'restored', message: 'ok' },
        { householdId: 'hh_local_barn', propertyName: 'The Barn', status: 'restored', message: 'ok' },
        {
          householdId: 'hh_local_cabin',
          propertyName: 'Lake Cabin',
          status: 'not_on_device',
          message: '“Lake Cabin” is not on this device.',
        },
      ],
    });

    startHouseRestore(ARCHIVE, PHRASE);
    await flush();

    const parked = consumeHouseRestoreSummary();
    expect(parked?.households.map((entry) => entry.status)).toEqual([
      'restored',
      'restored',
      'not_on_device',
    ]);
    // The skipped home is named in the toast too — a member who walked away is
    // told which home is still missing, not just that "most of it" worked.
    expect(mockShowToast).toHaveBeenCalledWith(
      'success',
      '2 homes are back on this device — Lake Cabin could not be restored.',
      6000,
    );
  });

  it('remembers the phrase against every home the file actually put back', async () => {
    // One file, one phrase, three homes. Filing it under only the first would
    // make the next restore of the cabin ask for words the device already holds.
    mockConfirmAndRestore.mockResolvedValue({
      status: 'ok',
      message: 'ok',
      summary: summary(),
      households: [
        { householdId: 'hh_local_maple', propertyName: 'Maple Street', status: 'restored', message: 'ok' },
        { householdId: 'hh_local_cabin', propertyName: 'Lake Cabin', status: 'restored', message: 'ok' },
      ],
    });

    startHouseRestore(ARCHIVE, PHRASE);
    await flush();

    expect(mockRememberRestorePhrase).toHaveBeenCalledWith(PHRASE, 'hh_local_maple');
    expect(mockRememberRestorePhrase).toHaveBeenCalledWith(PHRASE, 'hh_local_cabin');
    // …and under the whole-device pseudo-id, which is what the restore panel
    // looks the phrase up under when the member picks that same file again.
    expect(mockRememberRestorePhrase).toHaveBeenCalledWith(PHRASE, 'all-homes');
  });

  it('remembers the phrase only once it has actually opened an archive', async () => {
    mockConfirmAndRestore.mockResolvedValue({ status: 'failed', message: 'Wrong phrase.' });
    startHouseRestore(ARCHIVE, PHRASE);
    await flush();
    expect(mockRememberRestorePhrase).not.toHaveBeenCalled();

    mockConfirmAndRestore.mockResolvedValue({ status: 'ok', message: 'ok', summary: summary() });
    useHouseRestoreTaskStore.getState().reset();
    startHouseRestore(ARCHIVE, PHRASE);
    await flush();
    // Against the home the archive turned out to hold — each home's archives
    // are sealed under their own words.
    expect(mockRememberRestorePhrase).toHaveBeenCalledWith(PHRASE, 'hh_local_maple');
  });

  it('keeps the archive after a failure so a typo is not a second trip to Drive', async () => {
    mockConfirmAndRestore.mockResolvedValue({
      status: 'failed',
      message: 'That phrase does not open this backup.',
    });

    startHouseRestore(ARCHIVE, PHRASE, { householdId: 'hh_local_maple' });
    await flush();

    expect(mockShowToast).toHaveBeenCalledWith(
      'error',
      'That phrase does not open this backup.',
      6000,
    );
    const attempt = takeHouseRestoreAttempt();
    expect(attempt).toEqual({
      archiveJson: ARCHIVE,
      phrase: PHRASE,
      householdId: 'hh_local_maple',
      allowHouseholdReplace: false,
    });
    // Handing it back ends the failure: the member owns the words again.
    expect(useHouseRestoreTaskStore.getState().status).toBe('idle');
    expect(takeHouseRestoreAttempt()).toBeNull();
  });

  it('drops the phrase from memory the moment a restore succeeds', async () => {
    mockConfirmAndRestore.mockResolvedValue({ status: 'ok', message: 'ok', summary: summary() });

    startHouseRestore(ARCHIVE, PHRASE);
    await flush();

    expect(useHouseRestoreTaskStore.getState().attempt).toBeNull();
  });

  it('reports a throw as a failure instead of leaving the slot stuck', async () => {
    mockConfirmAndRestore.mockRejectedValue(new Error('hermes died'));

    startHouseRestore(ARCHIVE, PHRASE);
    await flush();

    expect(useHouseRestoreTaskStore.getState().status).toBe('failed');
    expect(mockShowToast).toHaveBeenCalledWith('error', 'Unexpected restore error.', 6000);
    expect(isHouseRestoreRunning()).toBe(false);
  });

  it('is single-flight — a second restore is refused, never run into the same ledger', () => {
    mockConfirmAndRestore.mockReturnValue(new Promise(() => {}));

    expect(startHouseRestore(ARCHIVE, PHRASE)).toBe(true);
    expect(startHouseRestore(ARCHIVE, PHRASE)).toBe(false);
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

    startHouseRestore(ARCHIVE, PHRASE);
    // A run that died between two awaits leaves the claim behind; only a very
    // old one is displaced, because a live restore genuinely runs for minutes.
    useHouseRestoreTaskStore.setState({ startedAt: Date.now() - 16 * 60 * 1000 });

    mockConfirmAndRestore.mockReturnValueOnce(new Promise(() => {}));
    expect(startHouseRestore(ARCHIVE, PHRASE)).toBe(true);

    reportFirst?.({ stage: 'preparing', progress: 0.02, message: 'Preparing…' });
    settleFirst({ status: 'ok', message: 'stale', summary: summary() });
    await flush();

    // The live run still owns the slot, and nothing was toasted over it.
    expect(useHouseRestoreTaskStore.getState().status).toBe('running');
    expect(mockShowToast).not.toHaveBeenCalledWith('success', expect.anything(), expect.anything());
  });
});

/**
 * Where House deliberately parts company with Budget.
 *
 * Budget passes `allowHouseholdReplace: true` unconditionally, because its case
 * for it is a D1 → local migration archive adopting the open ledger. House
 * holds 1–3 homes at once (H5), so an archive whose household id differs is
 * usually the cabin's file picked while the house is open — a mis-tap, and one
 * that mixes two homes' rows irreversibly if it is waved through. The screen
 * asks first; this store only carries the answer.
 */
describe('restoring into a different home', () => {
  it('does not allow a household replace by default', async () => {
    mockConfirmAndRestore.mockResolvedValue({ status: 'ok', message: 'ok', summary: summary() });

    startHouseRestore(ARCHIVE, PHRASE, { householdId: 'hh_local_maple' });
    await flush();

    expect(mockConfirmAndRestore).toHaveBeenCalledWith(
      ARCHIVE,
      PHRASE,
      expect.objectContaining({ householdId: 'hh_local_maple', allowHouseholdReplace: false }),
    );
  });

  it('passes the replace through only when the screen says the member confirmed', async () => {
    mockConfirmAndRestore.mockResolvedValue({ status: 'ok', message: 'ok', summary: summary() });

    startHouseRestore(ARCHIVE, PHRASE, {
      householdId: 'hh_local_maple',
      allowHouseholdReplace: true,
    });
    await flush();

    expect(mockConfirmAndRestore).toHaveBeenCalledWith(
      ARCHIVE,
      PHRASE,
      expect.objectContaining({ allowHouseholdReplace: true }),
    );
  });

  it('keeps the confirmation on the attempt, so a retry does not re-ask', async () => {
    mockConfirmAndRestore.mockResolvedValue({ status: 'failed', message: 'Wrong phrase.' });

    startHouseRestore(ARCHIVE, PHRASE, {
      householdId: 'hh_local_maple',
      allowHouseholdReplace: true,
    });
    await flush();

    expect(takeHouseRestoreAttempt()).toMatchObject({ allowHouseholdReplace: true });
  });

  it('omits the home entirely when none was named, rather than sending null', async () => {
    // `restoreHouseBackup` defaults to the active home; passing `null` through
    // would be a different thing to say.
    mockConfirmAndRestore.mockResolvedValue({ status: 'ok', message: 'ok', summary: summary() });

    startHouseRestore(ARCHIVE, PHRASE);
    await flush();

    const [, , options] = mockConfirmAndRestore.mock.calls[0];
    expect(options).not.toHaveProperty('householdId');
  });
});
