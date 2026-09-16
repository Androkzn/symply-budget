/**
 * TaskFormPhotos — the H6 attachment gap, closed at the picker.
 *
 * Four things have to stay true at once, and each is one `describe` below:
 *
 *  1. **Flag on → the bytes travel.** A picked photo is staged, sealed and
 *     uploaded through the blob channel, and what reaches the form is a
 *     `HouseBlobDescriptor` — never a device path. This is the whole point: the
 *     photo row already synced, only the bytes were missing.
 *  2. **Flag off → nothing changed.** The legacy R2 path is byte-for-byte what
 *     it was: a plain local uri in the form, uploaded at save time, with the
 *     blob channel never touched.
 *  3. **A descriptor renders.** A photo that arrived from a peer has no url at
 *     all, so it must render through `HouseBlobImage`, not `<Image>`.
 *  4. **A non-retryable failure clears the pending upload.** Quota and size are
 *     permanent for a given file; leaving a spinner in front of an upload that
 *     provably cannot finish is the dishonesty the error-copy layer exists to
 *     prevent.
 *
 * On top of those, `describe('E2E surface')` pins the strings the two-device
 * Maestro flows match on. They are matched by text/label, not testID, so a
 * well-meaning copy edit is a broken suite — these assertions are the tripwire.
 */

// ── the blob channel ─────────────────────────────────────────────────────────
// One mock covers both callers: the component seals through this module and
// `HouseBlobImage` resolves through it.
const mockUploadHouseBlob = jest.fn();
const mockStageHouseBlobOrigin = jest.fn();
const mockDeleteHouseBlob = jest.fn();
const mockNewBlobId = jest.fn();
const mockIsHouseBlobCached = jest.fn();
const mockResolveHouseBlobUri = jest.fn();

jest.mock('@features/house/local/blobs', () => ({
  BLOB_MAX_PLAINTEXT_BYTES: 64 * 1024 * 1024,
  uploadHouseBlob: (...args: unknown[]) => mockUploadHouseBlob(...args),
  stageHouseBlobOrigin: (...args: unknown[]) => mockStageHouseBlobOrigin(...args),
  deleteHouseBlob: (...args: unknown[]) => mockDeleteHouseBlob(...args),
  newBlobId: () => mockNewBlobId(),
  isHouseBlobCached: (...args: unknown[]) => mockIsHouseBlobCached(...args),
  resolveHouseBlobUri: (...args: unknown[]) => mockResolveHouseBlobUri(...args),
}));

const mockIsHouseLocalFirst = jest.fn();
jest.mock('@features/house/local/flag', () => ({
  isHouseLocalFirst: () => mockIsHouseLocalFirst(),
  isHouseP2PEnabled: () => false,
}));

// ── the picker ───────────────────────────────────────────────────────────────
const mockPickFromLibrary = jest.fn();
const mockTakePhoto = jest.fn();

jest.mock('@utils/taskPhotoSave', () => ({
  MAX_TASK_PHOTOS: 5,
  pickTaskPhotoFromLibrary: (...args: unknown[]) => mockPickFromLibrary(...args),
  takeTaskPhoto: (...args: unknown[]) => mockTakePhoto(...args),
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { HouseBlobImage } from '@components/house-v2/HouseBlobImage';
import { TaskFormPhotos } from '@components/tasks/TaskFormPhotos';
import { ThemeProvider } from '@contexts/ThemeContext';
import type { TaskFormPhoto } from '@utils/taskPhotoSave';

const DESCRIPTOR = {
  blobId: 'blob_abc123',
  mime: 'image/jpeg',
  bytes: 204_800,
  sha256: 'a'.repeat(64),
  chunkCount: 1,
  keyEpoch: 3,
};

type Patch = { photos?: TaskFormPhoto[]; coverPhotoIndex?: number };

function render(photos: TaskFormPhoto[], onChange: (patch: Patch) => void, coverIndex = 0) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ThemeProvider>
        <TaskFormPhotos
          photos={photos}
          coverPhotoIndex={coverIndex}
          onChange={onChange}
          householdId="hh_01"
        />
      </ThemeProvider>
    );
  });
  return r;
}

/** Collect every string rendered anywhere in the tree. */
function treeText(r: ReactTestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const el = node as { children?: unknown } | null;
    if (el && typeof el === 'object' && 'children' in el) walk(el.children);
  };
  walk(r.toJSON());
  return out.join(' | ');
}

/**
 * Tap "Add photo", then take the `Choose from Library` branch of the action
 * sheet. Exactly the path the Maestro flow drives.
 */
async function addFromLibrary(r: ReactTestRenderer.ReactTestRenderer): Promise<void> {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await act(async () => {
    r.root.findByProps({ testID: 'task-photo-add' }).props.onPress();
  });
  const buttons = alertSpy.mock.calls[0]![2] as Array<{ text: string; onPress?: () => void }>;
  const library = buttons.find((b) => b.text === 'Choose from Library')!;
  await act(async () => {
    library.onPress?.();
    // Let the staging + upload promise chain settle.
    await Promise.resolve();
    await Promise.resolve();
  });
  alertSpy.mockRestore();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNewBlobId.mockReturnValue('blob_abc123');
  mockStageHouseBlobOrigin.mockResolvedValue('file:///origin/blob_abc123');
  mockUploadHouseBlob.mockResolvedValue(DESCRIPTOR);
  mockDeleteHouseBlob.mockResolvedValue(undefined);
  mockPickFromLibrary.mockResolvedValue({ uri: 'file:///picked.jpg', mime: 'image/jpeg' });
  mockTakePhoto.mockResolvedValue({ uri: 'file:///camera.jpg', mime: 'image/jpeg' });
  mockIsHouseBlobCached.mockResolvedValue(true);
  mockResolveHouseBlobUri.mockResolvedValue('file:///cache/blob_abc123');
  mockIsHouseLocalFirst.mockReturnValue(false);
});

// ─── 1. flag on: the bytes travel ────────────────────────────────────────────

describe('House local-first on — the blob channel', () => {
  beforeEach(() => mockIsHouseLocalFirst.mockReturnValue(true));

  it('stages, seals and stores the descriptor on the photo', async () => {
    const onChange = jest.fn();
    const r = render([], onChange);

    await addFromLibrary(r);

    expect(mockStageHouseBlobOrigin).toHaveBeenCalledWith('file:///picked.jpg', 'blob_abc123');
    expect(mockUploadHouseBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUri: 'file:///origin/blob_abc123',
        mime: 'image/jpeg',
        blobId: 'blob_abc123',
        householdId: 'hh_01',
      })
    );
    expect(onChange).toHaveBeenCalledWith({
      photos: [{ uri: '', blob: DESCRIPTOR }],
      coverPhotoIndex: 0,
    });
  });

  it('never puts a device path in the form — a peer could not open one', async () => {
    const onChange = jest.fn();
    const r = render([], onChange);

    await addFromLibrary(r);

    const stored = (onChange.mock.calls[0]![0] as Patch).photos![0]!;
    expect(stored.uri).toBe('');
    expect(stored.blob).toEqual(DESCRIPTOR);
  });

  it('resumes with the SAME blob id rather than minting a new one', async () => {
    // A second nonce for the same (contentKey, chunkIndex) is the bug the whole
    // staging design prevents, so a retry must reuse the id.
    mockUploadHouseBlob.mockRejectedValueOnce(
      Object.assign(new Error('chunk 2 never landed'), { code: 'blob_incomplete' })
    );
    const r = render([], jest.fn());

    await addFromLibrary(r);
    expect(r.root.findAllByProps({ testID: 'task-photo-retry' }).length).toBeGreaterThan(0);

    await act(async () => {
      r.root.findByProps({ testID: 'task-photo-retry' }).props.onPress();
      await Promise.resolve();
    });

    expect(mockNewBlobId).toHaveBeenCalledTimes(1);
    expect(mockUploadHouseBlob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ blobId: 'blob_abc123' })
    );
  });

  it('reclaims household storage when a blob-backed photo is removed', async () => {
    const onChange = jest.fn();
    const r = render([{ id: 'tp_1', uri: '', blob: DESCRIPTOR }], onChange);

    await act(async () => {
      r.root.findByProps({ testID: 'task-photo-remove-0' }).props.onPress();
    });

    expect(onChange).toHaveBeenCalledWith({ photos: [], coverPhotoIndex: 0 });
    expect(mockDeleteHouseBlob).toHaveBeenCalledWith('blob_abc123', 'hh_01');
  });
});

// ─── 2. flag off: the legacy path is untouched ───────────────────────────────

describe('House local-first off — the legacy R2 path', () => {
  it('stores the plain local uri and never touches the blob channel', async () => {
    const onChange = jest.fn();
    const r = render([], onChange);

    await addFromLibrary(r);

    expect(onChange).toHaveBeenCalledWith({
      photos: [{ uri: 'file:///picked.jpg' }],
      coverPhotoIndex: 0,
    });
    expect(mockNewBlobId).not.toHaveBeenCalled();
    expect(mockStageHouseBlobOrigin).not.toHaveBeenCalled();
    expect(mockUploadHouseBlob).not.toHaveBeenCalled();
  });

  it('keeps the existing cover index when appending to a non-empty strip', async () => {
    const onChange = jest.fn();
    const r = render([{ uri: 'file:///a.jpg' }, { uri: 'file:///b.jpg' }], onChange, 1);

    await addFromLibrary(r);

    expect(onChange).toHaveBeenCalledWith({
      photos: [{ uri: 'file:///a.jpg' }, { uri: 'file:///b.jpg' }, { uri: 'file:///picked.jpg' }],
      coverPhotoIndex: 1,
    });
  });

  it('does not delete anything from the blob channel when a legacy photo is removed', async () => {
    const onChange = jest.fn();
    const r = render([{ uri: 'file:///a.jpg', photo_key: 'maintenance-photos/h1/a.jpg' }], onChange);

    await act(async () => {
      r.root.findByProps({ testID: 'task-photo-remove-0' }).props.onPress();
    });

    expect(onChange).toHaveBeenCalledWith({ photos: [], coverPhotoIndex: 0 });
    expect(mockDeleteHouseBlob).not.toHaveBeenCalled();
  });
});

// ─── 3. a descriptor renders ─────────────────────────────────────────────────

describe('thumbnails', () => {
  it('renders a descriptor-backed photo through HouseBlobImage, not <Image>', () => {
    const r = render([{ id: 'tp_1', uri: '', blob: DESCRIPTOR }], jest.fn());

    const blobImages = r.root.findAllByType(HouseBlobImage);
    expect(blobImages).toHaveLength(1);
    expect(blobImages[0]!.props.descriptor).toEqual(DESCRIPTOR);
    expect(blobImages[0]!.props.householdId).toBe('hh_01');
    // No plain <Image> — a descriptor has no url to point one at.
    expect(r.root.findAllByProps({ testID: 'task-photo-image-0' })).toHaveLength(0);
  });

  it('falls back to <Image> for a legacy photo with a url', () => {
    const r = render([{ id: 'tp_1', uri: 'https://cdn.example/a.jpg', photo_key: 'k' }], jest.fn());

    expect(r.root.findAllByType(HouseBlobImage)).toHaveLength(0);
    expect(r.root.findByProps({ testID: 'task-photo-image-0' }).props.source).toEqual({
      uri: 'https://cdn.example/a.jpg',
    });
  });

  it('renders both kinds side by side in one strip', () => {
    const r = render(
      [
        { id: 'tp_1', uri: '', blob: DESCRIPTOR },
        { id: 'tp_2', uri: 'https://cdn.example/b.jpg', photo_key: 'k2' },
      ],
      jest.fn()
    );

    expect(r.root.findAllByType(HouseBlobImage)).toHaveLength(1);
    expect(r.root.findAllByProps({ testID: 'task-photo-image-0' })).toHaveLength(0);
    expect(r.root.findAllByProps({ testID: 'task-photo-image-1' }).length).toBeGreaterThan(0);
  });
});

// ─── 4. the named H6 failures ────────────────────────────────────────────────

describe('blob error states', () => {
  beforeEach(() => mockIsHouseLocalFirst.mockReturnValue(true));

  it('drops the pending upload on a non-retryable quota failure', async () => {
    mockUploadHouseBlob.mockRejectedValueOnce(
      Object.assign(new Error('household blob quota exceeded'), {
        code: 'blob_quota_exceeded',
        limitBytes: 1024 * 1024 * 1024,
      })
    );
    const onChange = jest.fn();
    const r = render([], onChange);

    await addFromLibrary(r);

    // No spinner left behind, and no "Try again" in front of an upload that
    // cannot succeed.
    expect(r.root.findAllByProps({ testID: 'task-photo-pending' })).toHaveLength(0);
    expect(r.root.findAllByProps({ testID: 'task-photo-retry' })).toHaveLength(0);
    // The staged bytes are released rather than sitting against the quota.
    expect(mockDeleteHouseBlob).toHaveBeenCalledWith('blob_abc123', 'hh_01');
    expect(onChange).not.toHaveBeenCalled();
    expect(treeText(r)).toContain('Attachment storage is full');
  });

  it('drops the pending upload on a non-retryable size failure', async () => {
    mockUploadHouseBlob.mockRejectedValueOnce(
      Object.assign(new Error('too big'), { code: 'blob_too_large', bytes: 90 * 1024 * 1024 })
    );
    const r = render([], jest.fn());

    await addFromLibrary(r);

    expect(r.root.findAllByProps({ testID: 'task-photo-pending' })).toHaveLength(0);
    expect(r.root.findAllByProps({ testID: 'task-photo-retry' })).toHaveLength(0);
    expect(treeText(r)).toContain('That file is too big');
  });

  it('keeps the pending upload resumable on a retryable failure', async () => {
    mockUploadHouseBlob.mockRejectedValueOnce(
      Object.assign(new Error('integrity check failed'), { code: 'blob_corrupt' })
    );
    const r = render([], jest.fn());

    await addFromLibrary(r);

    expect(r.root.findAllByProps({ testID: 'task-photo-pending' }).length).toBeGreaterThan(0);
    expect(r.root.findAllByProps({ testID: 'task-photo-retry' }).length).toBeGreaterThan(0);
    // Nothing is deleted — the staged envelopes are what makes the resume cheap.
    expect(mockDeleteHouseBlob).not.toHaveBeenCalled();
  });

  it('discards a stopped upload and its staged bytes on Dismiss', async () => {
    mockUploadHouseBlob.mockRejectedValueOnce(
      Object.assign(new Error('still uploading'), { code: 'blob_incomplete' })
    );
    const r = render([], jest.fn());

    await addFromLibrary(r);
    await act(async () => {
      r.root.findByProps({ testID: 'task-photo-error-dismiss' }).props.onPress();
    });

    expect(r.root.findAllByProps({ testID: 'task-photo-error' })).toHaveLength(0);
    expect(r.root.findAllByProps({ testID: 'task-photo-pending' })).toHaveLength(0);
    expect(mockDeleteHouseBlob).toHaveBeenCalledWith('blob_abc123', 'hh_01');
  });

  it('uses the H6 copy, never the engineering message', async () => {
    mockUploadHouseBlob.mockRejectedValueOnce(
      Object.assign(new Error('Attachment is larger than the 67108864 byte limit'), {
        code: 'blob_too_large',
      })
    );
    const r = render([], jest.fn());

    await addFromLibrary(r);

    expect(treeText(r)).not.toContain('67108864');
  });
});

// ─── the E2E contract ────────────────────────────────────────────────────────

describe('E2E surface (matched by text/label, not testID)', () => {
  it('keeps the "Photos" header and the "n/5" counter', () => {
    const r = render([{ uri: 'file:///a.jpg' }], jest.fn());
    const text = treeText(r);
    expect(text).toContain('Photos');
    expect(text).toContain('1/5');
    expect(r.root.findByProps({ testID: 'task-photo-counter' })).toBeTruthy();
  });

  it('keeps the exact "Add photo" accessibility label (matched as ^Add photo$)', () => {
    const r = render([], jest.fn());
    const add = r.root.findByProps({ testID: 'task-photo-add' });
    expect(add.props.accessibilityLabel).toBe('Add photo');
  });

  it('keeps "Choose a source" then "Choose from Library" in the action sheet', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = render([], jest.fn());

    await act(async () => {
      r.root.findByProps({ testID: 'task-photo-add' }).props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith('Add Photo', 'Choose a source', expect.any(Array));
    const buttons = alertSpy.mock.calls[0]![2] as Array<{ text: string }>;
    expect(buttons.map((b) => b.text)).toEqual(['Take Photo', 'Choose from Library', 'Cancel']);
    alertSpy.mockRestore();
  });

  it('keeps "Task cover photo" on the first thumbnail — for both photo kinds', () => {
    const legacy = render([{ uri: 'file:///a.jpg' }, { uri: 'file:///b.jpg' }], jest.fn());
    expect(legacy.root.findByProps({ testID: 'task-photo-item-0' }).props.accessibilityLabel).toBe(
      'Task cover photo'
    );
    expect(legacy.root.findByProps({ testID: 'task-photo-item-1' }).props.accessibilityLabel).toBe(
      'Set as task cover photo'
    );

    const blob = render([{ id: 'tp_1', uri: '', blob: DESCRIPTOR }], jest.fn());
    expect(blob.root.findByProps({ testID: 'task-photo-item-0' }).props.accessibilityLabel).toBe(
      'Task cover photo'
    );
    // The inner image gets a DIFFERENT label so the E2E matcher stays unambiguous.
    expect(blob.root.findByType(HouseBlobImage).props.accessibilityLabel).toBe('Task photo 1');
  });

  it('keeps every existing testID', () => {
    const r = render([{ uri: 'file:///a.jpg' }], jest.fn());
    for (const id of [
      'task-photo-counter',
      'task-photo-item-0',
      'task-photo-remove-0',
      'task-photo-add',
    ]) {
      expect(r.root.findAllByProps({ testID: id }).length).toBeGreaterThan(0);
    }
  });
});
