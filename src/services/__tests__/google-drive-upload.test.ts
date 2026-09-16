import * as SecureStore from 'expo-secure-store';

import { googleDriveService } from '@services/cloud-storage/google-drive';
import { CloudReauthRequiredError } from '@services/cloud-storage/types';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-auth-session', () => ({
  AuthRequest: jest.fn(),
  ResponseType: { Code: 'code' },
  makeRedirectUri: jest.fn(() => 'redirect://'),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  downloadAsync: jest.fn(),
}));
jest.mock('@config/env', () => ({
  ENV: {
    GOOGLE_DRIVE_OAUTH: {
      IOS_CLIENT_ID: 'ios-client.apps.googleusercontent.com',
      ANDROID_CLIENT_ID: 'android-client.apps.googleusercontent.com',
      WEB_CLIENT_ID: 'web-client.apps.googleusercontent.com',
    },
  },
}));

const mockGetItem = SecureStore.getItemAsync as jest.Mock;
const mockDeleteItem = SecureStore.deleteItemAsync as jest.Mock;

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response;
}

/** URL of the nth fetch call. */
function urlOf(call: number): string {
  return String((global.fetch as jest.Mock).mock.calls[call][0]);
}

function initOf(call: number): RequestInit {
  return (global.fetch as jest.Mock).mock.calls[call][1] as RequestInit;
}

describe('googleDriveService — backup upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    // A live, unexpired grant.
    mockGetItem.mockResolvedValue(
      JSON.stringify({
        isAuthenticated: true,
        accessToken: 'token-123',
        refreshToken: 'refresh-123',
        expiresAt: Date.now() + 60_000,
      }),
    );
  });

  describe('ensureFolder', () => {
    it('reuses a remembered folder id without touching the name query', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        jsonResponse({ id: 'folder-1', mimeType: FOLDER_MIME, trashed: false }),
      );

      const id = await googleDriveService.ensureFolder!('Symply Budget Backups', 'folder-1');

      expect(id).toBe('folder-1');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(urlOf(0)).toContain('/drive/v3/files/folder-1');
    });

    it('falls back to the name lookup when the remembered folder is trashed', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(jsonResponse({ id: 'folder-1', mimeType: FOLDER_MIME, trashed: true }))
        .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder-2', name: 'Backups' }] }));

      const id = await googleDriveService.ensureFolder!('Backups', 'folder-1');

      expect(id).toBe('folder-2');
      expect(new URL(urlOf(1)).searchParams.get('q')).toContain("name='Backups'");
    });

    it('falls back to the name lookup when the remembered id no longer resolves', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(errorResponse(404, '{"error":{"code":404}}'))
        .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder-2', name: 'Backups' }] }));

      await expect(googleDriveService.ensureFolder!('Backups', 'gone')).resolves.toBe('folder-2');
    });

    it('rejects a remembered id that now points at a plain file, not a folder', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(
          jsonResponse({ id: 'folder-1', mimeType: 'application/json', trashed: false }),
        )
        .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder-2', name: 'Backups' }] }));

      await expect(googleDriveService.ensureFolder!('Backups', 'folder-1')).resolves.toBe(
        'folder-2',
      );
    });

    it('creates the folder when neither the id nor the name exists', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(jsonResponse({ files: [] }))
        .mockResolvedValueOnce(jsonResponse({ id: 'folder-new' }));

      const id = await googleDriveService.ensureFolder!('Symply Budget Backups');

      expect(id).toBe('folder-new');
      expect(initOf(1).method).toBe('POST');
      expect(JSON.parse(String(initOf(1).body))).toEqual({
        name: 'Symply Budget Backups',
        mimeType: FOLDER_MIME,
      });
    });

    it('escapes quotes in the folder name so the query cannot be broken', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(jsonResponse({ files: [] }))
        .mockResolvedValueOnce(jsonResponse({ id: 'folder-new' }));

      await googleDriveService.ensureFolder!("Andrei's Backups");

      // searchParams (not decodeURIComponent) — the query is form-encoded, so
      // spaces arrive as `+`.
      const query = new URL(urlOf(0)).searchParams.get('q');
      expect(query).toContain("name='Andrei\\'s Backups'");
    });
  });

  describe('uploadFile', () => {
    it('posts a multipart body carrying the metadata and the archive', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        jsonResponse({
          id: 'file-1',
          name: 'backup.json',
          mimeType: 'application/json',
          size: '42',
          modifiedTime: '2026-08-11T09:15:00Z',
        }),
      );

      const uploaded = await googleDriveService.uploadFile!({
        name: 'backup.json',
        content: '{"sealed":true}',
        folderId: 'folder-1',
      });

      expect(urlOf(0)).toContain('/upload/drive/v3/files?uploadType=multipart');
      const init = initOf(0);
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-123');
      expect((init.headers as Record<string, string>)['Content-Type']).toMatch(
        /^multipart\/related; boundary=/,
      );

      const body = String(init.body);
      expect(body).toContain('"name":"backup.json"');
      expect(body).toContain('"parents":["folder-1"]');
      expect(body).toContain('{"sealed":true}');
      // Parts are CRLF-delimited and the body is closed off — Drive rejects
      // a multipart payload missing the terminating boundary.
      expect(body).toContain('\r\n');
      expect(body.trimEnd().endsWith('--')).toBe(true);

      expect(uploaded).toEqual({
        id: 'file-1',
        name: 'backup.json',
        mimeType: 'application/json',
        size: 42,
        modifiedTime: '2026-08-11T09:15:00Z',
      });
    });

    it('prefers a known folder id over a name lookup', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ id: 'f', name: 'b.json' }));

      await googleDriveService.uploadFile!({
        name: 'b.json',
        content: '{}',
        folderId: 'folder-1',
        folderName: 'Ignored',
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(String(initOf(0).body)).toContain('"parents":["folder-1"]');
    });

    it('resolves the folder by name when no id is known', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder-9' }] }))
        .mockResolvedValueOnce(jsonResponse({ id: 'f', name: 'b.json' }));

      await googleDriveService.uploadFile!({
        name: 'b.json',
        content: '{}',
        folderName: 'Symply Budget Backups',
      });

      expect(String(initOf(1).body)).toContain('"parents":["folder-9"]');
    });

    it('uploads to the account root when neither id nor name is given', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ id: 'f', name: 'b.json' }));

      await googleDriveService.uploadFile!({ name: 'b.json', content: '{}' });

      expect(String(initOf(0).body)).not.toContain('parents');
    });

    it('clears the grant and asks for reconnect on 401', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        errorResponse(401, '{"error":"invalid_grant"}'),
      );

      await expect(
        googleDriveService.uploadFile!({ name: 'b.json', content: '{}' }),
      ).rejects.toBeInstanceOf(CloudReauthRequiredError);
      expect(mockDeleteItem).toHaveBeenCalledWith('google_drive_auth');
    });

    it('asks for reconnect when the grant predates the write scope', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        errorResponse(403, '{"error":{"message":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}}'),
      );

      await expect(
        googleDriveService.uploadFile!({ name: 'b.json', content: '{}' }),
      ).rejects.toBeInstanceOf(CloudReauthRequiredError);
      expect(mockDeleteItem).toHaveBeenCalledWith('google_drive_auth');
    });

    it('keeps a non-auth failure as a plain error and leaves the grant alone', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        errorResponse(403, '{"error":{"message":"storageQuotaExceeded"}}'),
      );

      await expect(
        googleDriveService.uploadFile!({ name: 'b.json', content: '{}' }),
      ).rejects.not.toBeInstanceOf(CloudReauthRequiredError);
      expect(mockDeleteItem).not.toHaveBeenCalled();
    });

    it('refuses to upload with no stored grant', async () => {
      mockGetItem.mockResolvedValue(null);

      await expect(
        googleDriveService.uploadFile!({ name: 'b.json', content: '{}' }),
      ).rejects.toThrow('Not authenticated');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('refreshes an expired token before uploading', async () => {
      mockGetItem.mockResolvedValue(
        JSON.stringify({
          isAuthenticated: true,
          accessToken: 'stale',
          refreshToken: 'refresh-123',
          expiresAt: Date.now() - 1_000,
        }),
      );
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(jsonResponse({ access_token: 'fresh', expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse({ id: 'f', name: 'b.json' }));

      await googleDriveService.uploadFile!({ name: 'b.json', content: '{}' });

      expect(urlOf(0)).toContain('oauth2.googleapis.com/token');
      expect((initOf(1).headers as Record<string, string>).Authorization).toBe('Bearer fresh');
    });
  });

  /**
   * The callers act on `false` by FORGETTING the folder the member picked and
   * starting a new one at the account root. So `false` has to mean "Drive said
   * it is gone", never "I could not ask" — one flaky probe used to be enough to
   * quietly move every later backup out of the chosen folder.
   */
  describe('folderExists', () => {
    it('is true for a live folder', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        jsonResponse({ id: 'folder-1', mimeType: FOLDER_MIME, trashed: false }),
      );

      await expect(googleDriveService.folderExists!('folder-1')).resolves.toBe(true);
      expect(urlOf(0)).toContain('/drive/v3/files/folder-1');
    });

    it('is false once the folder is in the trash', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        jsonResponse({ id: 'folder-1', mimeType: FOLDER_MIME, trashed: true }),
      );

      await expect(googleDriveService.folderExists!('folder-1')).resolves.toBe(false);
    });

    it('is false when the id now points at a plain file', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        jsonResponse({ id: 'folder-1', mimeType: 'application/json', trashed: false }),
      );

      await expect(googleDriveService.folderExists!('folder-1')).resolves.toBe(false);
    });

    it('is false when Drive answers 404 — the one definite "gone"', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        errorResponse(404, '{"error":{"code":404,"message":"File not found: folder-1."}}'),
      );

      await expect(googleDriveService.folderExists!('folder-1')).resolves.toBe(false);
    });

    it('throws — never false — when the request itself fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));

      await expect(googleDriveService.folderExists!('folder-1')).rejects.toThrow(
        'Network request failed',
      );
    });

    it('throws — never false — on a provider error that says nothing about the folder', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        errorResponse(500, '{"error":{"code":500,"message":"Backend Error"}}'),
      );

      const probe = googleDriveService.folderExists!('folder-1');
      await expect(probe).rejects.toThrow('Failed to check folder');
      await expect(probe).rejects.not.toBeInstanceOf(CloudReauthRequiredError);
      expect(mockDeleteItem).not.toHaveBeenCalled();
    });

    it('asks for reconnect on 401 rather than calling the folder gone', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        errorResponse(401, '{"error":"invalid_grant"}'),
      );

      await expect(googleDriveService.folderExists!('folder-1')).rejects.toBeInstanceOf(
        CloudReauthRequiredError,
      );
      expect(mockDeleteItem).toHaveBeenCalledWith('google_drive_auth');
    });

    it('throws with no stored grant instead of reporting the folder gone', async () => {
      mockGetItem.mockResolvedValue(null);

      await expect(googleDriveService.folderExists!('folder-1')).rejects.toThrow(
        'Not authenticated',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
