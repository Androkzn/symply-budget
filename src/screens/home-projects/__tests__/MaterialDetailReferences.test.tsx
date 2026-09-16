/**
 * The four ways a reference image gets onto a material.
 *
 * This block used to open the photo library and nothing else, which is the bug
 * this suite exists to keep fixed. Where a member's reference images live is a
 * fact about their phone, not a preference: the sample held against their own
 * wall is in the camera, the showroom shot saved months ago is in the gallery,
 * a designer's mood board arrives by email and lands in Files, and a household
 * that keeps its renovation folder in Drive has none of them on the device at
 * all. A surface that offers one of the four silently excludes the other three.
 *
 * What each case pins is that the source only chooses where the URI comes from
 * — every one of them lands in the SAME write, with `kind: 'reference'`. That
 * last argument is not cosmetic: `'photo'` would put a wall of paint swatches
 * into the project's before/after strip and make one of them the card on the
 * projects list.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import * as DocumentPicker from 'expo-document-picker';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { homeProjectsApi } from '@api/home-projects';
import { ThemeProvider } from '@contexts/ThemeContext';
import ImageCropPicker from '@services/image-picker-compat';

import { MaterialDetailScreen } from '../MaterialDetailScreen';

const SELECTION_ID = 'hps_1';
const PROJECT_ID = 'hp_1';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({
    params: { projectId: 'hp_1', selectionId: 'hps_1' },
  }),
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector: (s: unknown) => unknown) =>
    selector({ currentHousehold: { id: 'hh_1' } }),
}));

jest.mock('@hooks/useUnsavedChanges', () => ({
  useUnsavedChanges: () => ({
    isDirty: false,
    isSaving: false,
    save: jest.fn(),
    confirmDiscard: jest.fn(),
  }),
}));

jest.mock('@features/chat', () => ({
  CHAT_SUBJECT_MATERIAL: 'material',
  houseChatConfig: { api: { deleteSubjectRooms: jest.fn() } },
  SubjectChatButton: () => null,
}));

jest.mock('@components/house-v2/HouseBlobImage', () => ({
  HouseBlobImage: () => null,
}));

// The real `ScreenHeader` pulls in ProfileProvider and the notification wiring,
// none of which is the subject here. `ScanImportSources` is kept REAL — it is
// the shared row this whole suite is about, and stubbing it would leave the
// cases asserting against their own stub.
jest.mock('@components/common', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ScanImportSources: jest.requireActual('@components/common/ScanImportSources')
      .ScanImportSources,
    ScreenHeader: ({ rightElement }: { rightElement?: React.ReactNode }) =>
      ReactLocal.createElement(View, { testID: 'screen-header' }, rightElement ?? null),
  };
});

/**
 * Stands in for the Drive browse so the case can hand back a downloaded file
 * without an OAuth round trip. Rendered only when `visible`, exactly as the
 * real one behaves, so "the Drive tile opens it" is a real assertion.
 */
jest.mock('@components/cloud-storage', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    CloudFilePicker: (props: {
      visible: boolean;
      onFilesSelected?: (files: Array<{ uri: string }>) => void;
    }) =>
      props.visible
        ? ReactLocal.createElement(
            Text,
            {
              testID: 'fake-drive-picker',
              onPress: () =>
                props.onFilesSelected?.([{ uri: 'file:///drive-room.jpg' }]),
            },
            'drive',
          )
        : null,
  };
});

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: { openCamera: jest.fn(), openPickerMultiple: jest.fn() },
}));

jest.mock('@api/home-projects', () => {
  const actual = jest.requireActual('@api/home-projects');
  return {
    ...actual,
    useHomeProjectHub: jest.fn(),
    useHomeProjectMutation: jest.fn(),
    homeProjectsApi: {
      ...actual.homeProjectsApi,
      uploadSelectionPhoto: jest.fn(),
    },
  };
});

const mockedApi = homeProjectsApi as jest.Mocked<typeof homeProjectsApi>;
const mockedPicker = ImageCropPicker as jest.Mocked<typeof ImageCropPicker>;
const mockedDocuments = DocumentPicker as jest.Mocked<typeof DocumentPicker>;

function selection() {
  return {
    id: SELECTION_ID,
    project_id: PROJECT_ID,
    name: 'Mold removal spray or treatment',
    category: 'materials',
    status: 'candidate',
    qty: 1,
    unit: 'litre',
    unit_price_cents: null,
    vendor: null,
    product_url: null,
    notes: null,
    option_group_id: null,
    brand: null,
    sku: null,
    image_url: null,
    coverage_per_unit: null,
    coverage_unit: null,
    specs_json: null,
    color_hex: null,
    source: 'manual',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function renderScreen() {
  const { useHomeProjectHub, useHomeProjectMutation } =
    require('@api/home-projects') as {
      useHomeProjectHub: jest.Mock;
      useHomeProjectMutation: jest.Mock;
    };
  useHomeProjectHub.mockReturnValue({
    data: {
      project: { id: PROJECT_ID, title: 'Basement', visibility: 'published' },
      selections: [selection()],
      attachments: [],
      phases: [],
      tasks: [],
      comments: [],
    },
    isLoading: false,
  });
  useHomeProjectMutation.mockReturnValue({ invalidate: jest.fn() });

  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      React.createElement(ThemeProvider, null, React.createElement(MaterialDetailScreen)),
    );
  });
  return tree;
}

/** Reveal the Camera · Gallery · File · Drive row behind "Add photos". */
async function openSources(tree: ReactTestRenderer.ReactTestRenderer) {
  await act(async () => {
    tree.root.findByProps({ testID: 'material-detail-reference-add' }).props.onPress();
  });
}

async function tapSource(
  tree: ReactTestRenderer.ReactTestRenderer,
  key: 'camera' | 'gallery' | 'file' | 'drive',
) {
  await act(async () => {
    tree.root.findByProps({ testID: `material-reference-${key}` }).props.onPress();
  });
}

/** Every reference write, as `[uri, kind]` pairs. */
function uploads() {
  return mockedApi.uploadSelectionPhoto.mock.calls.map(call => [call[2], call[5]]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.uploadSelectionPhoto.mockResolvedValue({} as never);
});

describe('adding reference photos to a material', () => {
  it('offers all four sources, not just the photo library', async () => {
    const tree = renderScreen();
    await openSources(tree);

    for (const key of ['camera', 'gallery', 'file', 'drive'] as const) {
      expect(
        tree.root.findAllByProps({ testID: `material-reference-${key}` }).length,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps the row out of the way until it is asked for', () => {
    // The block's job is the references it already holds; four tiles pinned
    // above the product shot would push the fields the member came to edit off
    // the first screen.
    const tree = renderScreen();
    expect(tree.root.findAllByProps({ testID: 'material-reference-camera' })).toHaveLength(0);
  });

  it('files a camera shot as a reference', async () => {
    mockedPicker.openCamera.mockResolvedValue({
      path: 'file:///shot.jpg',
    } as never);
    const tree = renderScreen();
    await openSources(tree);
    await tapSource(tree, 'camera');

    expect(uploads()).toEqual([['file:///shot.jpg', 'reference']]);
  });

  it('takes a whole batch from the gallery in one trip', async () => {
    mockedPicker.openPickerMultiple.mockResolvedValue([
      { path: 'file:///a.jpg' },
      { path: 'file:///b.jpg' },
    ] as never);
    const tree = renderScreen();
    await openSources(tree);
    await tapSource(tree, 'gallery');

    expect(uploads()).toEqual([
      ['file:///a.jpg', 'reference'],
      ['file:///b.jpg', 'reference'],
    ]);
  });

  it('reads a mood board out of Files', async () => {
    mockedDocuments.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///board.png' }],
    } as never);
    const tree = renderScreen();
    await openSources(tree);
    await tapSource(tree, 'file');

    expect(uploads()).toEqual([['file:///board.png', 'reference']]);
  });

  it('writes nothing when the member backs out of Files', async () => {
    mockedDocuments.getDocumentAsync.mockResolvedValue({
      canceled: true,
    } as never);
    const tree = renderScreen();
    await openSources(tree);
    await tapSource(tree, 'file');

    expect(mockedApi.uploadSelectionPhoto).not.toHaveBeenCalled();
  });

  it('opens Drive only on the Drive tile, and files what comes back', async () => {
    const tree = renderScreen();
    await openSources(tree);
    expect(tree.root.findAllByProps({ testID: 'fake-drive-picker' })).toHaveLength(0);

    await tapSource(tree, 'drive');
    await act(async () => {
      tree.root.findByProps({ testID: 'fake-drive-picker' }).props.onPress();
    });

    expect(uploads()).toEqual([['file:///drive-room.jpg', 'reference']]);
  });

  /**
   * A cancelled picker throws `E_PICKER_CANCELLED` rather than returning
   * empty — the compat shim's documented contract. Treating it as a failure
   * would put an alert in front of a member who simply changed their mind.
   */
  it('says nothing when the picker is cancelled', async () => {
    const cancelled = Object.assign(new Error('cancelled'), {
      code: 'E_PICKER_CANCELLED',
    });
    mockedPicker.openPickerMultiple.mockRejectedValue(cancelled);
    const tree = renderScreen();
    await openSources(tree);
    await tapSource(tree, 'gallery');

    expect(mockedApi.uploadSelectionPhoto).not.toHaveBeenCalled();
  });

  /**
   * One unreadable file out of several must not cost the member the rest —
   * the Drive and Files branches hand over batches, and an abort on the first
   * failure would silently drop everything after it.
   */
  it('keeps the readable files when one of a batch fails', async () => {
    mockedPicker.openPickerMultiple.mockResolvedValue([
      { path: 'file:///a.jpg' },
      { path: 'file:///bad.jpg' },
      { path: 'file:///c.jpg' },
    ] as never);
    mockedApi.uploadSelectionPhoto
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('unreadable'))
      .mockResolvedValueOnce({} as never);

    const tree = renderScreen();
    await openSources(tree);
    await tapSource(tree, 'gallery');

    expect(uploads()).toEqual([
      ['file:///a.jpg', 'reference'],
      ['file:///bad.jpg', 'reference'],
      ['file:///c.jpg', 'reference'],
    ]);
  });
});
