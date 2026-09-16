/* eslint-disable @typescript-eslint/no-require-imports -- Jest mock factories load native stubs after hoisting. */
/**
 * CloudFilePicker — focused on the folder-memory behaviour that differs per
 * surface:
 *   • autoRemember (utility bills): the folder a file is attached from is saved
 *     automatically on attach, so the picker re-opens there. Skipped at the
 *     root. A "Change" affordance forgets it.
 *   • default (reports / budget / savings): nothing is saved unless the user
 *     taps the manual "Remember this folder" pin.
 *
 * The real component is rendered; only leaf UI kit / native bindings are stubbed
 * so the storage side-effects (storageHelpers.setObject/delete) are genuine.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LinearGradient: ({ children }: StubProps) => React.createElement(View, null, children) };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@navigation/presentation', () => ({
  useNativeModalPresentation: () => 'formSheet',
}));

// Lightweight UI-kit stubs: Typography → Text, GradientButton → a tappable that
// exposes a stable testID for the multi-select attach action, GoogleIcon → null.
jest.mock('@components/ui', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    GoogleIcon: () => null,
    Typography: ({ children }: StubProps) => React.createElement(Text, null, children),
    GradientButton: ({ title, onPress, disabled }: StubProps) =>
      React.createElement(
        TouchableOpacity,
        {
          testID:
            typeof title === 'string' && title.startsWith('Attach')
              ? 'cloud-picker-attach'
              : 'cloud-picker-gradient',
          onPress,
          disabled,
        },
        React.createElement(Text, null, title)
      ),
  };
});

const mockService = {
  isAuthenticated: jest.fn(),
  authenticate: jest.fn(),
  logout: jest.fn(),
  getAuthState: jest.fn(),
  listFiles: jest.fn(),
  downloadFile: jest.fn(),
};
// Wrap each method so the factory reads `mockService` lazily at call time —
// ES `import` is hoisted above the `const`, so a direct capture would grab it
// while still undefined.
jest.mock('@services/cloud-storage', () => {
  // Use the real error class so the picker's `instanceof CloudReauthRequiredError`
  // branch (drop back to Connect vs. show a Retry screen) is exercised faithfully.
  const { CloudReauthRequiredError } = jest.requireActual('@services/cloud-storage/types');
  const svc = {
    isAuthenticated: (...a: unknown[]) => mockService.isAuthenticated(...a),
    authenticate: (...a: unknown[]) => mockService.authenticate(...a),
    logout: (...a: unknown[]) => mockService.logout(...a),
    getAuthState: (...a: unknown[]) => mockService.getAuthState(...a),
    listFiles: (...a: unknown[]) => mockService.listFiles(...a),
    downloadFile: (...a: unknown[]) => mockService.downloadFile(...a),
  };
  return { __esModule: true, googleDriveService: svc, dropboxService: svc, CloudReauthRequiredError };
});

const mockStorage = {
  getObject: jest.fn(),
  setObject: jest.fn(),
  delete: jest.fn(),
};
jest.mock('@services/storage', () => ({
  __esModule: true,
  storageHelpers: {
    getObject: (...a: unknown[]) => mockStorage.getObject(...a),
    setObject: (...a: unknown[]) => mockStorage.setObject(...a),
    delete: (...a: unknown[]) => mockStorage.delete(...a),
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { CloudReauthRequiredError } from '@services/cloud-storage';

import { fixture, pickerAsset } from '../../../test-utils/fixtures';
import { CloudFilePicker } from '../CloudFilePicker';

// Real utility bill PDF from resourses/testing — fits the 'utilities' remember scope.
const BILL = fixture('house-utility-bc-hydro'); // bc-hydro-bill.pdf
const BILL_SIZE = pickerAsset('house-utility-bc-hydro').size;

/** Minimal prop shape for the stubbed UI-kit leaf components. */
type StubProps = {
  children?: React.ReactNode;
  title?: string;
  onPress?: () => void;
  disabled?: boolean;
};

const KEY = 'cloud_picker_folder:google-drive:utilities';
const FOLDER = { id: 'folder1', name: 'Bills', mimeType: 'application/vnd.google-apps.folder', size: 0 };
// Drive listing entry + its downloaded form, backed by the real bc-hydro-bill.pdf.
const PDF = { id: 'pdf1', name: BILL.name, mimeType: BILL.mime, size: BILL_SIZE };
const DOWNLOADED = { uri: BILL.uri, name: BILL.name, size: BILL_SIZE };
// The breadcrumb trail we expect to be persisted once inside "Bills".
const SAVED_PATH = [{ id: 'folder1', name: 'Bills' }];

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

type Tree = ReactTestRenderer.ReactTestRenderer;

async function mount(
  props: Partial<React.ComponentProps<typeof CloudFilePicker>> = {}
): Promise<Tree> {
  let tree!: Tree;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <CloudFilePicker
          visible
          provider="google-drive"
          onFileSelected={jest.fn()}
          onClose={jest.fn()}
          {...props}
        />
      </ThemeProvider>
    );
    await flush();
  });
  return tree;
}

/** Fire the onPress of the composite node carrying the given testID. */
async function tap(tree: Tree, testID: string): Promise<void> {
  await act(async () => {
    const nodes = tree.root.findAllByProps({ testID });
    const node = nodes.find((n) => typeof n.props.onPress === 'function') ?? nodes[0];
    node.props.onPress();
    await flush();
  });
}

function exists(tree: Tree, testID: string): boolean {
  return tree.root.findAllByProps({ testID }).length > 0;
}

/** All rendered text, concatenated — for asserting friendly copy / no raw leaks. */
function allText(tree: Tree): string {
  return tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string)
    .join(' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockService.isAuthenticated.mockResolvedValue(true);
  mockService.getAuthState.mockResolvedValue({ userEmail: 'a@b.com', userName: 'A' });
  mockService.downloadFile.mockResolvedValue(DOWNLOADED);
  // Root shows the "Bills" folder; inside it lives one PDF.
  mockService.listFiles.mockImplementation(async (folderId?: string) => {
    if (!folderId) return [FOLDER];
    if (folderId === 'folder1') return [PDF];
    return [];
  });
  mockStorage.getObject.mockResolvedValue(null);
  mockStorage.setObject.mockResolvedValue(undefined);
  mockStorage.delete.mockResolvedValue(undefined);
});

describe('CloudFilePicker — autoRemember', () => {
  it('saves the folder a file was attached from (single-select)', async () => {
    const onFileSelected = jest.fn();
    const onClose = jest.fn();
    const tree = await mount({
      autoRemember: true,
      rememberScope: 'utilities',
      onFileSelected,
      onClose,
    });

    await tap(tree, 'cloud-picker-item-folder1'); // navigate into Bills
    await tap(tree, 'cloud-picker-item-pdf1'); // attach the PDF

    expect(mockService.downloadFile).toHaveBeenCalledWith('pdf1');
    expect(mockStorage.setObject).toHaveBeenCalledWith(KEY, SAVED_PATH);
    expect(onFileSelected).toHaveBeenCalledWith(DOWNLOADED);
    expect(onClose).toHaveBeenCalled();
  });

  it('saves the folder on a multi-select attach', async () => {
    const onFilesSelected = jest.fn();
    const onClose = jest.fn();
    const tree = await mount({
      autoRemember: true,
      multiSelect: true,
      rememberScope: 'utilities',
      onFilesSelected,
      onClose,
    });

    await tap(tree, 'cloud-picker-item-folder1'); // navigate into Bills
    await tap(tree, 'cloud-picker-item-pdf1'); // tick the PDF (no download yet)
    expect(mockService.downloadFile).not.toHaveBeenCalled();

    await tap(tree, 'cloud-picker-attach'); // download + attach the batch

    expect(mockStorage.setObject).toHaveBeenCalledWith(KEY, SAVED_PATH);
    expect(onFilesSelected).toHaveBeenCalledWith([DOWNLOADED]);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not save when attaching from the root folder', async () => {
    // Root itself contains a PDF for this case.
    mockService.listFiles.mockResolvedValueOnce([PDF]);
    const tree = await mount({
      autoRemember: true,
      rememberScope: 'utilities',
      onFileSelected: jest.fn(),
      onClose: jest.fn(),
    });

    await tap(tree, 'cloud-picker-item-pdf1');

    expect(mockService.downloadFile).toHaveBeenCalledWith('pdf1');
    expect(mockStorage.setObject).not.toHaveBeenCalled();
  });

  it('re-opens inside the saved folder and can forget it via "Change"', async () => {
    mockStorage.getObject.mockResolvedValue(SAVED_PATH);
    const tree = await mount({
      autoRemember: true,
      rememberScope: 'utilities',
      onFileSelected: jest.fn(),
      onClose: jest.fn(),
    });

    // Opened straight into the saved folder → the auto-remember "Change" pill is shown.
    expect(exists(tree, 'cloud-picker-remember-change')).toBe(true);
    // The manual pin is never shown in auto mode.
    expect(exists(tree, 'cloud-picker-remember-toggle')).toBe(false);

    await tap(tree, 'cloud-picker-remember-change');

    expect(mockStorage.delete).toHaveBeenCalledWith(KEY);
    // Dropped back to the root listing (folderId is undefined on the last call).
    expect(mockService.listFiles.mock.calls.at(-1)?.[0]).toBeUndefined();
  });
});

describe('CloudFilePicker — default (manual) remember', () => {
  it('does not auto-save on attach without autoRemember', async () => {
    const tree = await mount({
      rememberScope: 'reports',
      onFileSelected: jest.fn(),
      onClose: jest.fn(),
    });

    await tap(tree, 'cloud-picker-item-folder1');
    await tap(tree, 'cloud-picker-item-pdf1');

    expect(mockService.downloadFile).toHaveBeenCalledWith('pdf1');
    expect(mockStorage.setObject).not.toHaveBeenCalled();
  });

  it('shows the manual pin (not the auto "Change") and saves on tap', async () => {
    const tree = await mount({
      rememberScope: 'reports',
      onFileSelected: jest.fn(),
      onClose: jest.fn(),
    });

    await tap(tree, 'cloud-picker-item-folder1');

    expect(exists(tree, 'cloud-picker-remember-toggle')).toBe(true);
    expect(exists(tree, 'cloud-picker-remember-change')).toBe(false);

    await tap(tree, 'cloud-picker-remember-toggle');

    expect(mockStorage.setObject).toHaveBeenCalledWith(
      'cloud_picker_folder:google-drive:reports',
      SAVED_PATH
    );
  });
});

describe('CloudFilePicker — error handling (no raw leaks)', () => {
  // The exact Google 403 body from the bug report — must never reach the UI.
  const RAW_SCOPE_JSON =
    'Failed to list files: {"error":{"code":403,"message":"Request had insufficient authentication scopes.","status":"PERMISSION_DENIED","reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}}';

  it('drops back to the Connect screen with friendly copy when the grant needs re-auth', async () => {
    mockService.listFiles.mockRejectedValue(
      new CloudReauthRequiredError('Your Google Drive access needs to be renewed. Please reconnect.')
    );

    const tree = await mount({ onFileSelected: jest.fn(), onClose: jest.fn() });

    // Back on the auth screen (Connect button present, no file rows).
    expect(exists(tree, 'cloud-picker-gradient')).toBe(true);
    expect(exists(tree, 'cloud-picker-item-folder1')).toBe(false);

    const text = allText(tree);
    expect(text).toContain('reconnect');
    expect(text).not.toContain('ACCESS_TOKEN_SCOPE_INSUFFICIENT');
    expect(text).not.toContain('403');
  });

  it('shows generic copy (never the raw provider JSON) on an unknown list failure', async () => {
    mockService.listFiles.mockRejectedValue(new Error(RAW_SCOPE_JSON));

    const tree = await mount({ onFileSelected: jest.fn(), onClose: jest.fn() });

    const text = allText(tree);
    expect(text).toContain("Couldn't load your Google Drive files");
    // The raw payload is fully suppressed.
    expect(text).not.toContain('insufficient authentication scopes');
    expect(text).not.toContain('PERMISSION_DENIED');
    expect(text).not.toContain('{');
  });
});
