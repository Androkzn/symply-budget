/**
 * `healthAssetsApi` — user FILES (R2) and WIDGET preference/snapshot client.
 *
 * Six deployed handlers and three widget routes had zero callers before this
 * module shipped. This file proves the runtime contract the header documents:
 *
 *  - `uploadFileBytes` PUTs through `apiClient` (never a bare XHR) to a
 *    RELATIVE path, with `transformRequest` as the identity function so axios
 *    does not try to JSON-encode the raw bytes.
 *  - `saveWidgetPreferences` is a PATCH-style partial body, never the whole
 *    preferences object.
 *  - `healthFileContentSource` returns null with no session (never an
 *    unauthenticated request that can only 401) and otherwise carries the
 *    bearer token as a per-request header, because there is no public URL for
 *    a health file.
 */

jest.mock('../client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

let mockToken: string | null = 'tok_abc123';
jest.mock('@stores/authStore', () => ({
  useAuthStore: { getState: () => ({ token: mockToken }) },
}));

jest.mock('@config/env', () => ({
  ENV: { API_BASE_URL: 'https://api.symply.test' },
}));

import { apiClient } from '../client';
import {
  healthAssetsApi,
  healthFileContentSource,
  HEALTH_FILE_MAX_BYTES,
  HEALTH_FILE_MIME_TYPES,
} from '../healthAssets';

const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;
const mockPut = apiClient.put as jest.Mock;
const mockDelete = apiClient.delete as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockToken = 'tok_abc123';
});

describe('constants the picker/upload path relies on', () => {
  it('50MB cap mirrors the server MAX_FILE_BYTES', () => {
    expect(HEALTH_FILE_MAX_BYTES).toBe(50 * 1024 * 1024);
  });

  it('body_photo shares the same allow-list as photo (both are images)', () => {
    expect(HEALTH_FILE_MIME_TYPES.body_photo).toEqual(HEALTH_FILE_MIME_TYPES.photo);
    expect(HEALTH_FILE_MIME_TYPES.document).toContain('application/pdf');
  });
});

describe('files', () => {
  it('listFiles GETs /health/files with the optional filters as params', async () => {
    mockGet.mockResolvedValue({ data: { files: [] } });
    await healthAssetsApi.listFiles({ file_type: 'body_photo', limit: 50 });
    expect(mockGet).toHaveBeenCalledWith('/health/files', {
      params: { file_type: 'body_photo', limit: 50 },
    });
  });

  it('getFile GETs the single-file route', async () => {
    mockGet.mockResolvedValue({ data: { file: {} } });
    await healthAssetsApi.getFile('file_1');
    expect(mockGet).toHaveBeenCalledWith('/health/files/file_1');
  });

  it('createFile POSTs the reservation body and returns the upload descriptor', async () => {
    const reservation = {
      file: { id: 'f1' },
      upload: { upload_url: null, method: 'PUT', path: '/health/files/f1/content', max_size_bytes: 100 },
    };
    mockPost.mockResolvedValue({ data: reservation });
    const body = { file_name: 'x.jpg', file_type: 'photo' as const, mime_type: 'image/jpeg', file_size: 100 };

    const result = await healthAssetsApi.createFile(body);

    expect(mockPost).toHaveBeenCalledWith('/health/files', body);
    // The relative path — never a public/presigned URL — is what the caller
    // must PUT the bytes to next.
    expect(result.upload.upload_url).toBeNull();
    expect(result.upload.path).toBe('/health/files/f1/content');
  });

  it('uploadFileBytes PUTs through apiClient to the RELATIVE path, with an identity transformRequest', async () => {
    mockPut.mockResolvedValue({ data: { file: {} } });
    const bytes = new ArrayBuffer(8);

    await healthAssetsApi.uploadFileBytes('/health/files/f1/content', bytes, 'image/jpeg');

    expect(mockPut).toHaveBeenCalledTimes(1);
    const [path, body, options] = mockPut.mock.calls[0];
    expect(path).toBe('/health/files/f1/content');
    expect(body).toBe(bytes);
    expect(options.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    // The identity function — axios would otherwise try to JSON.stringify the
    // Blob/ArrayBuffer and send `{}`.
    expect(typeof options.transformRequest[0]).toBe('function');
    expect(options.transformRequest[0]('unchanged')).toBe('unchanged');
  });

  it('deleteFile DELETEs the file route', async () => {
    mockDelete.mockResolvedValue({ data: { deleted: true } });
    const result = await healthAssetsApi.deleteFile('f1');
    expect(mockDelete).toHaveBeenCalledWith('/health/files/f1');
    expect(result.deleted).toBe(true);
  });
});

describe('widget preferences', () => {
  it('getWidgetPreferences GETs the preferences route', async () => {
    mockGet.mockResolvedValue({ data: { preferences: {} } });
    await healthAssetsApi.getWidgetPreferences();
    expect(mockGet).toHaveBeenCalledWith('/health/widget/preferences');
  });

  it('saveWidgetPreferences PUTs ONLY the given patch — never the whole preferences object', async () => {
    mockPut.mockResolvedValue({ data: { preferences: {} } });
    await healthAssetsApi.saveWidgetPreferences({ show_weight: false });
    expect(mockPut).toHaveBeenCalledWith('/health/widget/preferences', { show_weight: false });
    expect(Object.keys(mockPut.mock.calls[0][1])).toEqual(['show_weight']);
  });

  it('getWidgetSnapshot omits params with no date, and sends the CLIENT-local date when given', async () => {
    mockGet.mockResolvedValue({ data: { snapshot: {} } });
    await healthAssetsApi.getWidgetSnapshot();
    expect(mockGet).toHaveBeenCalledWith('/health/widget/snapshot', { params: undefined });

    await healthAssetsApi.getWidgetSnapshot('2026-07-26');
    expect(mockGet).toHaveBeenCalledWith('/health/widget/snapshot', { params: { date: '2026-07-26' } });
  });
});

describe('healthFileContentSource', () => {
  it('returns null with no session — never fires an unauthenticated request', () => {
    mockToken = null;
    expect(healthFileContentSource('/health/files/f1/content')).toBeNull();
  });

  it('returns null for an empty content path even with a session', () => {
    expect(healthFileContentSource('')).toBeNull();
  });

  it('builds the full URL with the bearer token as a per-request header, never in the URL itself', () => {
    const source = healthFileContentSource('/health/files/f1/content');
    expect(source).toEqual({
      uri: 'https://api.symply.test/health/files/f1/content',
      headers: { Authorization: 'Bearer tok_abc123' },
    });
    expect(source?.uri).not.toContain('tok_abc123');
  });
});
