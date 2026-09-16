/**
 * The background backup slot.
 *
 * Sealing an archive used to be owned by the screen that started it: it awaited
 * the promise, and the outcome was reported to whatever was mounted. Navigate
 * away and nobody heard. What is pinned here is the contract that replaced it —
 * starting a backup returns immediately, only one runs at a time, the result
 * arrives as a toast, and the phrase the FIRST run mints survives the member
 * walking off the screen.
 */
const mockSaveBudgetBackupTo = jest.fn();
jest.mock('../backup/backupDestinations', () => ({
  saveBudgetBackupTo: (...a: unknown[]) => mockSaveBudgetBackupTo(...a),
}));

/**
 * The device's one phrase. Mocked rather than exercised: what matters here is
 * that the manual run seals under whatever this returns instead of minting its
 * own, and that only a `created: true` answer opens the sheet. The keychain
 * behaviour behind it is `backupPhrase`'s own test.
 */
const mockEnsurePhrase = jest.fn();
jest.mock('../backup/backupPhrase', () => ({
  ensureBudgetBackupPhrase: () => mockEnsurePhrase(),
}));

const DEVICE_PHRASE = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';

const mockShowToast = jest.fn();
jest.mock('@services/toastManager', () => ({
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));

const mockRecordSuccess = jest.fn();
jest.mock('../backup/backupHistory', () => ({
  recordBudgetBackupSuccessFor: (...a: unknown[]) => mockRecordSuccess(...a),
}));

const mockNavigateToBudgetBackup = jest.fn();
jest.mock('@services/navigation', () => ({
  navigateToBudgetBackup: () => mockNavigateToBudgetBackup(),
}));

import {
  beginBudgetBackupTask,
  consumeBudgetBackupPhrase,
  finishBudgetBackupTask,
  isBudgetBackupRunning,
  startManualBudgetBackup,
  useBudgetBackupTaskStore,
} from '../backup/backupTaskStore';

/** Let the fire-and-forget chain inside startManualBudgetBackup settle. */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  useBudgetBackupTaskStore.getState().reset();
  // The common case by far: a device that already has its phrase.
  mockEnsurePhrase.mockResolvedValue({ phrase: DEVICE_PHRASE, created: false });
});

describe('the backup slot', () => {
  it('is single-flight — a second run is refused, not queued', () => {
    const first = beginBudgetBackupTask('manual', 'device');
    expect(first).not.toBeNull();
    expect(beginBudgetBackupTask('scheduled')).toBeNull();
    expect(isBudgetBackupRunning()).toBe(true);

    finishBudgetBackupTask(first!, { status: 'ok', message: 'Saved.' });
    expect(isBudgetBackupRunning()).toBe(false);
    expect(beginBudgetBackupTask('scheduled')).not.toBeNull();
  });

  it('toasts success and failure, and says nothing about a cancelled run', () => {
    const a = beginBudgetBackupTask('manual', 'device')!;
    finishBudgetBackupTask(a, { status: 'ok', message: 'Backup saved.' });
    expect(mockShowToast).toHaveBeenCalledWith('success', 'Backup saved.', 6000);

    const b = beginBudgetBackupTask('scheduled')!;
    finishBudgetBackupTask(b, { status: 'failed', message: 'Could not finish.' });
    expect(mockShowToast).toHaveBeenCalledWith('error', 'Could not finish.', 6000);

    mockShowToast.mockClear();
    const c = beginBudgetBackupTask('manual', 'share')!;
    finishBudgetBackupTask(c, { status: 'cancelled', message: 'Cancelled.' });
    // Dismissing the share sheet is what the member asked for, not an outcome.
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(useBudgetBackupTaskStore.getState().status).toBe('idle');
  });

  /**
   * "Google Drive needs to be reconnected before backups can run" is announced
   * by a SCHEDULED run, so it reaches the member on whatever screen they are
   * on — Home, usually. Read-only, it names a problem and then fades, leaving
   * them to find More → Backup & Restore on their own; most do not, and the
   * backups stay off. The toast has to be the way there.
   */
  it('makes a needs_auth toast a tap target that opens Backup & Restore', () => {
    const run = beginBudgetBackupTask('scheduled')!;
    finishBudgetBackupTask(run, {
      status: 'needs_auth',
      message: 'Google Drive needs to be reconnected before backups can run.',
    });

    const [type, message, duration, options] = mockShowToast.mock.calls[0] as [
      string,
      string,
      number,
      { onPress: () => void; actionLabel: string },
    ];
    expect(type).toBe('error');
    expect(message).toContain('reconnected');
    expect(duration).toBe(6000);
    expect(options.actionLabel).toBe('Reconnect');

    options.onPress();
    expect(mockNavigateToBudgetBackup).toHaveBeenCalledTimes(1);
  });

  // Only the outcome the member can act on gets a destination. A saved backup
  // has nowhere to send them, and a tappable success toast would sit over the
  // screen swallowing taps for six seconds for no reason.
  it('leaves every other outcome a plain, untappable message', () => {
    const ok = beginBudgetBackupTask('manual', 'device')!;
    finishBudgetBackupTask(ok, { status: 'ok', message: 'Backup saved.' });
    expect(mockShowToast).toHaveBeenLastCalledWith('success', 'Backup saved.', 6000);

    const failed = beginBudgetBackupTask('scheduled')!;
    finishBudgetBackupTask(failed, { status: 'failed', message: 'Could not finish.' });
    expect(mockShowToast).toHaveBeenLastCalledWith('error', 'Could not finish.', 6000);
  });

  it('takes over a claim left behind by a run that never came back', () => {
    // Observed on device: a manual backup awaited an OS share sheet the member
    // swiped away, so its promise never settled. Every scheduled backup after
    // it then found the slot busy and went silent.
    const abandoned = beginBudgetBackupTask('manual', 'share')!;
    useBudgetBackupTaskStore.setState({ startedAt: Date.now() - 6 * 60 * 1000 });

    const fresh = beginBudgetBackupTask('scheduled');
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(abandoned);

    // The abandoned run finally settling must not talk over the live one.
    finishBudgetBackupTask(abandoned, { status: 'ok', message: 'Stale news.' });
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(useBudgetBackupTaskStore.getState().status).toBe('running');

    finishBudgetBackupTask(fresh!, { status: 'ok', message: 'Saved on this device.' });
    expect(mockShowToast).toHaveBeenCalledWith('success', 'Saved on this device.', 6000);
  });
});

describe('startManualBudgetBackup', () => {
  it('returns before the seal finishes, so navigation is never blocked', async () => {
    let resolveSave: (v: unknown) => void = () => {};
    mockSaveBudgetBackupTo.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    expect(startManualBudgetBackup('device')).toBe(true);
    // Still sealing — and the caller already has control back.
    expect(useBudgetBackupTaskStore.getState().status).toBe('running');
    expect(mockShowToast).not.toHaveBeenCalled();

    await flush();
    resolveSave({ status: 'saved', message: 'Saved to this device.', householdIds: ['hh1'] });
    await flush();

    expect(useBudgetBackupTaskStore.getState().status).toBe('ok');
    expect(mockShowToast).toHaveBeenCalledWith('success', 'Saved to this device.', 6000);
  });

  /**
   * The change this file exists to protect: every manual backup used to mint its
   * own twelve words, so a member who backed up weekly collected a pile of
   * phrases with no way to tell which opened which archive. One device phrase,
   * reused, is the fix — and the seal has to be handed it explicitly, because
   * `saveBudgetBackupTo` mints one when nobody passes it.
   */
  it('seals with the device phrase rather than minting a new one per archive', async () => {
    mockSaveBudgetBackupTo.mockResolvedValue({
      status: 'saved',
      message: 'Saved to this device.',
      phrase: DEVICE_PHRASE,
      householdIds: ['hh1'],
    });

    startManualBudgetBackup('device');
    await flush();

    expect(mockSaveBudgetBackupTo).toHaveBeenCalledWith(
      'device',
      expect.objectContaining({ phrase: DEVICE_PHRASE }),
    );
  });

  it('parks the phrase it MINTED for the screen instead of losing it to a toast', async () => {
    mockEnsurePhrase.mockResolvedValue({ phrase: DEVICE_PHRASE, created: true });
    mockSaveBudgetBackupTo.mockResolvedValue({
      status: 'saved',
      message: 'Saved to this device.',
      phrase: DEVICE_PHRASE,
      householdIds: ['hh1'],
    });

    startManualBudgetBackup('device');
    await flush();

    // The words never travel through the toast — it points at the screen.
    const [[, toastMessage]] = mockShowToast.mock.calls;
    expect(toastMessage).not.toContain('alpha bravo');
    expect(toastMessage).toContain('recovery phrase');

    const pending = consumeBudgetBackupPhrase();
    expect(pending?.phrase).toContain('alpha bravo charlie');
    // Handed over exactly once.
    expect(consumeBudgetBackupPhrase()).toBeNull();
  });

  /**
   * The other half, and the actual complaint: a phrase the member has already
   * been shown must not interrupt them again. It is one tap away on the
   * "Recovery phrase" row for the rest of the device's life, so the second
   * backup says only where the file went.
   */
  it('says nothing about the phrase on a backup that reused it', async () => {
    mockSaveBudgetBackupTo.mockResolvedValue({
      status: 'saved',
      message: 'Saved on this device.',
      phrase: DEVICE_PHRASE,
      householdIds: ['hh1'],
    });

    startManualBudgetBackup('device');
    await flush();

    expect(consumeBudgetBackupPhrase()).toBeNull();
    expect(mockShowToast).toHaveBeenCalledWith('success', 'Saved on this device.', 6000);
  });

  // The status card can only claim protection it can point at, so a manual run
  // has to leave a record — otherwise a member who had just uploaded to Drive
  // was told "No backup yet".
  it('records a written backup against every household in it', async () => {
    mockSaveBudgetBackupTo.mockResolvedValue({
      status: 'saved',
      message: 'Uploaded to Google Drive.',
      fileName: 'symply-budget-backup-2026-08-16-0915.json',
      householdIds: ['hh1', 'hh2'],
    });

    startManualBudgetBackup('google-drive');
    await flush();

    // Every household in the bundle, not just the active one: the file protects
    // all of them, and recording it against one would leave the others' status
    // cards reading "No backup yet" over data sitting in that same file.
    expect(mockRecordSuccess).toHaveBeenCalledWith(
      ['hh1', 'hh2'],
      expect.objectContaining({
        destination: 'google-drive',
        kind: 'manual',
        fileName: 'symply-budget-backup-2026-08-16-0915.json',
      }),
    );
  });

  it('records nothing for a share sheet, which reports no outcome', async () => {
    // `Sharing.shareAsync` resolves the same whether the member saved the file
    // or swiped the sheet away — recording it would let a dismissed sheet claim
    // the budget is protected.
    mockSaveBudgetBackupTo.mockResolvedValue({
      status: 'shared',
      message: 'Handed to the share sheet.',
      fileName: 'symply-budget-backup-2026-08-16-0915.json',
    });

    startManualBudgetBackup('share');
    await flush();

    expect(mockRecordSuccess).not.toHaveBeenCalled();
  });

  /**
   * Not recording it is right; calling it a failure is not. The share sheet
   * outcome used to fall through to `failed`, so a manual backup that sealed
   * fine and handed the file over reported itself with a red ✗ toast reading
   * "Handed to the share sheet." — seen on device, and the reason this case
   * has its own status.
   */
  it('says a share sheet handoff plainly — it is not a failed backup', async () => {
    mockSaveBudgetBackupTo.mockResolvedValue({
      status: 'shared',
      message: 'Handed to the share sheet.',
      fileName: 'symply-budget-backup-2026-08-16-0915.json',
    });

    startManualBudgetBackup('share');
    await flush();

    expect(mockShowToast).toHaveBeenCalledWith('info', 'Handed to the share sheet.', 6000);
    // Nothing to accuse and nothing to claim: the slot just goes quiet.
    expect(useBudgetBackupTaskStore.getState().status).toBe('idle');
    expect(useBudgetBackupTaskStore.getState().message).toBe('Handed to the share sheet.');
    expect(isBudgetBackupRunning()).toBe(false);
  });

  it('reports a throw as a failure instead of leaving the slot stuck', async () => {
    mockSaveBudgetBackupTo.mockRejectedValue(new Error('disk full'));

    startManualBudgetBackup('device');
    await flush();

    expect(useBudgetBackupTaskStore.getState().status).toBe('failed');
    expect(mockShowToast).toHaveBeenCalledWith('error', 'Could not create a backup.', 6000);
    expect(isBudgetBackupRunning()).toBe(false);
  });

  it('refuses a second manual start while one is in flight', async () => {
    mockSaveBudgetBackupTo.mockReturnValue(new Promise(() => {}));

    expect(startManualBudgetBackup('device')).toBe(true);
    expect(startManualBudgetBackup('files')).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith('info', 'A backup is already running.');
    // Settled after the phrase lookup the run now awaits before it seals.
    await flush();
    expect(mockSaveBudgetBackupTo).toHaveBeenCalledTimes(1);
  });
});
