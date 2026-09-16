/**
 * Symply Health — Files tab (`HealthFilesScreen.tsx`).
 *
 * Renders the REAL screen through <ThemeProvider> and drives its primary
 * paths: loading → list → filter/search → upload (camera / gallery / file) →
 * delete-with-confirm → empty / error states. Only the storage-backed async
 * functions (`loadFiles`, `uploadHealthFile`, `deleteHealthFile`) and
 * `healthFileContentSource` are mocked; the pure helpers stay real (they own
 * their coverage in `../../__tests__/healthFilesStorage.test.ts`), so what is
 * asserted here is the SCREEN's use of them.
 *
 * This is one of the two client modules `files.posture.test.ts`
 * (HEALTH-ASSET-095) requires a test for — until this file existed, the
 * screen that uploads, lists and deletes a member's `body_photo` files had no
 * client-side test anywhere in the repo.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  deleteHealthFile,
  loadFiles,
  uploadHealthFile,
  type HealthFileEntry,
  type HealthFileWriteResult,
} from '../../healthFilesStorage';
import { HealthFilesScreen } from '../HealthFilesScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Pressable } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    ProcessingOverlay: ({ visible, message, testID }: { visible?: boolean; message?: string; testID?: string }) =>
      visible
        ? ReactMock.createElement(View, {
            testID: testID ?? 'health-files-overlay',
            accessibilityLabel: message,
          })
        : null,
    ScanImportSources: (props: Record<string, unknown>) =>
      ReactMock.createElement(
        View,
        { testID: `${props.testIDPrefix}-sources` },
        ...(['camera', 'gallery', 'file', 'drive'] as const).map((key) =>
          ReactMock.createElement(Pressable, {
            key,
            testID: `${props.testIDPrefix}-${key}`,
            disabled: props.disabled,
            onPress: props[`on${key[0].toUpperCase()}${key.slice(1)}`],
          })
        )
      ),
  };
});

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: { openCamera: jest.fn(), openPicker: jest.fn() },
}));
jest.mock('expo-file-system/legacy', () => ({
  downloadAsync: jest.fn(),
  cacheDirectory: 'file:///cache/',
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

// `HEALTH_FILE_MAX_BYTES` / `HEALTH_FILE_MIME_TYPES` are plain constants the
// REAL `healthFilesStorage.ts` reads at module-eval time (its pure helpers,
// which this suite keeps real, depend on them) — only `healthFileContentSource`
// is replaced, so those constants stay intact.
jest.mock('@api/healthAssets', () => {
  const actual = jest.requireActual('@api/healthAssets');
  return { ...actual, healthFileContentSource: jest.fn() };
});

jest.mock('../../healthFilesStorage', () => {
  const actual = jest.requireActual('../../healthFilesStorage');
  return {
    ...actual,
    loadFiles: jest.fn(),
    uploadHealthFile: jest.fn(),
    deleteHealthFile: jest.fn(),
  };
});

const mockLoadFiles = loadFiles as jest.Mock;
const mockUploadHealthFile = uploadHealthFile as jest.Mock;
const mockDeleteHealthFile = deleteHealthFile as jest.Mock;

const ImageCropPicker = jest.requireMock('@services/image-picker-compat').default as {
  openCamera: jest.Mock;
  openPicker: jest.Mock;
};
const DocumentPicker = jest.requireMock('expo-document-picker') as { getDocumentAsync: jest.Mock };
const FileSystem = jest.requireMock('expo-file-system/legacy') as { downloadAsync: jest.Mock };
const Sharing = jest.requireMock('expo-sharing') as { isAvailableAsync: jest.Mock; shareAsync: jest.Mock };
const mockContentSource = jest.requireMock('@api/healthAssets').healthFileContentSource as jest.Mock;

const ISO = '2026-07-13T08:00:00.000Z';

function file(over: Partial<HealthFileEntry> = {}): HealthFileEntry {
  return {
    id: 'file_1',
    name: 'photo.jpg',
    type: 'photo',
    mimeType: 'image/jpeg',
    sizeBytes: 2048,
    category: null,
    createdAt: ISO,
    updatedAt: ISO,
    contentPath: '/health/files/file_1/content',
    isImage: true,
    ...over,
  };
}

function saved(files: HealthFileEntry[]): HealthFileWriteResult {
  return { files, status: 'saved', message: null };
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  act(() => node.props.onPress());
}

function input(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
}

function type(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  act(() => input(tree, testID).props.onChangeText(text));
}

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

/** A `never-resolving` promise, for asserting the LOADING state precisely. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadFiles.mockResolvedValue([]);
  mockUploadHealthFile.mockResolvedValue(saved([]));
  mockDeleteHealthFile.mockResolvedValue(saved([]));
  mockContentSource.mockReturnValue({ uri: 'https://api.test/health/files/file_1/content', headers: {} });
  Sharing.isAvailableAsync.mockResolvedValue(true);
  Sharing.shareAsync.mockResolvedValue(undefined);
  FileSystem.downloadAsync.mockResolvedValue({ uri: 'file:///cache/health-file-x.jpg' });
});

/* ------------------------------------------------------------------ */
/* Loading, empty, list                                                 */
/* ------------------------------------------------------------------ */

describe('HealthFilesScreen — loading, empty and list states', () => {
  it('HEALTH-FILES-SCR-001: while the list is in flight, the loading state shows and nothing else renders', async () => {
    mockLoadFiles.mockReturnValue(pending<HealthFileEntry[]>());
    const tree = await render(<HealthFilesScreen />);

    expect(byTestId(tree, 'health-files-list').length).toBe(0);
    expect(byTestId(tree, 'health-files-add').length).toBe(0);
    expect(byTestId(tree, 'health-files-summary').length).toBe(0);
  });

  it('HEALTH-FILES-SCR-002: an empty account says so, and names the promise of privacy', async () => {
    mockLoadFiles.mockResolvedValue([]);
    const tree = await render(<HealthFilesScreen />);

    expect(allText(byTestId(tree, 'health-files-empty')[0])).toBe(
      'No files yet. Anything you add here stays private to your account.'
    );
    expect(allText(byTestId(tree, 'health-files-summary')[0])).toContain('Nothing stored yet.');
  });

  it('HEALTH-FILES-SCR-003: a populated list renders every row with its type, size and day', async () => {
    mockLoadFiles.mockResolvedValue([
      file({ id: 'f1', name: 'Sunset.jpg', type: 'photo', sizeBytes: 2048 }),
      file({ id: 'f2', name: 'Bloodwork.pdf', type: 'document', mimeType: 'application/pdf', isImage: false, sizeBytes: 500 }),
      file({ id: 'f3', name: 'Progress.jpg', type: 'body_photo' }),
    ]);
    const tree = await render(<HealthFilesScreen />);

    expect(byTestId(tree, 'health-file-f1').length).toBe(1);
    expect(byTestId(tree, 'health-file-f2').length).toBe(1);
    expect(byTestId(tree, 'health-file-f3').length).toBe(1);
    expect(allText(byTestId(tree, 'health-file-f2')[0])).toContain('Document');
    expect(allText(byTestId(tree, 'health-file-f2')[0])).toContain('500 B');
    expect(allText(byTestId(tree, 'health-file-f2')[0])).toContain('2026-07-13');
    expect(allText(byTestId(tree, 'health-file-f3')[0])).toContain('Body photo');
    // The header counts what the list holds — no server quota is printed.
    expect(allText(byTestId(tree, 'health-files-summary')[0])).toContain('across 3 files');
  });

  it('HEALTH-FILES-SCR-004: the stat tiles fold body photos into "Photos" but keep documents separate', async () => {
    mockLoadFiles.mockResolvedValue([
      file({ id: 'f1', type: 'photo' }),
      file({ id: 'f2', type: 'body_photo' }),
      file({ id: 'f3', type: 'document' }),
    ]);
    const tree = await render(<HealthFilesScreen />);

    expect(byTestId(tree, 'health-files-stat-total')[0].props.accessibilityLabel).toBe('Files: 3');
    expect(byTestId(tree, 'health-files-stat-photos')[0].props.accessibilityLabel).toBe('Photos: 2');
    expect(byTestId(tree, 'health-files-stat-documents')[0].props.accessibilityLabel).toBe('Documents: 1');
  });
});

/* ------------------------------------------------------------------ */
/* Filter and search                                                    */
/* ------------------------------------------------------------------ */

describe('HealthFilesScreen — filter chips and search', () => {
  const stock = [
    file({ id: 'p1', name: 'Sunset.jpg', type: 'photo' }),
    file({ id: 'd1', name: 'Bloodwork.pdf', type: 'document', isImage: false }),
    file({ id: 'b1', name: 'Progress shot.jpg', type: 'body_photo' }),
  ];

  it('HEALTH-FILES-SCR-005: each filter chip narrows the list to its own type, and only one is selected', async () => {
    mockLoadFiles.mockResolvedValue(stock);
    const tree = await render(<HealthFilesScreen />);

    const selected = () =>
      ['all', 'photo', 'document', 'body_photo'].filter(
        (f) => byTestId(tree, `health-files-filter-${f}`)[0].props.accessibilityState.selected
      );
    expect(selected()).toEqual(['all']);

    press(tree, 'health-files-filter-document');
    expect(selected()).toEqual(['document']);
    expect(byTestId(tree, 'health-file-d1').length).toBe(1);
    expect(byTestId(tree, 'health-file-p1').length).toBe(0);

    press(tree, 'health-files-filter-body_photo');
    expect(selected()).toEqual(['body_photo']);
    expect(byTestId(tree, 'health-file-b1').length).toBe(1);
  });

  it('HEALTH-FILES-SCR-006: search narrows by name and reports its own empty copy', async () => {
    mockLoadFiles.mockResolvedValue(stock);
    const tree = await render(<HealthFilesScreen />);

    type(tree, 'health-files-search', 'progress');
    expect(byTestId(tree, 'health-file-b1').length).toBe(1);
    expect(byTestId(tree, 'health-file-p1').length).toBe(0);

    type(tree, 'health-files-search', 'zzzz-nothing');
    expect(allText(byTestId(tree, 'health-files-empty')[0])).toBe('Nothing matches that filter.');
  });
});

/* ------------------------------------------------------------------ */
/* Upload                                                               */
/* ------------------------------------------------------------------ */

describe('HealthFilesScreen — upload from camera, gallery and file', () => {
  it('HEALTH-FILES-SCR-007: camera capture uploads as a plain photo by default', async () => {
    ImageCropPicker.openCamera.mockResolvedValue({ path: 'file:///cam.jpg', filename: 'cam.jpg', mime: 'image/jpeg' });
    const tree = await render(<HealthFilesScreen />);

    await act(async () => press(tree, 'health-files-camera'));

    expect(ImageCropPicker.openCamera).toHaveBeenCalled();
    expect(mockUploadHealthFile).toHaveBeenCalledWith({
      uri: 'file:///cam.jpg',
      name: 'cam.jpg',
      mimeType: 'image/jpeg',
      fileType: 'photo',
    });
  });

  it('HEALTH-FILES-SCR-008: toggling "store as body photo" changes the upload intent for camera AND gallery', async () => {
    ImageCropPicker.openCamera.mockResolvedValue({ path: 'file:///cam.jpg', filename: 'cam.jpg', mime: 'image/jpeg' });
    ImageCropPicker.openPicker.mockResolvedValue({ path: 'file:///gal.jpg', filename: 'gal.jpg', mime: 'image/jpeg' });
    const tree = await render(<HealthFilesScreen />);

    expect(byTestId(tree, 'health-files-body-toggle')[0].props.accessibilityState).toEqual({ checked: false });
    press(tree, 'health-files-body-toggle');
    expect(byTestId(tree, 'health-files-body-toggle')[0].props.accessibilityState).toEqual({ checked: true });

    await act(async () => press(tree, 'health-files-camera'));
    expect(mockUploadHealthFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ fileType: 'body_photo' })
    );

    await act(async () => press(tree, 'health-files-gallery'));
    expect(mockUploadHealthFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ uri: 'file:///gal.jpg', fileType: 'body_photo' })
    );
  });

  it('HEALTH-FILES-SCR-009: the gallery picker may answer with an array — the first asset is used', async () => {
    ImageCropPicker.openPicker.mockResolvedValue([
      { path: 'file:///first.jpg', filename: 'first.jpg', mime: 'image/jpeg' },
      { path: 'file:///second.jpg', filename: 'second.jpg', mime: 'image/jpeg' },
    ]);
    const tree = await render(<HealthFilesScreen />);

    await act(async () => press(tree, 'health-files-gallery'));
    expect(mockUploadHealthFile).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///first.jpg' })
    );
  });

  it('HEALTH-FILES-SCR-010: a picked document uploads as a document regardless of the body-photo toggle', async () => {
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///scan.pdf', name: 'scan.pdf', mimeType: 'application/pdf' }],
    });
    const tree = await render(<HealthFilesScreen />);
    press(tree, 'health-files-body-toggle');

    await act(async () => press(tree, 'health-files-file'));
    expect(mockUploadHealthFile).toHaveBeenCalledWith({
      uri: 'file:///scan.pdf',
      name: 'scan.pdf',
      mimeType: 'application/pdf',
      fileType: 'document',
    });
  });

  it('HEALTH-FILES-SCR-011: a picked IMAGE from the file browser respects the body-photo toggle', async () => {
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///scan.jpg', name: 'scan.jpg', mimeType: 'image/jpeg' }],
    });
    const tree = await render(<HealthFilesScreen />);
    press(tree, 'health-files-body-toggle');

    await act(async () => press(tree, 'health-files-file'));
    expect(mockUploadHealthFile).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///scan.jpg', fileType: 'body_photo' })
    );
  });

  it('HEALTH-FILES-SCR-012: cancelling any picker uploads nothing and shows no message', async () => {
    ImageCropPicker.openCamera.mockRejectedValue({ code: 'E_PICKER_CANCELLED' });
    DocumentPicker.getDocumentAsync.mockResolvedValue({ canceled: true, assets: [] });
    const tree = await render(<HealthFilesScreen />);

    await act(async () => press(tree, 'health-files-camera'));
    await act(async () => press(tree, 'health-files-file'));

    expect(mockUploadHealthFile).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-files-message').length).toBe(0);
  });

  it('HEALTH-FILES-SCR-013: a real picker failure (not a cancel) shows its own friendly message', async () => {
    ImageCropPicker.openCamera.mockRejectedValue(new Error('camera hardware busy'));
    const tree = await render(<HealthFilesScreen />);

    await act(async () => press(tree, 'health-files-camera'));

    expect(allText(byTestId(tree, 'health-files-message')[0])).toBe('The camera could not be opened.');
    expect(mockUploadHealthFile).not.toHaveBeenCalled();
  });

  it('HEALTH-FILES-SCR-014: a successful upload applies the returned list and clears any prior message', async () => {
    mockLoadFiles.mockResolvedValue([]);
    ImageCropPicker.openCamera.mockResolvedValue({ path: 'file:///cam.jpg', filename: 'cam.jpg', mime: 'image/jpeg' });
    mockUploadHealthFile.mockResolvedValue(saved([file({ id: 'new', name: 'cam.jpg' })]));
    const tree = await render(<HealthFilesScreen />);

    await act(async () => press(tree, 'health-files-camera'));

    expect(byTestId(tree, 'health-file-new').length).toBe(1);
    expect(byTestId(tree, 'health-files-empty').length).toBe(0);
  });

  it('HEALTH-FILES-SCR-015: a REJECTED upload surfaces the store\'s own message — never a raw error', async () => {
    ImageCropPicker.openCamera.mockResolvedValue({ path: 'file:///cam.jpg', filename: 'cam.jpg', mime: 'image/jpeg' });
    mockUploadHealthFile.mockResolvedValue({
      files: [],
      status: 'rejected',
      message: 'That file is larger than 50 MB. Try a smaller one.',
    });
    const tree = await render(<HealthFilesScreen />);

    await act(async () => press(tree, 'health-files-camera'));

    expect(allText(byTestId(tree, 'health-files-message')[0])).toBe(
      'That file is larger than 50 MB. Try a smaller one.'
    );
  });

  it('HEALTH-FILES-SCR-016: the sources row is disabled and the overlay names the action while an upload is in flight', async () => {
    let resolveUpload!: (value: HealthFileWriteResult) => void;
    ImageCropPicker.openCamera.mockResolvedValue({ path: 'file:///cam.jpg', filename: 'cam.jpg', mime: 'image/jpeg' });
    mockUploadHealthFile.mockReturnValue(new Promise<HealthFileWriteResult>((resolve) => (resolveUpload = resolve)));
    const tree = await render(<HealthFilesScreen />);

    // `handleCamera` awaits `ImageCropPicker.openCamera()` before calling
    // `upload()` (which sets `busy`), so the press has to go through an ASYNC
    // `act` — a plain synchronous one (what the `press` helper uses) only
    // flushes effects, not that extra microtask hop.
    await act(async () => {
      tree.root
        .find((n) => n.props?.testID === 'health-files-camera' && typeof n.props?.onPress === 'function')
        .props.onPress();
    });

    expect(byTestId(tree, 'health-files-overlay')[0].props.accessibilityLabel).toBe('Uploading photo…');
    // `disabled` is a prop on the Pressable COMPONENT itself (composite, not a
    // host node), so this has to skip `byTestId`'s host-only filter.
    const cameraTile = tree.root.find(
      (n) => n.props?.testID === 'health-files-camera' && typeof n.props?.onPress === 'function'
    );
    expect(cameraTile.props.disabled).toBe(true);

    await act(async () => {
      resolveUpload(saved([]));
    });
    expect(byTestId(tree, 'health-files-overlay').length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Delete, with confirmation                                            */
/* ------------------------------------------------------------------ */

describe('HealthFilesScreen — delete with confirmation', () => {
  it('HEALTH-FILES-SCR-017: deleting asks first, names the file, and warns it cannot be undone', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadFiles.mockResolvedValue([file({ id: 'f1', name: 'Sunset.jpg' })]);
    const tree = await render(<HealthFilesScreen />);

    press(tree, 'health-file-delete-f1');

    expect(alertSpy.mock.calls[0][0]).toBe('Delete this file?');
    expect(alertSpy.mock.calls[0][1]).toBe('“Sunset.jpg” will be removed from your account. This cannot be undone.');
    expect(mockDeleteHealthFile).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('HEALTH-FILES-SCR-018: confirming Delete calls the store and applies the result', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadFiles.mockResolvedValue([file({ id: 'f1', name: 'Sunset.jpg' }), file({ id: 'f2', name: 'Other.jpg' })]);
    mockDeleteHealthFile.mockResolvedValue(saved([file({ id: 'f2', name: 'Other.jpg' })]));
    const tree = await render(<HealthFilesScreen />);

    press(tree, 'health-file-delete-f1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());

    expect(mockDeleteHealthFile).toHaveBeenCalledWith('f1');
    expect(byTestId(tree, 'health-file-f1').length).toBe(0);
    expect(byTestId(tree, 'health-file-f2').length).toBe(1);
    alertSpy.mockRestore();
  });

  it('HEALTH-FILES-SCR-019: cancelling the alert deletes nothing', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadFiles.mockResolvedValue([file({ id: 'f1', name: 'Sunset.jpg' })]);
    const tree = await render(<HealthFilesScreen />);

    press(tree, 'health-file-delete-f1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    const cancel = buttons.find((b) => b.text === 'Cancel');
    expect(cancel?.style).toBe('cancel');
    expect(cancel?.onPress).toBeUndefined();

    expect(mockDeleteHealthFile).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-file-f1').length).toBe(1);
    alertSpy.mockRestore();
  });

  it('HEALTH-FILES-SCR-020: removing the last file swaps the copy to the empty-account line', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadFiles.mockResolvedValue([file({ id: 'f1', name: 'Sunset.jpg' })]);
    mockDeleteHealthFile.mockResolvedValue(saved([]));
    const tree = await render(<HealthFilesScreen />);

    press(tree, 'health-file-delete-f1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());

    expect(allText(byTestId(tree, 'health-files-empty')[0])).toContain('No files yet');
    alertSpy.mockRestore();
  });

  it('HEALTH-FILES-SCR-021: a rejected delete surfaces its own message and keeps the row', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadFiles.mockResolvedValue([file({ id: 'f1', name: 'Sunset.jpg' })]);
    mockDeleteHealthFile.mockResolvedValue({
      files: [file({ id: 'f1', name: 'Sunset.jpg' })],
      status: 'offline',
      message: 'That did not reach your account. Check your connection and try again.',
    });
    const tree = await render(<HealthFilesScreen />);

    press(tree, 'health-file-delete-f1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());

    expect(byTestId(tree, 'health-file-f1').length).toBe(1);
    expect(allText(byTestId(tree, 'health-files-message')[0])).toBe(
      'That did not reach your account. Check your connection and try again.'
    );
    alertSpy.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/* Opening a file — the authenticated thumbnail / share path            */
/* ------------------------------------------------------------------ */

describe('HealthFilesScreen — thumbnails and opening a file', () => {
  it('HEALTH-FILES-SCR-022: an image file renders an authenticated thumbnail; a document falls back to its glyph', async () => {
    mockLoadFiles.mockResolvedValue([
      file({ id: 'img', isImage: true }),
      file({ id: 'doc', isImage: false, type: 'document' }),
    ]);
    const tree = await render(<HealthFilesScreen />);

    expect(byTestId(tree, 'health-file-thumb-img').length).toBe(1);
    expect(byTestId(tree, 'health-file-thumb-doc').length).toBe(0);
  });

  it('HEALTH-FILES-SCR-023: signed out (no session), the thumbnail falls back rather than firing a request', async () => {
    mockContentSource.mockReturnValue(null);
    mockLoadFiles.mockResolvedValue([file({ id: 'img', isImage: true })]);
    const tree = await render(<HealthFilesScreen />);

    expect(byTestId(tree, 'health-file-thumb-img').length).toBe(0);
  });

  it('HEALTH-FILES-SCR-024: opening downloads to cache then hands off to the share sheet', async () => {
    mockLoadFiles.mockResolvedValue([file({ id: 'f1', name: 'Sunset.jpg' })]);
    const tree = await render(<HealthFilesScreen />);

    await act(async () => {
      tree.root
        .find((n) => n.props?.accessibilityLabel === 'Open Sunset.jpg' && typeof n.props?.onPress === 'function')
        .props.onPress();
    });

    expect(FileSystem.downloadAsync).toHaveBeenCalledWith(
      'https://api.test/health/files/file_1/content',
      expect.stringContaining('health-file-'),
      { headers: {} }
    );
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/health-file-x.jpg', {
      mimeType: 'image/jpeg',
      dialogTitle: 'Sunset.jpg',
    });
  });

  it('HEALTH-FILES-SCR-025: opening without a session asks the member to sign in again, and downloads nothing', async () => {
    mockContentSource.mockReturnValue(null);
    mockLoadFiles.mockResolvedValue([file({ id: 'f1', name: 'Sunset.jpg' })]);
    const tree = await render(<HealthFilesScreen />);

    await act(async () => {
      tree.root
        .find((n) => n.props?.accessibilityLabel === 'Open Sunset.jpg' && typeof n.props?.onPress === 'function')
        .props.onPress();
    });

    expect(allText(byTestId(tree, 'health-files-message')[0])).toBe('Please sign in again to open this file.');
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
  });
});
