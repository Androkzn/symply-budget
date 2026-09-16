/**
 * The background backup slot.
 *
 * Sealing an archive used to be owned by the screen that started it: it awaited
 * the promise, and the outcome was reported to whatever was mounted. Navigate
 * away and nobody heard. What is pinned here is the contract that replaced it —
 * starting a backup returns immediately, only one runs at a time, the result
 * arrives as a toast, and a manual run's once-only phrase survives the member
 * walking off the screen.
 *
 * Ported from `budget/local/__tests__/backupTaskStore.test.ts`, plus the one
 * thing House adds: a manual run names the home it is sealing, because the
 * Backup screen's picker can be pointed at a home that is not the active one.
 */
const mockSaveHouseBackupTo = jest.fn();
jest.mock('../backup/backupDestinations', () => ({
  saveHouseBackupTo: (...a: unknown[]) => mockSaveHouseBackupTo(...a),
}));

const mockShowToast = jest.fn();
jest.mock('@services/toastManager', () => ({
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));

const mockRecordSuccess = jest.fn();
jest.mock('../backup/backupHistory', () => ({
  recordHouseBackupSuccess: (...a: unknown[]) => mockRecordSuccess(...a),
}));

import {
  beginHouseBackupTask,
  consumeHouseBackupPhrase,
  finishHouseBackupTask,
  isHouseBackupRunning,
  startManualHouseBackup,
  useHouseBackupTaskStore,
} from '../backup/backupTaskStore';

const PHRASE = 'apple bridge cactus dolphin ember forest garden harbor island jungle kettle lantern';

/** Let the fire-and-forget chain inside startManualHouseBackup settle. */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  useHouseBackupTaskStore.getState().reset();
});

describe('the backup slot', () => {
  it('is single-flight — a second run is refused, not queued', () => {
    const first = beginHouseBackupTask('manual', 'device');
    expect(first).not.toBeNull();
    expect(beginHouseBackupTask('scheduled')).toBeNull();
    expect(isHouseBackupRunning()).toBe(true);

    finishHouseBackupTask(first!, { status: 'ok', message: 'Saved.' });
    expect(isHouseBackupRunning()).toBe(false);
    expect(beginHouseBackupTask('scheduled')).not.toBeNull();
  });

  it('toasts success and failure, and says nothing about a cancelled run', () => {
    const a = beginHouseBackupTask('manual', 'device')!;
    finishHouseBackupTask(a, { status: 'ok', message: 'Backup saved.' });
    expect(mockShowToast).toHaveBeenCalledWith('success', 'Backup saved.', 6000);

    const b = beginHouseBackupTask('scheduled')!;
    finishHouseBackupTask(b, { status: 'failed', message: 'Could not finish.' });
    expect(mockShowToast).toHaveBeenCalledWith('error', 'Could not finish.', 6000);

    mockShowToast.mockClear();
    const c = beginHouseBackupTask('manual', 'share')!;
    finishHouseBackupTask(c, { status: 'cancelled', message: 'Cancelled.' });
    // Dismissing the share sheet is what the member asked for, not an outcome.
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(useHouseBackupTaskStore.getState().status).toBe('idle');
  });

  it('takes over a claim left behind by a run that never came back', () => {
    // A manual backup awaits an OS share sheet; a member who swipes it away
    // never resolves the promise, and every scheduled run afterwards would find
    // the slot busy and go silent.
    const abandoned = beginHouseBackupTask('manual', 'share')!;
    useHouseBackupTaskStore.setState({ startedAt: Date.now() - 6 * 60 * 1000 });

    const fresh = beginHouseBackupTask('scheduled');
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(abandoned);

    // The abandoned run finally settling must not talk over the live one.
    finishHouseBackupTask(abandoned, { status: 'ok', message: 'Stale news.' });
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(useHouseBackupTaskStore.getState().status).toBe('running');

    finishHouseBackupTask(fresh!, { status: 'ok', message: 'Saved on this device.' });
    expect(mockShowToast).toHaveBeenCalledWith('success', 'Saved on this device.', 6000);
  });
});

describe('startManualHouseBackup', () => {
  it('returns before the seal finishes, so navigation is never blocked', async () => {
    let resolveSave: (v: unknown) => void = () => {};
    mockSaveHouseBackupTo.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    expect(startManualHouseBackup('device')).toBe(true);
    // Still sealing — and the caller already has control back.
    expect(useHouseBackupTaskStore.getState().status).toBe('running');
    expect(mockShowToast).not.toHaveBeenCalled();

    resolveSave({ status: 'saved', message: 'Saved on this device.' });
    await flush();

    expect(useHouseBackupTaskStore.getState().status).toBe('ok');
    expect(mockShowToast).toHaveBeenCalledWith('success', 'Saved on this device.', 6000);
  });

  /**
   * Q15: an archive covers one home, and the Backup screen's picker can be
   * pointed at a home the member has not switched into. Sealing "whatever is
   * active" would hand them the wrong home's file under the right home's name.
   */
  it('seals the home the screen asked for, not whichever is active', async () => {
    mockSaveHouseBackupTo.mockResolvedValue({ status: 'saved', message: 'Saved.' });

    startManualHouseBackup('device', 'hh_local_cabin');
    await flush();

    expect(mockSaveHouseBackupTo).toHaveBeenCalledWith('device', {
      householdId: 'hh_local_cabin',
    });
  });

  it('leaves the home unnamed when the screen does not name one', async () => {
    mockSaveHouseBackupTo.mockResolvedValue({ status: 'saved', message: 'Saved.' });

    startManualHouseBackup('device');
    await flush();

    // `{}` rather than `{householdId: undefined}` — the destination layer's own
    // default (the active home) has to be reachable.
    expect(mockSaveHouseBackupTo).toHaveBeenCalledWith('device', {});
  });

  it('parks a fresh phrase for the screen instead of losing it to a toast', async () => {
    mockSaveHouseBackupTo.mockResolvedValue({
      status: 'saved',
      message: 'Saved on this device.',
      phrase: PHRASE,
    });

    startManualHouseBackup('device');
    await flush();

    // The words never travel through the toast — it points at the screen.
    const [[, toastMessage]] = mockShowToast.mock.calls;
    expect(toastMessage).not.toContain('apple bridge');
    expect(toastMessage).toContain('recovery phrase');

    const pending = consumeHouseBackupPhrase();
    expect(pending?.phrase).toBe(PHRASE);
    // Handed over exactly once.
    expect(consumeHouseBackupPhrase()).toBeNull();
  });

  it('carries where the file landed into the phrase sheet', async () => {
    // Only the run that wrote the file knows the uri, and the member may not
    // reach the Backup screen for another minute.
    const savedTo = {
      kind: 'device' as const,
      where: 'On this device',
      breadcrumb: null,
      fileName: 'a.json',
      uri: 'file:///docs/house-backups/a.json',
      icon: 'phone-portrait-outline',
    };
    mockSaveHouseBackupTo.mockResolvedValue({
      status: 'saved',
      message: 'Saved.',
      phrase: PHRASE,
      savedTo,
    });

    startManualHouseBackup('device');
    await flush();

    expect(consumeHouseBackupPhrase()?.savedTo).toEqual(savedTo);
  });

  it('records a written backup, with where it went and whose home it was', async () => {
    mockSaveHouseBackupTo.mockResolvedValue({
      status: 'saved',
      message: 'Uploaded to Google Drive.',
      fileName: 'symply-house-backup-2026-08-16-0915-maple--hh_local_maple.json',
      householdId: 'hh_local_maple',
    });

    startManualHouseBackup('google-drive', 'hh_local_maple');
    await flush();

    expect(mockRecordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: 'google-drive',
        kind: 'manual',
        householdId: 'hh_local_maple',
      }),
    );
  });

  it('records nothing for a share sheet, which reports no outcome', async () => {
    // `Sharing.shareAsync` resolves the same whether the member saved the file
    // or swiped the sheet away — recording it would let a dismissed sheet claim
    // the home is protected.
    mockSaveHouseBackupTo.mockResolvedValue({
      status: 'shared',
      message: 'Handed to the share sheet.',
      fileName: 'a.json',
    });

    startManualHouseBackup('share');
    await flush();

    expect(mockRecordSuccess).not.toHaveBeenCalled();
  });

  it('still hands over the phrase when the write failed', async () => {
    // The archive is sealed under those words by then; losing them loses a
    // secret the member could still have used against a retry.
    mockSaveHouseBackupTo.mockResolvedValue({
      status: 'failed',
      message: 'Could not write the backup file.',
      phrase: PHRASE,
    });

    startManualHouseBackup('device');
    await flush();

    expect(consumeHouseBackupPhrase()?.phrase).toBe(PHRASE);
    expect(useHouseBackupTaskStore.getState().status).toBe('failed');
  });

  it('reports a throw as a failure instead of leaving the slot stuck', async () => {
    mockSaveHouseBackupTo.mockRejectedValue(new Error('disk full'));

    startManualHouseBackup('device');
    await flush();

    expect(useHouseBackupTaskStore.getState().status).toBe('failed');
    expect(mockShowToast).toHaveBeenCalledWith('error', 'Could not create a backup.', 6000);
    expect(isHouseBackupRunning()).toBe(false);
  });

  it('refuses a second manual start while one is in flight', async () => {
    mockSaveHouseBackupTo.mockReturnValue(new Promise(() => {}));

    expect(startManualHouseBackup('device')).toBe(true);
    expect(startManualHouseBackup('files')).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith('info', 'A backup is already running.');
    expect(mockSaveHouseBackupTo).toHaveBeenCalledTimes(1);
  });
});
