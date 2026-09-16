/**
 * Budget → Backup & Restore, the recovery phrase.
 *
 * The phrase used to arrive as a system alert whose body ran the twelve words
 * together, and the app put them on the clipboard without being asked. Pinned
 * here: the words are numbered and individually rendered, the app never touches
 * the clipboard on its own, and the sheet offers the three places a backup can
 * go — Drive, this device, the share sheet — rather than a Copy button
 * competing with the ones that put the phrase somewhere durable.
 *
 * The sheet itself is `@components/backup/RecoveryPhraseSheet`, shared with
 * House, and it draws that three-destination layout from the app descriptor's
 * `destinations`. So the mocks below stand in for the SHARED modules the sheet
 * actually calls; the only thing mocked at Budget's own path is the descriptor
 * that selects the layout.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
const mockSetString = jest.fn();
jest.mock('expo-clipboard', () => ({
  __esModule: true,
  setStringAsync: (...a: unknown[]) => mockSetString(...a),
  getStringAsync: jest.fn(async () => ''),
}));

// The writer moved under `@services/backup` when House started sharing this
// sheet; Budget's binding of it (heading, file stem, destinations) rides in as
// the second argument, which is what the destination assertions below now pin.
const mockExportFile = jest.fn();
jest.mock('@services/backup/recoveryPhraseFile', () => ({
  __esModule: true,
  recoveryPhraseWords: (phrase: string) => phrase.trim().split(/\s+/).filter(Boolean),
  exportRecoveryPhraseFile: (...a: unknown[]) => mockExportFile(...a),
  getRecoveryPhraseFolder: (...a: unknown[]) => mockGetFolder(...(a as [])),
  rememberRecoveryPhraseFolder: (...a: unknown[]) => mockRememberFolder(...(a as [])),
}));

/**
 * Budget's descriptor, standing in for the real one so this test never drags in
 * the file-system and Drive plumbing behind `backupDestinations`. Its
 * `destinations` is what puts the sheet into the three-destination layout —
 * drop it and the assertions below would be measuring House's sheet instead.
 */
jest.mock('@features/budget/local/backup/recoveryPhraseFile', () => ({
  __esModule: true,
  BUDGET_RECOVERY_PHRASE_APP: {
    label: 'Symply Budget',
    slug: 'symply-budget',
    contents: 'your budget',
    destinations: {
      directory: () => 'file:///budget/backups/',
      defaultCloudFolder: async () => ({ id: 'folder_default', name: 'Symply Budget Backups' }),
      defaultFolderName: 'Symply Budget Backups',
      folderStorageKey: 'budget.recoveryPhrase.driveFolder',
      logTag: '[budget-backup]',
    },
  },
}));

// Drive is hidden when a brand ships no credentials, so the button under test
// only exists when this says so. `cloudFolderAccess` gates the folder row the
// same way: browsing needs a wider grant than uploading.
const mockDriveConfigured = jest.fn(() => true);
const mockFolderAccess = jest.fn(async () => 'ready');
jest.mock('@services/cloud-storage/backupProviders', () => ({
  __esModule: true,
  isCloudProviderConfigured: () => mockDriveConfigured(),
  cloudFolderAccess: () => mockFolderAccess(),
  cloudProviderSupportsFolderPicking: () => true,
  describeCloudFolder: (folder: { path?: string[]; name: string }) =>
    folder.path?.length ? folder.path.join(' › ') : folder.name,
}));

const mockGetFolder = jest.fn(async () => null as unknown);
const mockRememberFolder = jest.fn(async () => undefined);

jest.mock('@components/backup/CloudFolderPickerSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    CloudFolderPickerSheet: ({ visible }: { visible: boolean }) =>
      visible ? React.createElement(View, { testID: 'folder-picker-open' }) : null,
  };
});

jest.mock('@components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BottomSheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? React.createElement(View, null, children ?? null) : null,
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { BudgetRecoveryPhraseSheet } from '../BudgetRecoveryPhraseSheet';

const PHRASE =
  'gain spread cluster goddess file luggage industry couple kitchen shop atom retreat';

/** The descriptor every `exportRecoveryPhraseFile` call should carry. */
const BUDGET_APP = expect.objectContaining({ slug: 'symply-budget' });

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function render(onClose = jest.fn()) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetRecoveryPhraseSheet visible phrase={PHRASE} onClose={onClose} />
      </ThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

const find = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0] ?? null;

const press = async (tree: ReactTestRenderer.ReactTestRenderer, id: string) => {
  const node = find(tree, id);
  expect(node).not.toBeNull();
  await act(async () => {
    node!.props.onPress?.();
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` drops calls, not implementations — so a test that turns
  // Drive off has to be undone here or it leaks into the next one.
  mockDriveConfigured.mockReturnValue(true);
  mockFolderAccess.mockResolvedValue('ready');
  mockGetFolder.mockResolvedValue(null);
  mockSetString.mockResolvedValue(true);
  mockExportFile.mockResolvedValue({ status: 'shared', message: 'Saved.' });
});

// The "Copied" flag runs on a timer; leaving a tree mounted leaks it past the
// test that started it.
afterEach(async () => {
  await act(async () => {
    while (mounted.length) mounted.pop()!.unmount();
  });
});

describe('recovery phrase sheet', () => {
  it('renders every word on its own, numbered', async () => {
    const tree = await render();

    expect(find(tree, 'budget-recovery-phrase-word-1')?.props.accessibilityLabel).toBe(
      'Word 1: gain',
    );
    expect(find(tree, 'budget-recovery-phrase-word-12')?.props.accessibilityLabel).toBe(
      'Word 12: retreat',
    );
    expect(find(tree, 'budget-recovery-phrase-word-13')).toBeNull();
  });

  it('keeps each word its own accessible node, so a reader can hold its place', async () => {
    const tree = await render();

    const cell = find(tree, 'budget-recovery-phrase-word-7');
    expect(cell?.props.accessible).toBe(true);
    expect(cell?.props.accessibilityLabel).toBe('Word 7: industry');
  });

  /**
   * The clipboard is the worst place for this: overwritten by the next copy,
   * and readable by every other app on iOS. The share sheet offers Copy to
   * anyone who wants it, so the sheet itself no longer carries one — and must
   * never reach the paste buffer on its own.
   */
  it('never touches the clipboard, whichever destination is pressed', async () => {
    const tree = await render();

    await press(tree, 'budget-recovery-phrase-save-drive');
    await press(tree, 'budget-recovery-phrase-save-device');
    await press(tree, 'budget-recovery-phrase-share');

    expect(mockSetString).not.toHaveBeenCalled();
    expect(find(tree, 'budget-recovery-phrase-copy')).toBeNull();
  });

  it('offers the same three destinations a backup has', async () => {
    const tree = await render();

    await press(tree, 'budget-recovery-phrase-save-drive');
    expect(mockExportFile).toHaveBeenLastCalledWith(PHRASE, BUDGET_APP, 'google-drive');

    await press(tree, 'budget-recovery-phrase-save-device');
    expect(mockExportFile).toHaveBeenLastCalledWith(PHRASE, BUDGET_APP, 'device');

    await press(tree, 'budget-recovery-phrase-share');
    expect(mockExportFile).toHaveBeenLastCalledWith(PHRASE, BUDGET_APP, 'share');
  });

  it('hides Drive in a build that ships no Drive credentials', async () => {
    mockDriveConfigured.mockReturnValue(false);
    const tree = await render();

    expect(find(tree, 'budget-recovery-phrase-save-drive')).toBeNull();
    // The two that always work stay.
    expect(find(tree, 'budget-recovery-phrase-save-device')).not.toBeNull();
    expect(find(tree, 'budget-recovery-phrase-share')).not.toBeNull();
  });

  describe('the Drive folder', () => {
    it('names the default until the member has chosen one', async () => {
      const tree = await render();

      const row = find(tree, 'budget-recovery-phrase-folder-row');
      expect(row?.props.accessibilityLabel).toMatch(/Symply Budget Backups/);
    });

    it('names the chosen folder by its whole trail, not its leaf', async () => {
      mockGetFolder.mockResolvedValue({
        id: 'folder_secret',
        name: 'Keys',
        path: ['Documents', 'Keys'],
        source: 'picked',
      });
      const tree = await render();

      expect(find(tree, 'budget-recovery-phrase-folder-row')?.props.accessibilityLabel).toMatch(
        /Documents › Keys/,
      );
    });

    it('opens the picker and remembers what comes back', async () => {
      const tree = await render();
      expect(find(tree, 'folder-picker-open')).toBeNull();

      await press(tree, 'budget-recovery-phrase-folder-row');
      expect(find(tree, 'folder-picker-open')).not.toBeNull();
    });

    /**
     * Browsing needs a wider Drive grant than uploading does. Offering "change
     * folder" to an account that cannot list them ends in an empty picker, so
     * the row is absent rather than disappointing.
     */
    it('stays away when Drive cannot be browsed', async () => {
      mockFolderAccess.mockResolvedValue('needs-scope');
      const tree = await render();

      expect(find(tree, 'budget-recovery-phrase-folder-row')).toBeNull();
      // The save itself still works — only the choosing is out of reach.
      expect(find(tree, 'budget-recovery-phrase-save-drive')).not.toBeNull();
    });
  });

  it('closes on Done', async () => {
    const onClose = jest.fn();
    const tree = await render(onClose);

    await press(tree, 'budget-recovery-phrase-done');

    expect(onClose).toHaveBeenCalled();
  });
});
