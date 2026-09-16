import * as SecureStore from 'expo-secure-store';

import { ENV } from '@config/env';
import { dropboxService } from '@services/cloud-storage/dropbox';
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
  makeRedirectUri: jest.fn(() => 'symply://oauth/dropbox'),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  downloadAsync: jest.fn(),
}));
jest.mock('@config/env', () => ({ ENV: { DROPBOX_APP_KEY: 'test-app-key' } }));

const mockGetItem = SecureStore.getItemAsync as jest.Mock;
const mockDeleteItem = SecureStore.deleteItemAsync as jest.Mock;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this;
    },
  } as unknown as Response;
}

function errorResponse(status: number, body: string): Response {
  const res = {
    ok: false,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
    clone() {
      return res;
    },
  };
  return res as unknown as Response;
}

const urlOf = (call: number) => String((global.fetch as jest.Mock).mock.calls[call][0]);
const initOf = (call: number) => (global.fetch as jest.Mock).mock.calls[call][1] as RequestInit;
const headerOf = (call: number, name: string) =>
  (initOf(call).headers as Record<string, string>)[name];

describe('dropboxService — backup upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    mockGetItem.mockResolvedValue(
      JSON.stringify({
        isAuthenticated: true,
        accessToken: 'token-123',
        refreshToken: 'refresh-123',
        expiresAt: Date.now() + 60_000,
      }),
    );
  });

  describe('isConfigured', () => {
    it('is true when the brand supplies an app key', () => {
      expect(dropboxService.isConfigured!()).toBe(true);
    });

    it('is false when the app key is absent, so the UI can hide Dropbox', () => {
      // The mocked ENV is a plain object, so assign rather than spy on a getter.
      const mutableEnv = ENV as unknown as { DROPBOX_APP_KEY: string };
      const original = mutableEnv.DROPBOX_APP_KEY;
      mutableEnv.DROPBOX_APP_KEY = '';
      try {
        expect(dropboxService.isConfigured!()).toBe(false);
      } finally {
        mutableEnv.DROPBOX_APP_KEY = original;
      }
    });
  });

  describe('ensureFolder', () => {
    it('reuses a remembered folder path that still resolves', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ '.tag': 'folder' }));

      const path = await dropboxService.ensureFolder!('Symply Budget Backups', '/my vault');

      expect(path).toBe('/my vault');
      expect(urlOf(0)).toContain('/2/files/get_metadata');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to creating by name when the remembered path is now a file', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(jsonResponse({ '.tag': 'file' }))
        .mockResolvedValueOnce(jsonResponse({ metadata: { path_lower: '/backups' } }));

      const path = await dropboxService.ensureFolder!('Backups', '/gone');

      expect(path).toBe('/Backups');
      expect(urlOf(1)).toContain('/2/files/create_folder_v2');
    });

    it('creates the folder when nothing is remembered', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ metadata: {} }));

      const path = await dropboxService.ensureFolder!('Symply Budget Backups');

      expect(path).toBe('/Symply Budget Backups');
      expect(JSON.parse(String(initOf(0).body))).toEqual({
        path: '/Symply Budget Backups',
        autorename: false,
      });
    });

    it('treats an existing-folder conflict as success', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        errorResponse(409, '{"error_summary":"path/conflict/folder/..."}'),
      );

      await expect(dropboxService.ensureFolder!('Backups')).resolves.toBe('/Backups');
    });

    it('normalises a name with stray slashes into one clean path', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ metadata: {} }));

      await dropboxService.ensureFolder!('/Backups/');

      expect(JSON.parse(String(initOf(0).body)).path).toBe('/Backups');
    });
  });

  describe('uploadFile', () => {
    it('sends the archive as the body with upload params in the API header', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        jsonResponse({
          name: 'backup.json',
          path_lower: '/backups/backup.json',
          path_display: '/Backups/backup.json',
          size: 42,
          server_modified: '2026-08-11T09:15:00Z',
        }),
      );

      const uploaded = await dropboxService.uploadFile!({
        name: 'backup.json',
        content: '{"sealed":true}',
        folderId: '/Backups',
      });

      expect(urlOf(0)).toBe('https://content.dropboxapi.com/2/files/upload');
      expect(headerOf(0, 'Content-Type')).toBe('application/octet-stream');
      expect(headerOf(0, 'Authorization')).toBe('Bearer token-123');
      expect(initOf(0).body).toBe('{"sealed":true}');

      const apiArg = JSON.parse(headerOf(0, 'Dropbox-API-Arg'));
      expect(apiArg.path).toBe('/Backups/backup.json');
      // autorename so a same-named archive never silently clobbers an older one.
      expect(apiArg.autorename).toBe(true);

      expect(uploaded).toEqual({
        id: '/backups/backup.json',
        name: 'backup.json',
        mimeType: 'application/json',
        size: 42,
        modifiedTime: '2026-08-11T09:15:00Z',
        path: '/Backups/backup.json',
      });
    });

    it('derives the path from folderName when no id is known', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ name: 'b.json' }));

      await dropboxService.uploadFile!({
        name: 'b.json',
        content: '{}',
        folderName: 'Symply Budget Backups',
      });

      expect(JSON.parse(headerOf(0, 'Dropbox-API-Arg')).path).toBe(
        '/Symply Budget Backups/b.json',
      );
    });

    it('clears the grant and asks for reconnect on 401', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(errorResponse(401, '{"error":"expired"}'));

      await expect(
        dropboxService.uploadFile!({ name: 'b.json', content: '{}' }),
      ).rejects.toBeInstanceOf(CloudReauthRequiredError);
      expect(mockDeleteItem).toHaveBeenCalledWith('dropbox_auth');
    });

    it('asks for reconnect when the grant lacks the write scope', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        errorResponse(403, '{"error_summary":"missing_scope/..."}'),
      );

      await expect(
        dropboxService.uploadFile!({ name: 'b.json', content: '{}' }),
      ).rejects.toBeInstanceOf(CloudReauthRequiredError);
    });

    it('keeps a quota failure as a plain error and leaves the grant alone', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        errorResponse(507, '{"error_summary":"insufficient_space/..."}'),
      );

      await expect(
        dropboxService.uploadFile!({ name: 'b.json', content: '{}' }),
      ).rejects.not.toBeInstanceOf(CloudReauthRequiredError);
      expect(mockDeleteItem).not.toHaveBeenCalled();
    });

    it('refuses to upload with no stored grant', async () => {
      mockGetItem.mockResolvedValue(null);

      await expect(
        dropboxService.uploadFile!({ name: 'b.json', content: '{}' }),
      ).rejects.toThrow('Not authenticated');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('refreshes an expired token using PKCE (no client secret on the wire)', async () => {
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
        .mockResolvedValueOnce(jsonResponse({ name: 'b.json' }));

      await dropboxService.uploadFile!({ name: 'b.json', content: '{}' });

      expect(urlOf(0)).toContain('oauth2/token');
      const refreshBody = String(initOf(0).body);
      expect(refreshBody).toContain('client_id=test-app-key');
      // A Basic header would mean a shipped client secret — it must be gone.
      expect(headerOf(0, 'Authorization')).toBeUndefined();
      expect(refreshBody).not.toContain('client_secret');
      expect(headerOf(1, 'Authorization')).toBe('Bearer fresh');
    });
  });

  describe('deleteFile', () => {
    it('deletes by path', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ metadata: {} }));

      await dropboxService.deleteFile!('/Backups/old.json');

      expect(urlOf(0)).toContain('/2/files/delete_v2');
      expect(JSON.parse(String(initOf(0).body))).toEqual({ path: '/Backups/old.json' });
    });

    it('treats an already-deleted file as success', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        errorResponse(409, '{"error_summary":"path_lookup/not_found/..."}'),
      );

      await expect(dropboxService.deleteFile!('/Backups/gone.json')).resolves.toBeUndefined();
    });
  });
});
