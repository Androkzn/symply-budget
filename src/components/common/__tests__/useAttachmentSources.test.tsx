/**
 * The one upload list, and the contract every surface now inherits from it.
 *
 * ## What this suite is really protecting
 *
 * Before `useAttachmentSources`, twenty-one surfaces each wrote their own
 * picker, and no two offered the same list: the material references opened the
 * photo library alone, the avatar offered camera and library, the contractor
 * form added Files, and six surfaces in the whole fleet reached Google Drive.
 * None of that ever FAILED — a picker that only offers three sources works
 * perfectly for anyone whose file is in one of the three. It is invisible to
 * every test that drives a picker, and visible only to the member whose file is
 * in the fourth place, who simply cannot do the thing and is told nothing.
 *
 * So the cases below pin the LIST and the CONTRACT rather than any one screen:
 * four sources, one cancel rule, one permission alert, one limit. A surface
 * that re-forks its own picker is then the odd one out by construction.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import * as DocumentPicker from 'expo-document-picker';
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import ImageCropPicker from '@services/image-picker-compat';
import { presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';

import {
  mimeFromName,
  useAttachmentSources,
  type AttachmentSources,
  type PickedAttachment,
} from '../useAttachmentSources';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: {
    openCamera: jest.fn(),
    openPicker: jest.fn(),
    openPickerMultiple: jest.fn(),
  },
}));

jest.mock('@utils/pickerPermissionAlert', () => ({
  ...jest.requireActual('@utils/pickerPermissionAlert'),
  presentPickerPermissionDeniedAlert: jest.fn(),
}));

/**
 * A stand-in for the real Drive browse, which is an OAuth'd full-screen modal.
 * It records the props it was handed and can hand a file back on demand.
 */
let driveProps: Record<string, unknown> = {};
jest.mock('@components/cloud-storage', () => ({
  CloudFilePicker: (props: Record<string, unknown>) => {
    driveProps = props;
    return null;
  },
}));

const mockedPicker = ImageCropPicker as jest.Mocked<typeof ImageCropPicker>;
const mockedDocuments = DocumentPicker as jest.Mocked<typeof DocumentPicker>;
const mockedPermissionAlert =
  presentPickerPermissionDeniedAlert as jest.MockedFunction<
    typeof presentPickerPermissionDeniedAlert
  >;

type Options = Parameters<typeof useAttachmentSources>[0];

/** Mounts the hook and hands back its live return value. */
function mountHook(options: Partial<Options> = {}) {
  const api: { current: AttachmentSources | null } = { current: null };

  function Probe() {
    api.current = useAttachmentSources({
      rememberScope: 'test',
      onPicked: options.onPicked ?? jest.fn(),
      ...options,
    });
    return api.current.drivePicker;
  }

  act(() => {
    ReactTestRenderer.create(React.createElement(Probe));
  });
  return api;
}

const cancelled = () =>
  Object.assign(new Error('cancelled'), { code: 'E_PICKER_CANCELLED' });
const denied = () =>
  Object.assign(new Error('denied'), { code: 'E_NO_LIBRARY_PERMISSION' });

beforeEach(() => {
  jest.clearAllMocks();
  driveProps = {};
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the shared upload source list', () => {
  it('hands every surface all four sources', () => {
    const api = mountHook();
    expect(Object.keys(api.current!.sourceHandlers).sort()).toEqual([
      'onCamera',
      'onDrive',
      'onFile',
      'onGallery',
    ]);
  });

  it('normalises what each source returns into one shape', async () => {
    const onPicked = jest.fn();
    const api = mountHook({ onPicked });

    mockedPicker.openCamera.mockResolvedValue({
      path: 'file:///shot.jpg',
      filename: 'shot.jpg',
      mime: 'image/jpeg',
      size: 120,
    } as never);
    await act(async () => api.current!.sourceHandlers.onCamera());

    expect(onPicked).toHaveBeenCalledWith(
      [{ uri: 'file:///shot.jpg', name: 'shot.jpg', mime: 'image/jpeg', size: 120 }],
      'camera',
    );
  });

  /**
   * Drive reports a name and a size but never a content type, and a file
   * uploaded with no mime renders as nothing on the other device. The
   * extension is the only honest source for it.
   */
  it('derives a mime for a Drive file from its name', async () => {
    const onPicked = jest.fn();
    mountHook({ onPicked });

    await act(async () => {
      (driveProps.onFileSelected as (f: unknown) => void)({
        uri: 'file:///plan.pdf',
        name: 'plan.pdf',
        size: 900,
      });
    });

    expect(onPicked).toHaveBeenCalledWith(
      [{ uri: 'file:///plan.pdf', name: 'plan.pdf', mime: 'application/pdf', size: 900 }],
      'drive',
    );
    expect(mimeFromName('shot.HEIC')).toBe('image/heic');
    // An extension nothing recognises stays undefined rather than being
    // mislabelled as a JPEG — the caller decides what unknown bytes are.
    expect(mimeFromName('archive.xyz')).toBeUndefined();
  });

  it('says nothing at all when a picker is cancelled', async () => {
    const onPicked = jest.fn();
    const api = mountHook({ onPicked });

    mockedPicker.openPicker.mockRejectedValue(cancelled());
    mockedDocuments.getDocumentAsync.mockResolvedValue({ canceled: true } as never);

    await act(async () => api.current!.sourceHandlers.onGallery());
    await act(async () => api.current!.sourceHandlers.onFile());

    expect(onPicked).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  /**
   * A denied permission is not a failure to retry — the OS has already asked,
   * and the only route left is Settings. That is a different answer from "we
   * could not open the camera", which is what every hand-rolled picker used to
   * show for both.
   */
  it('answers a denied permission with the Settings alert, not a generic error', async () => {
    const api = mountHook();

    mockedPicker.openCamera.mockRejectedValue(denied());
    await act(async () => api.current!.sourceHandlers.onCamera());
    expect(mockedPermissionAlert).toHaveBeenCalledWith('camera');

    mockedPicker.openPicker.mockRejectedValue(denied());
    await act(async () => api.current!.sourceHandlers.onGallery());
    expect(mockedPermissionAlert).toHaveBeenCalledWith('library');

    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('keeps a single-value surface single-select on every source', async () => {
    const api = mountHook({ limit: 1 });
    expect(driveProps.multiSelect).toBe(false);

    mockedDocuments.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'a', name: 'a.png' }],
    } as never);
    await act(async () => api.current!.sourceHandlers.onFile());
    expect(
      (mockedDocuments.getDocumentAsync.mock.calls[0][0] as { multiple?: boolean })
        .multiple,
    ).toBe(false);

    // Single-select uses `openPicker`, which returns one asset — NOT
    // `openPickerMultiple`, whose OS sheet invites a selection the surface
    // would then silently throw most of away.
    mockedPicker.openPicker.mockResolvedValue({ path: 'p' } as never);
    await act(async () => api.current!.sourceHandlers.onGallery());
    expect(mockedPicker.openPickerMultiple).not.toHaveBeenCalled();
  });

  it('caps a batch at the limit and says so, rather than dropping the rest silently', async () => {
    const onPicked = jest.fn();
    const api = mountHook({ limit: 2, onPicked });

    mockedPicker.openPickerMultiple.mockResolvedValue([
      { path: 'a' },
      { path: 'b' },
      { path: 'c' },
    ] as never);
    await act(async () => api.current!.sourceHandlers.onGallery());

    const delivered = onPicked.mock.calls[0][0] as PickedAttachment[];
    expect(delivered.map(item => item.uri)).toEqual(['a', 'b']);
    expect(Alert.alert).toHaveBeenCalledWith(
      'That is the limit',
      expect.stringContaining('1'),
    );
  });

  it('filters the file browsers to what the surface accepts', async () => {
    const api = mountHook({ mimeTypes: ['application/pdf'] });
    expect(driveProps.mimeTypeFilter).toEqual(['application/pdf']);

    mockedDocuments.getDocumentAsync.mockResolvedValue({ canceled: true } as never);
    await act(async () => api.current!.sourceHandlers.onFile());
    expect(
      (mockedDocuments.getDocumentAsync.mock.calls[0][0] as { type?: string[] }).type,
    ).toEqual(['application/pdf']);
  });

  /**
   * Two surfaces sharing a scope would fight over one pinned Drive folder, and
   * the member would see a picker that keeps opening somewhere else. It is a
   * required option for exactly that reason; this pins that it reaches Drive.
   */
  it('namespaces the remembered Drive folder per surface', () => {
    mountHook({ rememberScope: 'contractor-invoice' });
    expect(driveProps.rememberScope).toBe('contractor-invoice');
  });

  /**
   * A screen that reports failures inline keeps doing so.
   *
   * The list is what has to be identical everywhere; how a surface VOICES a
   * failure is its own business — the Health screens keep a message line under
   * the tiles, and forcing an alert there for the sake of uniformity would be a
   * regression nobody asked for.
   */
  it('lets a surface answer a picker failure inline instead of with an alert', async () => {
    const onError = jest.fn();
    const api = mountHook({ onError });

    mockedPicker.openCamera.mockRejectedValue(new Error('boom'));
    await act(async () => api.current!.sourceHandlers.onCamera());

    expect(onError).toHaveBeenCalledWith('The camera could not be opened.');
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  /**
   * `openPicker` is typed to return one asset, but the API it stands in for
   * answered a single pick with an ARRAY under some options — and several
   * screens carried their own `Array.isArray` guard because of it. Dropping
   * that guard per-screen turns a picked photo into `uri: undefined` and an
   * upload of nothing, with no error anywhere.
   */
  it('takes the first asset when a single pick answers with an array', async () => {
    const onPicked = jest.fn();
    const api = mountHook({ onPicked });

    mockedPicker.openPicker.mockResolvedValue([
      { path: 'file:///first.jpg' },
      { path: 'file:///second.jpg' },
    ] as never);
    await act(async () => api.current!.sourceHandlers.onGallery());

    expect((onPicked.mock.calls[0][0] as PickedAttachment[])[0].uri).toBe(
      'file:///first.jpg',
    );
  });

  it('refuses every source while disabled', async () => {
    const onPicked = jest.fn();
    const api = mountHook({ disabled: true, onPicked });

    await act(async () => {
      api.current!.sourceHandlers.onCamera();
      api.current!.sourceHandlers.onGallery();
      api.current!.sourceHandlers.onFile();
      api.current!.sourceHandlers.onDrive();
    });

    expect(mockedPicker.openCamera).not.toHaveBeenCalled();
    expect(mockedPicker.openPicker).not.toHaveBeenCalled();
    expect(mockedDocuments.getDocumentAsync).not.toHaveBeenCalled();
    expect(api.current!.driveOpen).toBe(false);
    expect(onPicked).not.toHaveBeenCalled();
  });
});
