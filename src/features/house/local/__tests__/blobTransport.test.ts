/**
 * H6 blob transport — the `/v2` wire contract (plan §8).
 *
 * Everything asserted here fails only in an end-to-end run if it is wrong, which
 * is the expensive place to find it:
 *
 *  - the chunk framing rides in **headers** (`X-LF-Chunk-Count`,
 *    `X-LF-Key-Epoch`). The Worker 400s without them, by design — that is what
 *    lets it store ciphertext without parsing a body.
 *  - uploads go through **`putUploadViaXhr`**, not `apiClient.put`. House already
 *    paid for this once: `households.ts:370` records that "axios in React Native
 *    does not reliably send a Blob as a raw binary body", and the H6 DoD asks for
 *    the encrypted channel to reuse that proven path rather than fork a third.
 *  - a **507 quota** rejection becomes a typed error, not a retryable transport
 *    failure. Retrying a full household forever is the failure mode this
 *    prevents.
 *
 * Static imports throughout (plan §6.2).
 */
import { apiClient } from '@api/client';
import { HttpUploadError, putUploadViaXhr } from '@api/e2ePutUpload';

import {
  HouseBlobIncompleteError,
  HouseBlobQuotaError,
  deleteRemoteBlob,
  fetchBlobChunk,
  fetchBlobManifest,
  fetchBlobUsage,
  finalizeBlob,
  putBlobChunk,
} from '../blobs/blobTransport';

jest.mock('@api/client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

// Only the XHR call is stubbed — `HttpUploadError` is the real class, so the
// `instanceof` narrowing in `blobTransport` is exercised rather than mimicked.
jest.mock('@api/e2ePutUpload', () => ({
  ...jest.requireActual('@api/e2ePutUpload'),
  putUploadViaXhr: jest.fn(),
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: { getState: () => ({ token: 'tok_test' }) },
}));

jest.mock('@config/env', () => ({ ENV: { API_BASE_URL: 'https://api.test' } }));

const mockedPut = putUploadViaXhr as jest.MockedFunction<typeof putUploadViaXhr>;
const mockedApi = apiClient as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};

function httpError(status: number, data: unknown) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedPut.mockResolvedValue(undefined as never);
});

describe('putBlobChunk', () => {
  const envelope = new Uint8Array([9, 8, 7, 6, 5]);

  async function put(): Promise<void> {
    await putBlobChunk({
      householdId: 'hh_1',
      blobId: 'blob_a',
      keyEpoch: 2,
      chunkIndex: 3,
      chunkCount: 5,
      envelope,
    });
  }

  it('PUTs raw octet-stream to the per-chunk route', async () => {
    await put();
    expect(mockedPut).toHaveBeenCalledTimes(1);
    const options = mockedPut.mock.calls[0]![0];
    expect(options.uploadUrl).toBe(
      'https://api.test/v2/households/hh_1/blobs/blob_a/chunks/3',
    );
    expect(options.contentType).toBe('application/octet-stream');
  });

  it('sends the chunk framing in headers, where the Worker reads it', async () => {
    await put();
    expect(mockedPut.mock.calls[0]![0].headers).toEqual({
      'X-House-Local-First': '1',
      'X-LF-Chunk-Count': '5',
      'X-LF-Key-Epoch': '2',
    });
  });

  it('sends exactly the chunk bytes, not the buffer behind them', async () => {
    // A staged read hands back a view into a larger buffer. Sending that view's
    // `.buffer` would upload everything after it too — silently, since the
    // Worker stores whatever arrives.
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await putBlobChunk({
      householdId: 'hh_1',
      blobId: 'blob_a',
      keyEpoch: 1,
      chunkIndex: 0,
      chunkCount: 1,
      envelope: backing.subarray(2, 5),
    });
    const body = mockedPut.mock.calls[0]![0].body as ArrayBuffer;
    expect(Array.from(new Uint8Array(body))).toEqual([3, 4, 5]);
  });

  it('authenticates with the current session token', async () => {
    await put();
    expect(mockedPut.mock.calls[0]![0].authorization).toBe('tok_test');
  });

  it('turns a quota rejection into a typed, non-retryable error', async () => {
    mockedPut.mockRejectedValueOnce(
      new HttpUploadError('Household attachment storage is full', 507, 'quota_exceeded', {
        error: { code: 'quota_exceeded', limit: 5_000, used: 4_999 },
      }),
    );
    const error = (await put().catch((e) => e)) as HouseBlobQuotaError;
    expect(error).toBeInstanceOf(HouseBlobQuotaError);
    expect(error.code).toBe('blob_quota_exceeded');
  });

  it('carries the limit and usage through, so Settings can show the number', async () => {
    mockedPut.mockRejectedValueOnce(
      new HttpUploadError('full', 507, 'quota_exceeded', {
        error: { code: 'quota_exceeded', limit: 5_000, used: 4_999 },
      }),
    );
    const error = (await put().catch((e) => e)) as HouseBlobQuotaError;
    expect({ limit: error.limitBytes, used: error.usedBytes }).toEqual({
      limit: 5_000,
      used: 4_999,
    });
  });

  it('rethrows an ordinary transport failure unchanged, so the caller can retry', async () => {
    const boom = new HttpUploadError('relay unavailable', 502, null, null);
    mockedPut.mockRejectedValueOnce(boom);
    await expect(put()).rejects.toBe(boom);
  });
});

describe('reads', () => {
  it('fetches a chunk as an arraybuffer, not JSON', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: new Uint8Array([1, 2, 3]).buffer });
    const bytes = await fetchBlobChunk('hh_1', 'blob_a', 2);

    expect(mockedApi.get).toHaveBeenCalledWith(
      '/v2/households/hh_1/blobs/blob_a/chunks/2',
      expect.objectContaining({ responseType: 'arraybuffer' }),
    );
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('surfaces "still uploading" distinctly from "gone"', async () => {
    mockedApi.get.mockRejectedValueOnce(httpError(409, { error: { code: 'incomplete' } }));
    await expect(fetchBlobChunk('hh_1', 'blob_a', 0)).rejects.toBeInstanceOf(
      HouseBlobIncompleteError,
    );
  });

  it('returns null for a manifest that is gone, rather than throwing', async () => {
    mockedApi.get.mockRejectedValueOnce(httpError(404, { error: { code: 'not_found' } }));
    await expect(fetchBlobManifest('hh_1', 'blob_a')).resolves.toBeNull();
  });

  it('reads the household quota rollup', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { blobCount: 2, cipherBytes: 10, softLimitBytes: 20, hardLimitBytes: 30, overSoftLimit: false },
    });
    await expect(fetchBlobUsage('hh_1')).resolves.toMatchObject({ blobCount: 2 });
    expect(mockedApi.get).toHaveBeenCalledWith(
      '/v2/households/hh_1/blobs-usage',
      expect.anything(),
    );
  });
});

describe('finalize and delete', () => {
  it('finalizes with the chunk count', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { blobId: 'blob_a', status: 'complete' } });
    await finalizeBlob({ householdId: 'hh_1', blobId: 'blob_a', chunkCount: 4 });
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/v2/households/hh_1/blobs/blob_a/finalize',
      { chunkCount: 4 },
      expect.anything(),
    );
  });

  it('treats an already-deleted blob as success — the end state is what matters', async () => {
    mockedApi.delete.mockRejectedValueOnce(httpError(404, { error: { code: 'not_found' } }));
    await expect(deleteRemoteBlob('hh_1', 'blob_a')).resolves.toBeUndefined();
  });

  it('rethrows a real delete failure', async () => {
    mockedApi.delete.mockRejectedValueOnce(httpError(500, {}));
    await expect(deleteRemoteBlob('hh_1', 'blob_a')).rejects.toThrow();
  });

  it('sends the House local-first header on every call', async () => {
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    await deleteRemoteBlob('hh_1', 'blob_a');
    expect(mockedApi.delete).toHaveBeenCalledWith(
      '/v2/households/hh_1/blobs/blob_a',
      { headers: { 'X-House-Local-First': '1' } },
    );
  });
});
