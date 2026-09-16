/**
 * taskPhotoSave — build API payload from local form photos.
 */

jest.mock('@utils/photoUpload', () => ({
  uploadTaskPhotos: jest.fn(),
}));

import { uploadTaskPhotos } from '@utils/photoUpload';
import {
  blobPhotoKey,
  buildTaskPhotoSavePayload,
  isBlobPhotoKey,
  type TaskFormPhoto,
} from '@utils/taskPhotoSave';

const mockUpload = uploadTaskPhotos as jest.Mock;

/** A photo whose bytes already went through the H6 encrypted blob channel. */
const DESCRIPTOR = {
  blobId: 'blob_abc123',
  mime: 'image/jpeg',
  bytes: 204_800,
  sha256: 'a'.repeat(64),
  chunkCount: 1,
  keyEpoch: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildTaskPhotoSavePayload', () => {
  it('returns empty photos array when no attachments', async () => {
    const result = await buildTaskPhotoSavePayload('hh_01', [], 0);
    expect(result).toEqual({ photos: [], cover_photo_index: 0 });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('passes through existing photo_key values without uploading', async () => {
    const result = await buildTaskPhotoSavePayload(
      'hh_01',
      [{ uri: 'https://cdn.example/1.jpg', photo_key: 'maintenance-photos/h1/a.jpg' }],
      0
    );
    expect(result).toEqual({
      photos: [{ photo_key: 'maintenance-photos/h1/a.jpg' }],
      cover_photo_index: 0,
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('uploads local URIs and preserves cover index', async () => {
    mockUpload.mockResolvedValueOnce([{ photo_key: 'maintenance-photos/h1/new.jpg', original_uri: 'file:///a.jpg' }]);

    const result = await buildTaskPhotoSavePayload(
      'hh_01',
      [{ uri: 'file:///a.jpg' }],
      0
    );

    expect(mockUpload).toHaveBeenCalledWith('hh_01', ['file:///a.jpg']);
    expect(result).toEqual({
      photos: [{ photo_key: 'maintenance-photos/h1/new.jpg' }],
      cover_photo_index: 0,
    });
  });

  it('clamps cover index to the last photo when out of range', async () => {
    const result = await buildTaskPhotoSavePayload(
      'hh_01',
      [
        { uri: 'https://cdn.example/1.jpg', photo_key: 'k1' },
        { uri: 'https://cdn.example/2.jpg', photo_key: 'k2' },
      ],
      9
    );
    expect(result.cover_photo_index).toBe(1);
  });
});

/**
 * H6: a photo whose bytes already went through the encrypted blob channel is
 * finished. Re-running the legacy R2 upload for it would send the same image a
 * second time, to a bucket a local-first household never reads from — and would
 * leave the row pointing at that copy instead of the sealed one.
 */
describe('buildTaskPhotoSavePayload — blob-backed photos', () => {
  it('passes the descriptor through and never uploads to R2', async () => {
    const result = await buildTaskPhotoSavePayload('hh_01', [{ uri: '', blob: DESCRIPTOR }], 0);

    expect(mockUpload).not.toHaveBeenCalled();
    expect(result).toEqual({
      photos: [{ photo_key: 'lf-blob/blob_abc123', blob: DESCRIPTOR }],
      cover_photo_index: 0,
    });
  });

  it('prefers the descriptor over a synthetic key on the same photo', async () => {
    // The edit round-trip hands back both: `photo_key` is the synthetic
    // `lf-blob/…` string, `blob` is the real address. Reading the key first
    // would silently drop the descriptor.
    const photo: TaskFormPhoto = {
      id: 'tp_1',
      uri: '',
      photo_key: blobPhotoKey(DESCRIPTOR),
      blob: DESCRIPTOR,
    };

    const result = await buildTaskPhotoSavePayload('hh_01', [photo], 0);

    expect(result.photos).toEqual([{ photo_key: 'lf-blob/blob_abc123', blob: DESCRIPTOR }]);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('mixes blob and legacy photos in one array, uploading only the local one', async () => {
    mockUpload.mockResolvedValueOnce([
      { photo_key: 'maintenance-photos/h1/new.jpg', original_uri: 'file:///c.jpg' },
    ]);

    const result = await buildTaskPhotoSavePayload(
      'hh_01',
      [
        { uri: '', blob: DESCRIPTOR },
        { uri: 'https://cdn.example/b.jpg', photo_key: 'k_existing' },
        { uri: 'file:///c.jpg' },
      ],
      2
    );

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledWith('hh_01', ['file:///c.jpg']);
    expect(result.photos).toEqual([
      { photo_key: 'lf-blob/blob_abc123', blob: DESCRIPTOR },
      { photo_key: 'k_existing' },
      { photo_key: 'maintenance-photos/h1/new.jpg' },
    ]);
    expect(result.cover_photo_index).toBe(2);
  });
});

describe('blob photo keys', () => {
  it('namespaces the synthetic key by blob id', () => {
    expect(blobPhotoKey(DESCRIPTOR)).toBe('lf-blob/blob_abc123');
  });

  it('tells a synthetic key apart from an R2 key', () => {
    expect(isBlobPhotoKey(blobPhotoKey(DESCRIPTOR))).toBe(true);
    expect(isBlobPhotoKey('maintenance-photos/h1/a.jpg')).toBe(false);
    expect(isBlobPhotoKey(undefined)).toBe(false);
    expect(isBlobPhotoKey(null)).toBe(false);
  });
});
