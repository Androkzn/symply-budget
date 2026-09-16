/**
 * HouseBackupScreen — Backup & Restore, ported from Budget's.
 *
 * What is worth pinning here is not layout, it is the promises the screen makes
 * to a member:
 *
 *  1. every home is listed and everything below the picker describes the one
 *     that is selected (Q15: one archive covers one property, H5: up to three);
 *  2. the status card only claims protection it can still point at — a
 *     `lastRunAt` whose archive has since been deleted is NOT "Protected";
 *  3. the once-only recovery phrase is presented even when the run that minted
 *     it finished while the member was somewhere else;
 *  4. an archive from ANOTHER home cannot be restored without an explicit yes;
 *  5. the attachment manifest is stated, not hidden — bytes are not in the file.
 *
 * All imports are static: `await import()` throws
 * "dynamic import callback was invoked without --experimental-vm-modules"
 * under this Jest config.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn(), canGoBack: () => true }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactModule = require('react');
    ReactModule.useEffect(callback, [callback]);
  },
}));

jest.mock('@components/common', () => {
  const ReactModule = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(View, null, children ?? null),
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      ReactModule.createElement(View, { testID }, children ?? null),
    ScreenHeader: ({ onBackPress }: { onBackPress?: () => void }) =>
      ReactModule.createElement(TouchableOpacity, {
        onPress: onBackPress,
        testID: 'nav-back-button',
      }),
  };
});

// Reanimated + the cloud browser are irrelevant to every assertion below and
// both pull native surfaces into a pure render test.
jest.mock('@components/backup/RestoreProgressCard', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    RestoreProgressCard: ({ testID }: { testID?: string }) =>
      ReactModule.createElement(View, { testID }),
  };
});
jest.mock('@components/backup/CloudFolderPickerSheet', () => ({
  __esModule: true,
  CloudFolderPickerSheet: () => null,
}));
jest.mock('@components/backup/RecoveryPhraseSheet', () => {
  const ReactModule = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    RecoveryPhraseSheet: ({ visible, phrase }: { visible: boolean; phrase: string }) =>
      visible
        ? ReactModule.createElement(
            View,
            { testID: 'house-recovery-phrase-sheet' },
            ReactModule.createElement(Text, { testID: 'house-recovery-phrase-value' }, phrase),
          )
        : null,
  };
});

const mockListProperties = jest.fn();
const mockGetActiveHouseholdId = jest.fn();
jest.mock('@features/house/local/engine', () => ({
  listLocalHouseProperties: () => mockListProperties(),
  getActiveHouseholdId: () => mockGetActiveHouseholdId(),
}));

const mockSummarizeProperty = jest.fn();
const mockPickArchive = jest.fn();
jest.mock('@features/house/local/backup/houseBackup', () => ({
  __esModule: true,
  summarizeHouseProperty: (...a: unknown[]) => mockSummarizeProperty(...a),
  pickHouseBackupArchive: () => mockPickArchive(),
}));

const mockGetAutoSettings = jest.fn();
const mockEnableAuto = jest.fn();
const mockDisableAuto = jest.fn();
const mockUpdateAuto = jest.fn();
const mockGetAutoPhrase = jest.fn();
const mockRunIfDue = jest.fn();
jest.mock('@features/house/local/backup/autoBackup', () => ({
  __esModule: true,
  HOUSE_AUTO_BACKUP_FREQUENCY_LABEL: {
    daily: 'Every day',
    weekly: 'Every week',
    monthly: 'Every 30 days',
  },
  getHouseAutoBackupSettings: (...a: unknown[]) => mockGetAutoSettings(...a),
  enableHouseAutoBackup: (...a: unknown[]) => mockEnableAuto(...a),
  disableHouseAutoBackup: (...a: unknown[]) => mockDisableAuto(...a),
  updateHouseAutoBackupSettings: (...a: unknown[]) => mockUpdateAuto(...a),
  getHouseAutoBackupPhrase: (...a: unknown[]) => mockGetAutoPhrase(...a),
  runHouseAutoBackupIfDue: (...a: unknown[]) => mockRunIfDue(...a),
  // Pure, and the status card's overdue branch depends on it.
  nextHouseAutoBackupDueAt: (settings: { enabled: boolean; lastRunAt: string | null }) =>
    settings.enabled ? new Date(settings.lastRunAt ?? 0) : null,
}));

const mockListLocal = jest.fn();
const mockReadLocal = jest.fn();
const mockDeleteLocal = jest.fn();
const mockListCloud = jest.fn();
const mockReadCloud = jest.fn();
jest.mock('@features/house/local/backup/backupDestinations', () => ({
  __esModule: true,
  HOUSE_BACKUP_DEVICE_FOLDER: 'Symply House Backups',
  HOUSE_BACKUP_DRIVE_FOLDER: 'Symply House Backups',
  autoBackupDestinationLabel: (d: string) => (d === 'device' ? 'This device' : 'Google Drive'),
  chooseCloudBackupFolder: jest.fn(),
  chooseDeviceBackupFolder: jest.fn(),
  cloudProviderLabel: (p: string) => (p === 'dropbox' ? 'Dropbox' : 'Google Drive'),
  cloudProviderSupportsFolderPicking: () => true,
  deleteLocalHouseBackup: (...a: unknown[]) => mockDeleteLocal(...a),
  describeCloudFolder: (f: { name: string }) => f.name,
  disconnectCloudProvider: jest.fn(),
  forgetDeviceFolder: jest.fn(),
  getCloudAccount: jest.fn(async () => null),
  getHouseBackupRetention: jest.fn(async () => 'replace'),
  getRememberedDeviceFolder: jest.fn(async () => null),
  getRememberedDriveFolder: jest.fn(async () => null),
  isCloudProviderConfigured: (p: string) => p === 'google-drive',
  listCloudHouseBackups: (...a: unknown[]) => mockListCloud(...a),
  listLocalHouseBackups: (...a: unknown[]) => mockListLocal(...a),
  readCloudHouseBackup: (...a: unknown[]) => mockReadCloud(...a),
  readLocalHouseBackup: (...a: unknown[]) => mockReadLocal(...a),
  reconnectCloudProvider: jest.fn(),
  resetCloudBackupFolder: jest.fn(),
  setHouseBackupRetention: jest.fn(),
  switchCloudAccount: jest.fn(),
}));

const mockGetLastEvent = jest.fn();
jest.mock('@features/house/local/backup/backupHistory', () => ({
  __esModule: true,
  backupEvidenceIsLocal: (d: string) => d === 'device',
  getLastHouseBackupEvent: (...a: unknown[]) => mockGetLastEvent(...a),
}));

/** A hand-rolled stand-in for the zustand slot — no subscriptions needed here. */
const backupTask = { status: 'idle', kind: null as string | null, pendingPhrase: null as unknown };
const mockConsumePhrase = jest.fn();
const mockStartManualBackup = jest.fn();
jest.mock('@features/house/local/backup/backupTaskStore', () => {
  const useStore = (selector: (s: typeof backupTask) => unknown) => selector(backupTask);
  useStore.getState = () => backupTask;
  return {
    __esModule: true,
    useHouseBackupTaskStore: useStore,
    consumeHouseBackupPhrase: () => mockConsumePhrase(),
    startManualHouseBackup: (...a: unknown[]) => mockStartManualBackup(...a),
  };
});

const restoreTask = {
  status: 'idle',
  progress: 0,
  label: 'Preparing…',
  startedAt: null as number | null,
  attempt: null as unknown,
  pendingSummary: null as unknown,
};
const mockStartRestore = jest.fn();
const mockTakeAttempt = jest.fn();
const mockConsumeRestoreSummary = jest.fn();
jest.mock('@features/house/local/backup/restoreTaskStore', () => {
  const useStore = (selector: (s: typeof restoreTask) => unknown) => selector(restoreTask);
  useStore.getState = () => restoreTask;
  return {
    __esModule: true,
    HOUSE_RESTORE_ESTIMATE_MS: 150_000,
    useHouseRestoreTaskStore: useStore,
    startHouseRestore: (...a: unknown[]) => mockStartRestore(...a),
    takeHouseRestoreAttempt: () => mockTakeAttempt(),
    consumeHouseRestoreSummary: () => mockConsumeRestoreSummary(),
  };
});

const mockRememberedPhrase = jest.fn();
jest.mock('@features/house/local/backup/restorePhraseMemory', () => ({
  __esModule: true,
  getRememberedRestorePhrase: (...a: unknown[]) => mockRememberedPhrase(...a),
}));

const mockExportCsv = jest.fn();
jest.mock('@features/house/local/export/houseLedgerExport', () => ({
  __esModule: true,
  exportHouseLedgerCsv: () => mockExportCsv(),
}));

jest.mock('@services/backup/backupFileAccess', () => ({
  __esModule: true,
  openBackupLocation: jest.fn(async () => ({ status: 'opened' })),
  opensInFilesApp: () => false,
}));

const mockClipboardGet = jest.fn();
jest.mock('expo-clipboard', () => ({
  __esModule: true,
  getStringAsync: () => mockClipboardGet(),
  setStringAsync: jest.fn(async () => true),
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { HouseBackupScreen, deriveBackupHealth, formatBackupEntryLabel } from '../HouseBackupScreen';

const PHRASE = 'apple bridge cactus dolphin ember forest garden harbor island jungle kettle lantern';

const SUMMARY = {
  householdId: 'hh-maple',
  propertyName: 'Maple Street',
  tableCounts: { tasks: 12, spaces: 3, appliances: 0, utilities: 5 },
  totalRows: 20,
  blobManifest: [
    { table: 'tasks', blobId: 'blob-1', bytes: 2_500_000, mime: 'image/jpeg' },
    { table: 'appliances', blobId: 'blob-2', bytes: 1_500_000, mime: 'application/pdf' },
  ],
};

const PROPERTIES = [
  {
    householdId: 'hh-maple',
    deviceId: 'dev-1',
    name: 'Maple Street',
    role: 'owner',
    isActive: true,
    hydrated: true,
    awaitingEnrolment: false,
  },
  {
    householdId: 'hh-cabin',
    deviceId: 'dev-1',
    name: 'Lake Cabin',
    role: 'member',
    isActive: false,
    hydrated: true,
    awaitingEnrolment: false,
  },
];

const AUTO_OFF = {
  enabled: false,
  frequency: 'weekly' as const,
  destination: 'device' as const,
  keepLast: 5,
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  overdueNotificationId: null,
};

const ARCHIVE = {
  fileName: 'symply-house-backup-2026-08-11-0915-maple-street--hh-maple.json',
  uri: 'file:///docs/house-backups/symply-house-backup-2026-08-11-0915-maple-street--hh-maple.json',
  size: 40960,
  modifiedAt: '2026-08-11T09:15:00.000Z',
  householdId: 'hh-maple',
};

async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HouseBackupScreen />
      </ThemeProvider>,
    );
  });
  await flush();
  mounted.push(tree);
  return tree;
}

const find = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.find((node) => node.props?.testID === id);

const query = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => node.props?.testID === id, { deep: false })[0] ?? null;

const textOf = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  String(find(tree, id).props.children ?? '');

async function press(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  await act(async () => {
    find(tree, id).props.onPress?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  backupTask.status = 'idle';
  backupTask.kind = null;
  backupTask.pendingPhrase = null;
  restoreTask.status = 'idle';
  restoreTask.attempt = null;
  restoreTask.pendingSummary = null;

  mockListProperties.mockReturnValue(PROPERTIES);
  mockGetActiveHouseholdId.mockReturnValue('hh-maple');
  mockSummarizeProperty.mockResolvedValue(SUMMARY);
  mockGetAutoSettings.mockResolvedValue({ ...AUTO_OFF });
  mockListLocal.mockResolvedValue([]);
  mockGetLastEvent.mockResolvedValue(null);
  mockExportCsv.mockResolvedValue({ status: 'shared', message: 'Your export is ready.', rows: 42 });
  mockClipboardGet.mockResolvedValue('');
  mockRememberedPhrase.mockResolvedValue(null);
  mockStartRestore.mockReturnValue(true);
  mockStartManualBackup.mockReturnValue(true);
});

afterEach(async () => {
  await act(async () => {
    while (mounted.length) mounted.pop()!.unmount();
  });
});

describe('HouseBackupScreen — which home', () => {
  /**
   * The default is "All homes", and it is the most consequential default on this
   * screen: a member with three properties who backs up "the one I have open"
   * has two homes they believe are safe and are not. One file with a section per
   * home removes the chance of that, so it is what the screen suggests.
   */
  it('offers all homes together, and defaults to it', async () => {
    const tree = await renderScreen();
    expect(query(tree, 'house-backup-property-all-homes')).toBeTruthy();
    expect(query(tree, 'house-backup-property-hh-maple')).toBeTruthy();
    expect(query(tree, 'house-backup-property-hh-cabin')).toBeTruthy();
    // Every read is addressed to the selection, not to "active".
    expect(mockGetAutoSettings).toHaveBeenCalledWith('all-homes');
    expect(mockListLocal).toHaveBeenCalledWith('all-homes');
    expect(mockSummarizeProperty).toHaveBeenCalledWith('all-homes');
  });

  it('backs every home up in one file when that is what is selected', async () => {
    const tree = await renderScreen();
    await press(tree, 'house-backup-now');
    await press(tree, 'house-backup-to-device');

    expect(mockStartManualBackup).toHaveBeenCalledWith('device', 'all-homes');
  });

  it('still lets the member narrow to a single home', async () => {
    const tree = await renderScreen();
    await act(async () => {
      find(tree, 'house-backup-property-hh-maple').props.onPress();
    });
    await flush();

    await press(tree, 'house-backup-now');
    await press(tree, 'house-backup-to-device');

    expect(mockStartManualBackup).toHaveBeenCalledWith('device', 'hh-maple');
  });

  it('does not offer the choice at all on a device with one home', async () => {
    // "All homes (1)" above the only home is a choice with no content.
    mockListProperties.mockReturnValue([PROPERTIES[0]]);
    const tree = await renderScreen();

    expect(query(tree, 'house-backup-property-all-homes')).toBeNull();
    expect(mockSummarizeProperty).toHaveBeenCalledWith('hh-maple');
  });

  it('re-reads everything for the home the member picks', async () => {
    const tree = await renderScreen();
    await act(async () => {
      find(tree, 'house-backup-property-hh-cabin').props.onPress();
    });
    await flush();

    expect(mockGetAutoSettings).toHaveBeenCalledWith('hh-cabin');
    expect(mockListLocal).toHaveBeenCalledWith('hh-cabin');
    expect(mockSummarizeProperty).toHaveBeenCalledWith('hh-cabin');
  });

  it('backs up the home the member picked, not the active one', async () => {
    const tree = await renderScreen();
    await act(async () => {
      find(tree, 'house-backup-property-hh-cabin').props.onPress();
    });
    await flush();

    await press(tree, 'house-backup-now');
    await press(tree, 'house-backup-to-device');

    expect(mockStartManualBackup).toHaveBeenCalledWith('device', 'hh-cabin');
  });

  it('cannot back anything up when no home is open', async () => {
    mockListProperties.mockReturnValue([]);
    mockGetActiveHouseholdId.mockReturnValue(null);
    const tree = await renderScreen();

    expect(query(tree, 'house-backup-property-empty')).toBeTruthy();
    expect(find(tree, 'house-backup-now').props.disabled).toBe(true);
  });
});

describe('deriveBackupHealth — only claim protection we can point at', () => {
  const now = new Date('2026-08-20T12:00:00.000Z');

  it('says "No backup yet" when nothing has ever been written', () => {
    const health = deriveBackupHealth(
      { ...AUTO_OFF },
      { newestLocalBackupAt: null, localListKnown: true, lastSuccess: null },
      now,
    );
    expect(health.tone).toBe('warn');
    expect(health.title).toBe('No backup yet');
  });

  it('refuses to say "Protected" when the on-device archive it named is gone', () => {
    // The exact contradiction this function exists to end: a schedule that ran,
    // and a folder that no longer holds the file it produced.
    const health = deriveBackupHealth(
      { ...AUTO_OFF, enabled: true, lastRunAt: '2026-08-19T12:00:00.000Z' },
      {
        newestLocalBackupAt: null,
        localListKnown: true,
        lastSuccess: {
          at: '2026-08-19T12:00:00.000Z',
          destination: 'device',
          kind: 'scheduled',
          fileName: 'x.json',
        },
      },
      now,
    );
    expect(health.title).toBe('Backup missing');
    expect(health.detail).toMatch(/no longer on this device/i);
  });

  it('keeps a cloud run on trust — a status card cannot re-check Drive', () => {
    const health = deriveBackupHealth(
      {
        ...AUTO_OFF,
        enabled: true,
        destination: 'google-drive',
        lastRunAt: '2026-08-20T09:00:00.000Z',
      },
      {
        newestLocalBackupAt: null,
        localListKnown: true,
        lastSuccess: {
          at: '2026-08-20T09:00:00.000Z',
          destination: 'google-drive',
          kind: 'scheduled',
          fileName: 'x.json',
        },
      },
      now,
    );
    expect(health.title).toBe('Protected');
    expect(health.detail).toMatch(/Google Drive/);
  });

  it('gives an unreadable folder the benefit of the doubt rather than inventing a loss', () => {
    const health = deriveBackupHealth(
      { ...AUTO_OFF, enabled: true, lastRunAt: '2026-08-20T09:00:00.000Z' },
      {
        newestLocalBackupAt: null,
        localListKnown: false,
        lastSuccess: {
          at: '2026-08-20T09:00:00.000Z',
          destination: 'device',
          kind: 'scheduled',
          fileName: 'x.json',
        },
      },
      now,
    );
    expect(health.title).toBe('Protected');
  });

  it('surfaces a failed schedule above everything else', () => {
    const health = deriveBackupHealth(
      { ...AUTO_OFF, enabled: true, lastStatus: 'needs_auth', lastError: 'Reconnect Drive.' },
      { newestLocalBackupAt: null, localListKnown: true, lastSuccess: null },
      now,
    );
    expect(health.tone).toBe('bad');
    expect(health.detail).toBe('Reconnect Drive.');
  });
});

describe('HouseBackupScreen — the archive list', () => {
  it('names a dated archive by when it was sealed, and a replace-mode one by its mtime', () => {
    // Locale-agnostic: the assertion is that the SEALING MOMENT is what the row
    // says, not the file name — the exact date order is the platform's call.
    const dated = formatBackupEntryLabel(ARCHIVE);
    expect(dated).toMatch(/2026/);
    expect(dated).toMatch(/09:15/);
    expect(dated).not.toMatch(/symply-house/);
    expect(
      formatBackupEntryLabel({
        fileName: 'symply-house-backup-maple-street--hh-maple.json',
        modifiedAt: '2026-08-11T09:15:00.000Z',
      }),
    ).toMatch(/^Latest backup · /);
  });

  it('says WHY the list is empty when the backups went somewhere else', async () => {
    mockGetLastEvent.mockResolvedValue({
      at: '2026-08-19T12:00:00.000Z',
      destination: 'google-drive',
      kind: 'scheduled',
      fileName: 'x.json',
    });
    const tree = await renderScreen();
    expect(textOf(tree, 'house-backup-empty-message')).toMatch(/went to Google Drive/);
  });

  it('opens the phrase panel when an archive row is tapped', async () => {
    mockListLocal.mockResolvedValue([ARCHIVE]);
    mockReadLocal.mockResolvedValue(
      JSON.stringify({ meta: { householdId: 'hh-maple', createdAt: '2026-08-11T09:15:00.000Z' } }),
    );
    const tree = await renderScreen();

    expect(query(tree, 'house-backup-restore-phrase-panel')).toBeNull();
    await press(tree, `house-backup-entry-${ARCHIVE.fileName}`);

    expect(mockReadLocal).toHaveBeenCalledWith(ARCHIVE.fileName);
    expect(query(tree, 'house-backup-restore-phrase-panel')).toBeTruthy();
    // Same home, so no foreign-archive gate.
    expect(query(tree, 'house-backup-restore-foreign-warning')).toBeNull();
  });

  it('asks before deleting an archive', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockListLocal.mockResolvedValue([ARCHIVE]);
    const tree = await renderScreen();

    await press(tree, `house-backup-delete-${ARCHIVE.fileName}`);

    expect(mockDeleteLocal).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'Delete backup',
      expect.stringMatching(/Delete the backup from/),
      expect.any(Array),
    );
    alert.mockRestore();
  });
});

describe('HouseBackupScreen — restoring another home needs an explicit yes', () => {
  const FOREIGN = JSON.stringify({
    meta: { householdId: 'hh-cabin', createdAt: '2026-08-11T09:15:00.000Z' },
  });

  /**
   * The member has narrowed to Maple Street and then picked the CABIN's file.
   *
   * Narrowing is what makes this foreign: under the default "All homes"
   * selection the same file is not a mis-tap at all — it names the home its rows
   * belong to, so the screen routes it there instead of asking. The gate exists
   * for the case where the member said "put it in THIS home" and the file
   * disagrees.
   */
  async function pickForeignArchive() {
    mockPickArchive.mockResolvedValue({
      status: 'needs_phrase',
      archiveJson: FOREIGN,
      householdHint: 'hh-cabin',
      propertyName: 'Lake Cabin',
      coversAllHomes: false,
      createdAtHint: '2026-08-11T09:15:00.000Z',
    });
    mockClipboardGet.mockResolvedValue(PHRASE);
    const tree = await renderScreen();
    await act(async () => {
      find(tree, 'house-backup-property-hh-maple').props.onPress();
    });
    await flush();
    await press(tree, 'house-backup-restore-files');
    return tree;
  }

  it('warns, and refuses to start, until the member confirms', async () => {
    const tree = await pickForeignArchive();

    expect(query(tree, 'house-backup-restore-foreign-warning')).toBeTruthy();
    expect(textOf(tree, 'house-backup-restore-foreign-message')).toMatch(
      /made for Lake Cabin.*restoring into Maple Street/s,
    );
    expect(find(tree, 'house-backup-restore-confirm').props.disabled).toBe(true);

    await press(tree, 'house-backup-restore-confirm');
    expect(mockStartRestore).not.toHaveBeenCalled();
  });

  it('starts once confirmed, and says which home it is replacing into', async () => {
    const tree = await pickForeignArchive();
    await press(tree, 'house-backup-restore-foreign-confirm');
    await press(tree, 'house-backup-restore-confirm');

    expect(mockStartRestore).toHaveBeenCalledWith(FOREIGN, PHRASE, {
      householdId: 'hh-maple',
      allowHouseholdReplace: true,
    });
  });

  it('does not ask for a confirmation when the archive is this home’s own', async () => {
    mockPickArchive.mockResolvedValue({
      status: 'needs_phrase',
      archiveJson: '{"meta":{"householdId":"hh-maple"}}',
      householdHint: 'hh-maple',
      propertyName: 'Maple Street',
      createdAtHint: null,
    });
    mockClipboardGet.mockResolvedValue(PHRASE);
    const tree = await renderScreen();
    await press(tree, 'house-backup-restore-files');

    expect(query(tree, 'house-backup-restore-foreign-warning')).toBeNull();
    await press(tree, 'house-backup-restore-confirm');
    expect(mockStartRestore).toHaveBeenCalledWith('{"meta":{"householdId":"hh-maple"}}', PHRASE, {
      householdId: 'hh-maple',
      allowHouseholdReplace: false,
    });
  });

  /**
   * "All homes" is a request about where things BELONG, not about the active
   * property. A per-home file picked under it goes to the home it names —
   * refusing because the open property happens to be a different one would be
   * pedantry over a request that was never ambiguous.
   */
  it('routes a single-home file to its own home under the all-homes selection', async () => {
    mockPickArchive.mockResolvedValue({
      status: 'needs_phrase',
      archiveJson: FOREIGN,
      householdHint: 'hh-cabin',
      propertyName: 'Lake Cabin',
      coversAllHomes: false,
      createdAtHint: null,
    });
    mockClipboardGet.mockResolvedValue(PHRASE);
    const tree = await renderScreen();
    await press(tree, 'house-backup-restore-files');

    expect(query(tree, 'house-backup-restore-foreign-warning')).toBeNull();
    await press(tree, 'house-backup-restore-confirm');

    expect(mockStartRestore).toHaveBeenCalledWith(FOREIGN, PHRASE, {
      householdId: 'hh-cabin',
      allowHouseholdReplace: false,
    });
  });
});

describe('HouseBackupScreen — restoring a file that holds every home', () => {
  const WHOLE_DEVICE = JSON.stringify({ meta: { householdId: 'all-homes' } });

  async function pickWholeDeviceArchive() {
    mockPickArchive.mockResolvedValue({
      status: 'needs_phrase',
      archiveJson: WHOLE_DEVICE,
      householdHint: 'all-homes',
      propertyName: 'All homes',
      coversAllHomes: true,
      createdAtHint: null,
    });
    mockClipboardGet.mockResolvedValue(PHRASE);
    const tree = await renderScreen();
    await press(tree, 'house-backup-restore-files');
    return tree;
  }

  it('says what is in the file before minutes of decryption are spent on it', async () => {
    const tree = await pickWholeDeviceArchive();

    expect(textOf(tree, 'house-backup-restore-all-homes-note')).toMatch(
      /holds every home.*Each one goes back into its own home here — nothing is mixed/s,
    );
    // It names the home it belongs to for every row it carries, so there is
    // nothing to rebind and nothing to confirm.
    expect(query(tree, 'house-backup-restore-foreign-warning')).toBeNull();
  });

  it('restores every home in it', async () => {
    const tree = await pickWholeDeviceArchive();
    await press(tree, 'house-backup-restore-confirm');

    expect(mockStartRestore).toHaveBeenCalledWith(WHOLE_DEVICE, PHRASE, {
      householdId: 'all-homes',
      allowHouseholdReplace: false,
    });
  });

  it('narrows to one home’s section when the member picked one home', async () => {
    const tree = await pickWholeDeviceArchive();
    await act(async () => {
      find(tree, 'house-backup-property-hh-cabin').props.onPress();
    });
    await flush();

    expect(textOf(tree, 'house-backup-restore-all-homes-note')).toMatch(
      /only that home's part of the file will be restored/,
    );
    await press(tree, 'house-backup-restore-confirm');
    expect(mockStartRestore).toHaveBeenCalledWith(WHOLE_DEVICE, PHRASE, {
      householdId: 'hh-cabin',
      allowHouseholdReplace: false,
    });
  });

  /**
   * The reason the per-home outcomes travel all the way to the screen: a home
   * that was skipped contributes no rows, so it is invisible in every number the
   * modal shows. Naming it is the only presentation that is not a lie.
   */
  it('names a home the file could not put back', async () => {
    restoreTask.pendingSummary = { ...SUMMARY, propertyName: 'All homes' };
    mockConsumeRestoreSummary.mockReturnValue({
      summary: { ...SUMMARY, propertyName: 'All homes' },
      households: [
        {
          householdId: 'hh-maple',
          propertyName: 'Maple Street',
          status: 'restored',
          message: 'ok',
          summary: SUMMARY,
        },
        {
          householdId: 'hh-cabin',
          propertyName: 'Lake Cabin',
          status: 'not_on_device',
          message: '“Lake Cabin” is not on this device. Join that home here, then restore again.',
        },
      ],
    });

    const tree = await renderScreen();

    expect(query(tree, 'house-backup-restore-home-hh-maple')).toBeTruthy();
    expect(query(tree, 'house-backup-restore-home-hh-cabin')).toBeTruthy();
    expect(textOf(tree, 'house-backup-restore-success-note')).toMatch(/is not on this device/);
  });
});

describe('HouseBackupScreen — the once-only phrase', () => {
  it('presents a phrase a run parked while the member was elsewhere', async () => {
    backupTask.pendingPhrase = { phrase: PHRASE, intro: 'Saved.', savedTo: null };
    mockConsumePhrase.mockReturnValue({ phrase: PHRASE, intro: 'Saved.', savedTo: null });

    const tree = await renderScreen();

    expect(mockConsumePhrase).toHaveBeenCalledTimes(1);
    expect(textOf(tree, 'house-recovery-phrase-value')).toBe(PHRASE);
  });

  it('says so rather than inventing one when no phrase is stored', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockGetAutoSettings.mockResolvedValue({ ...AUTO_OFF, enabled: true });
    mockGetAutoPhrase.mockResolvedValue(null);
    const tree = await renderScreen();

    await press(tree, 'house-backup-show-phrase');

    expect(alert).toHaveBeenCalledWith(
      'Recovery phrase',
      expect.stringMatching(/No stored phrase yet/),
    );
    alert.mockRestore();
  });
});

describe('HouseBackupScreen — what is in a backup', () => {
  it('reports the per-table counts and the total', async () => {
    const tree = await renderScreen();

    expect(textOf(tree, 'house-backup-summary-total')).toBe('20 rows');
    expect(query(tree, 'house-backup-summary-row-tasks')).toBeTruthy();
    expect(query(tree, 'house-backup-summary-row-utilities')).toBeTruthy();
    // Empty tables are dropped rather than padding the list with zeroes.
    expect(query(tree, 'house-backup-summary-row-appliances')).toBeNull();
  });

  it('states that attachment bytes are NOT in the file and what that costs', async () => {
    const tree = await renderScreen();

    expect(textOf(tree, 'house-backup-blob-count')).toBe('2 attachments listed, not included');
    const note = textOf(tree, 'house-backup-blob-note');
    expect(note).toMatch(/NOT inside the file/);
    expect(note).toMatch(/3\.8 MB/);
    expect(note).toMatch(/only works while the household still exists/i);
  });

  it('says so plainly when a home has no attachments at all', async () => {
    mockSummarizeProperty.mockResolvedValue({ ...SUMMARY, blobManifest: [] });
    const tree = await renderScreen();
    expect(textOf(tree, 'house-backup-blob-empty')).toMatch(/nothing to fetch back later/i);
  });

  it('does not invent counts for a home it could not open', async () => {
    mockSummarizeProperty.mockRejectedValue(new Error('not hydrated'));
    const tree = await renderScreen();
    expect(query(tree, 'house-backup-summary-unavailable')).toBeTruthy();
  });
});

describe('HouseBackupScreen — CSV export', () => {
  it('reports the row count when the export is shared', async () => {
    const tree = await renderScreen();
    await press(tree, 'house-export-csv');

    expect(mockExportCsv).toHaveBeenCalledTimes(1);
    expect(textOf(tree, 'house-export-message-shared')).toBe(
      'Your export is ready. (42 rows across this home.)',
    );
  });

  it('distinguishes "this device cannot share" from a failure', async () => {
    mockExportCsv.mockResolvedValue({
      status: 'unsupported',
      message: 'This device has no way to share files, so the export could not be handed over.',
      rows: 42,
    });
    const tree = await renderScreen();
    await press(tree, 'house-export-csv');

    expect(query(tree, 'house-export-message-unsupported')).toBeTruthy();
    expect(query(tree, 'house-export-message-failed')).toBeNull();
    expect(textOf(tree, 'house-export-message-unsupported')).toMatch(/42 rows were ready/);
  });

  it('renders member-facing copy when the export throws', async () => {
    mockExportCsv.mockRejectedValue(new Error('argon2 wasm module missing'));
    const tree = await renderScreen();
    await press(tree, 'house-export-csv');

    expect(textOf(tree, 'house-export-error-message')).toBe(
      'We could not put your export together just now. Try again in a moment.',
    );
    expect(query(tree, 'house-export-result')).toBeNull();
  });

  it('warns that the CSV follows the OPEN home, not the picked one', async () => {
    const tree = await renderScreen();
    await act(async () => {
      find(tree, 'house-backup-property-hh-maple').props.onPress();
    });
    await flush();
    expect(textOf(tree, 'house-export-note')).toBe('Covers Maple Street — the home you have open.');

    await act(async () => {
      find(tree, 'house-backup-property-hh-cabin').props.onPress();
    });
    await flush();

    expect(textOf(tree, 'house-export-note')).toMatch(
      /always covers the home you have open \(Maple Street\), not the one picked above/,
    );
  });

  /**
   * A backup can cover every home; a CSV cannot. Reusing the "switch homes
   * first" sentence under an "All homes" selection would be advice nobody can
   * follow — there is no home to switch to that produces one.
   */
  it('says plainly that there is no all-homes CSV', async () => {
    const tree = await renderScreen();
    expect(textOf(tree, 'house-export-note')).toMatch(
      /covers one home at a time — the one you have open \(Maple Street\)/,
    );
  });
});
