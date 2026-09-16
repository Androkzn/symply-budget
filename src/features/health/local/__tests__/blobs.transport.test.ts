/**
 * He6 blob transport — the `/v2` wire contract (plan §8).
 *
 * The one Health-specific thing on this wire is the header, and it is the thing
 * most likely to be quietly dropped: `X-Health-Local-First` is armed globally by
 * `src/api/client.ts:71-84`, but **only for URLs starting `/health`**. Every
 * route here is `/v2/...`, and the upload half is a bare `XMLHttpRequest` that
 * never reaches an axios interceptor at all. So the header has to be spread by
 * hand on both halves, and the constant has to be the one from `sync/headers` —
 * a second spelling is a header that looks present and gates nothing.
 *
 * The rest mirrors House's H6 transport test, because the routes are the shared
 * fleet routes:
 *
 *  - chunk framing rides in **headers** (`X-LF-Chunk-Count`, `X-LF-Key-Epoch`),
 *    which is what lets the Worker store ciphertext without parsing a body;
 *  - uploads go through **`putUploadViaXhr`**, not `apiClient.put` —
 *    `households.ts:370` records that "axios in React Native does not reliably
 *    send a Blob as a raw binary body";
 *  - 507 quota, 409 incomplete and 404 missing become typed errors, because the
 *    retry policy differs for each and a caller that cannot tell them apart
 *    either retries a full account forever or shows "broken" for an upload that
 *    is simply still running.
 *
 * Static imports throughout (`await import()` throws under this Jest config).
 */
import { apiClient } from '@api/client';
import { HttpUploadError, putUploadViaXhr } from '@api/e2ePutUpload';

import {
  HealthBlobIncompleteError,
  HealthBlobMissingError,
  HealthBlobQuotaError,
  deleteRemoteHealthBlob,
  fetchHealthBlobChunk,
  fetchHealthBlobManifest,
  fetchHealthBlobUsage,
  finalizeHealthBlob,
  putHealthBlobChunk,
} from '../blobs/blobTransport';
import { HEALTH_LOCAL_FIRST_HEADER, HEALTH_LOCAL_FIRST_HEADERS } from '../sync/headers';

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

function httpError(status: number, data: unknown = null) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedPut.mockResolvedValue(undefined as never);
});

describe('putHealthBlobChunk', () => {
  const envelope = new Uint8Array([9, 8, 7, 6, 5]);

  async function put(): Promise<void> {
    await putHealthBlobChunk({
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
    expect(options.uploadUrl).toBe('https://api.test/v2/households/hh_1/blobs/blob_a/chunks/3');
    expect(options.contentType).toBe('application/octet-stream');
    expect(options.authorization).toBe('tok_test');
    expect(new Uint8Array(options.body as ArrayBuffer)).toEqual(envelope);
  });

  it('carries the chunk framing in headers, not the body', async () => {
    await put();
    expect(mockedPut.mock.calls[0]![0].headers).toEqual({
      ...HEALTH_LOCAL_FIRST_HEADERS,
      'X-LF-Chunk-Count': '5',
      'X-LF-Key-Epoch': '2',
    });
  });

  it('arms the Health local-first header by hand — the interceptor only covers /health', async () => {
    await put();
    const headers = mockedPut.mock.calls[0]![0].headers ?? {};
    expect(headers[HEALTH_LOCAL_FIRST_HEADER]).toBe('1');
    // Not a House header, and not a second spelling of the Health one.
    expect(Object.keys(headers)).not.toContain('X-House-Local-First');
  });

  it('turns a 507 into a typed quota error that must not be retried', async () => {
    mockedPut.mockRejectedValueOnce(
      new HttpUploadError('full', 507, 'quota_exceeded', {
        error: { code: 'quota_exceeded', limit: 5, used: 6 },
      }),
    );
    await expect(put()).rejects.toBeInstanceOf(HealthBlobQuotaError);
  });

  it('leaves any other upload failure alone, so it stays retryable', async () => {
    mockedPut.mockRejectedValueOnce(new HttpUploadError('bad gateway', 502, null, null));
    await expect(put()).rejects.toBeInstanceOf(HttpUploadError);
  });
});

describe('finalizeHealthBlob', () => {
  it('posts the chunk count and returns the manifest', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { blobId: 'blob_a', keyEpoch: 1, chunkCount: 2, cipherBytes: 10, status: 'complete' },
    });
    const manifest = await finalizeHealthBlob({
      householdId: 'hh_1',
      blobId: 'blob_a',
      chunkCount: 2,
    });
    expect(manifest.status).toBe('complete');
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/v2/households/hh_1/blobs/blob_a/finalize',
      { chunkCount: 2 },
      { headers: HEALTH_LOCAL_FIRST_HEADERS },
    );
  });
});

describe('fetchHealthBlobManifest', () => {
  it('answers null for a blob that is not there', async () => {
    mockedApi.get.mockRejectedValueOnce(httpError(404));
    await expect(fetchHealthBlobManifest('hh_1', 'blob_a')).resolves.toBeNull();
  });

  it('surfaces a 409 as "still uploading"', async () => {
    mockedApi.get.mockRejectedValueOnce(httpError(409));
    await expect(fetchHealthBlobManifest('hh_1', 'blob_a')).rejects.toBeInstanceOf(
      HealthBlobIncompleteError,
    );
  });

  it('rethrows anything else', async () => {
    mockedApi.get.mockRejectedValueOnce(httpError(500));
    await expect(fetchHealthBlobManifest('hh_1', 'blob_a')).rejects.toThrow('HTTP 500');
  });
});

describe('fetchHealthBlobChunk', () => {
  it('reads the chunk as bytes, not JSON', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: new Uint8Array([1, 2, 3]).buffer });
    await expect(fetchHealthBlobChunk('hh_1', 'blob_a', 0)).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(mockedApi.get).toHaveBeenCalledWith('/v2/households/hh_1/blobs/blob_a/chunks/0', {
      headers: HEALTH_LOCAL_FIRST_HEADERS,
      responseType: 'arraybuffer',
    });
  });

  it('separates "still uploading" (409) from "gone" (404)', async () => {
    mockedApi.get.mockRejectedValueOnce(httpError(409));
    await expect(fetchHealthBlobChunk('hh_1', 'blob_a', 0)).rejects.toBeInstanceOf(
      HealthBlobIncompleteError,
    );
    mockedApi.get.mockRejectedValueOnce(httpError(404));
    await expect(fetchHealthBlobChunk('hh_1', 'blob_a', 0)).rejects.toBeInstanceOf(
      HealthBlobMissingError,
    );
  });
});

describe('deleteRemoteHealthBlob', () => {
  it('treats an already-gone blob as success', async () => {
    mockedApi.delete.mockRejectedValueOnce(httpError(404));
    await expect(deleteRemoteHealthBlob('hh_1', 'blob_a')).resolves.toBeUndefined();
  });

  it('rethrows a real failure', async () => {
    mockedApi.delete.mockRejectedValueOnce(httpError(500));
    await expect(deleteRemoteHealthBlob('hh_1', 'blob_a')).rejects.toThrow('HTTP 500');
  });
});

describe('every /v2 call', () => {
  it('targets /v2 and carries exactly the Health local-first header', async () => {
    mockedApi.get.mockResolvedValue({ data: { blobCount: 0 } });
    mockedApi.post.mockResolvedValue({ data: {} });
    mockedApi.delete.mockResolvedValue({ data: {} });

    await fetchHealthBlobUsage('hh_1');
    await fetchHealthBlobManifest('hh_1', 'blob_a');
    await finalizeHealthBlob({ householdId: 'hh_1', blobId: 'blob_a', chunkCount: 1 });
    await deleteRemoteHealthBlob('hh_1', 'blob_a');

    const calls = [
      ...mockedApi.get.mock.calls,
      ...mockedApi.post.mock.calls,
      ...mockedApi.delete.mock.calls,
    ];
    expect(calls.length).toBe(4);
    for (const call of calls) {
      expect(String(call[0])).toMatch(/^\/v2\/households\//);
      const config = (call[call.length - 1] ?? {}) as { headers?: Record<string, string> };
      expect(config.headers?.[HEALTH_LOCAL_FIRST_HEADER]).toBe('1');
    }
  });
});
