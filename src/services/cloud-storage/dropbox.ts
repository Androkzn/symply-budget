// Dropbox Service
// Uses OAuth2 with expo-auth-session and Dropbox API

import * as AuthSession from 'expo-auth-session';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { ENV } from '@config/env';

import { CloudReauthRequiredError } from './types';
import type {
  CloudStorageService,
  CloudAuthState,
  CloudFile,
  CloudUploadRequest,
} from './types';

// Helper to get document directory with type safety
const getDocumentDirectory = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (FileSystem as any).documentDirectory || '';
};

// (A hand-rolled base64 helper lived here to build the Basic auth header for
// the confidential-client token exchange. PKCE removed that call site, and with
// it the need to ship a client secret at all.)

// Complete auth session for web browser
WebBrowser.maybeCompleteAuthSession();

// Dropbox OAuth Configuration
// Set up at https://www.dropbox.com/developers/apps:
// 1. Create app → "Scoped access" → "App folder" (narrowest — the app only ever
//    sees its own folder, matching Google Drive's `drive.file`).
// 2. Permissions tab: files.content.write + files.content.read.
// 3. Add the redirect URI (see `getRedirectUri` below).
// 4. Put the App key in the brand's `integrations.dropbox.appKey`.
//
// PKCE only — no client secret. A secret shipped inside a mobile binary is
// readable by anyone who unzips the IPA, and Dropbox's PKCE flow does not need
// one for either the code exchange or the refresh.
//
// Read the key lazily (never at module init): ENV's brand-backed getters can be
// mid-initialization under a circular import.
function getAppKey(): string {
  // Coalesce: a brand config (or a partially-stubbed ENV) without the Dropbox
  // block must read as "not configured", never crash the caller — `isConfigured`
  // is called during render to decide whether to show the destination at all.
  return ENV.DROPBOX_APP_KEY ?? '';
}

/** Folder-scoped write + read. Requested explicitly so consent is legible. */
const DROPBOX_SCOPES = ['files.content.write', 'files.content.read', 'account_info.read'];

const STORAGE_KEY = 'dropbox_auth';

// Dropbox OAuth endpoints
const discovery = {
  authorizationEndpoint: 'https://www.dropbox.com/oauth2/authorize',
  tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
  revocationEndpoint: 'https://api.dropboxapi.com/2/auth/token/revoke',
};

async function saveAuthState(state: CloudAuthState): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(state));
}

async function loadAuthState(): Promise<CloudAuthState | null> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Error loading Dropbox auth state:', error);
  }
  return null;
}

async function clearAuthState(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}

async function refreshAccessToken(refreshToken: string): Promise<CloudAuthState | null> {
  try {
    const response = await fetch(discovery.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      // PKCE public client: authenticate with client_id in the body, not a
      // Basic header built from a secret we deliberately do not ship.
      body: new URLSearchParams({
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        client_id: getAppKey(),
      }).toString(),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh token');
    }

    const data = await response.json();
    const newState: CloudAuthState = {
      isAuthenticated: true,
      accessToken: data.access_token,
      refreshToken: refreshToken,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };

    await saveAuthState(newState);
    return newState;
  } catch (error) {
    console.error('Error refreshing Dropbox token:', error);
    return null;
  }
}

function getRedirectUri(): string {
  // Brand-neutral: every Symply app registers its own scheme, so deriving it
  // here (rather than hardcoding `simplehouse`) keeps Budget/Kaizen/Health from
  // bouncing the callback into House.
  return AuthSession.makeRedirectUri({ path: 'oauth/dropbox' });
}

/** Stored access token, refreshed first when expired. */
async function getAccessToken(): Promise<string> {
  let state = await loadAuthState();

  if (!state?.accessToken) {
    throw new Error('Not authenticated');
  }

  if (state.expiresAt && Date.now() >= state.expiresAt && state.refreshToken) {
    state = await refreshAccessToken(state.refreshToken);
    if (!state?.accessToken) {
      throw new Error('Failed to refresh authentication');
    }
  }

  return state.accessToken;
}

/**
 * Maps a failed Dropbox response to a friendly re-auth error. 401 means the
 * grant is dead; Dropbox also answers a missing/insufficient scope with 401
 * plus an `invalid_access_token` / `missing_scope` body. Anything else keeps
 * the raw text for logs — callers map it to generic copy before display.
 */
async function throwFriendlyDropboxError(response: Response, context: string): Promise<never> {
  const body = await response.text();

  if (response.status === 401 || /missing_scope|invalid_access_token/i.test(body)) {
    await clearAuthState();
    throw new CloudReauthRequiredError(
      'Your Dropbox access needs to be renewed. Please reconnect.'
    );
  }

  throw new Error(`${context}: ${body}`);
}

/** Dropbox is path-addressed — normalise a folder name into an absolute path. */
function toFolderPath(name: string): string {
  const trimmed = name.trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

async function getUserInfo(accessToken: string): Promise<{ email: string; name: string } | null> {
  try {
    const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    const data = await response.json();
    return {
      email: data.email,
      name: data.name?.display_name || data.email,
    };
  } catch (error) {
    console.error('Error getting Dropbox user info:', error);
    return null;
  }
}

export const dropboxService: CloudStorageService = {
  provider: 'dropbox',

  async isAuthenticated(): Promise<boolean> {
    const state = await loadAuthState();
    if (!state?.accessToken) {
      return false;
    }

    // Check if token is expired
    if (state.expiresAt && Date.now() >= state.expiresAt) {
      // Try to refresh
      if (state.refreshToken) {
        const newState = await refreshAccessToken(state.refreshToken);
        return !!newState?.accessToken;
      }
      return false;
    }

    return true;
  },

  async authenticate(): Promise<CloudAuthState> {
    const appKey = getAppKey();
    if (!appKey) {
      throw new Error(
        'Dropbox is not set up in this build. Add the app key to the brand config to enable it.'
      );
    }

    const redirectUri = getRedirectUri();

    const request = new AuthSession.AuthRequest({
      clientId: appKey,
      scopes: DROPBOX_SCOPES,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      extraParams: {
        token_access_type: 'offline', // Request refresh token
      },
    });

    const result = await request.promptAsync(discovery);

    if (result.type === 'success' && result.params.code) {
      // Exchange code for tokens
      const tokenResponse = await fetch(discovery.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code: result.params.code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          client_id: appKey,
          code_verifier: request.codeVerifier || '',
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        throw new Error(`Failed to exchange code: ${error}`);
      }

      const tokenData = await tokenResponse.json();
      
      const userInfo = await getUserInfo(tokenData.access_token);

      const authState: CloudAuthState = {
        isAuthenticated: true,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || null,
        expiresAt: tokenData.expires_in 
          ? Date.now() + (tokenData.expires_in * 1000) 
          : null, // Dropbox tokens may not expire
        userEmail: userInfo?.email,
        userName: userInfo?.name,
      };

      await saveAuthState(authState);
      return authState;
    }

    if (result.type === 'cancel') {
      throw new Error('Authentication was cancelled');
    }

    throw new Error('Authentication failed');
  },

  async logout(): Promise<void> {
    const state = await loadAuthState();
    
    if (state?.accessToken) {
      // Revoke the token
      try {
        await fetch(discovery.revocationEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${state.accessToken}`,
          },
        });
      } catch (error) {
        console.error('Error revoking Dropbox token:', error);
      }
    }

    await clearAuthState();
  },

  async getAuthState(): Promise<CloudAuthState | null> {
    return loadAuthState();
  },

  async listFiles(folderId?: string, mimeTypeFilter?: string): Promise<CloudFile[]> {
    let state = await loadAuthState();
    
    if (!state?.accessToken) {
      throw new Error('Not authenticated');
    }

    // Refresh token if expired
    if (state.expiresAt && Date.now() >= state.expiresAt && state.refreshToken) {
      state = await refreshAccessToken(state.refreshToken);
      if (!state?.accessToken) {
        throw new Error('Failed to refresh authentication');
      }
    }

    const path = folderId || '';
    
    const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: path === '' ? '' : path,
        recursive: false,
        include_media_info: true,
        include_deleted: false,
        include_has_explicit_shared_members: false,
        include_mounted_folders: true,
        limit: 100,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list files: ${error}`);
    }

    const data = await response.json();

    // Filter and map files
    let files = (data.entries || [])
      .filter((entry: any) => entry['.tag'] === 'file' || entry['.tag'] === 'folder')
      .map((entry: any) => {
        const isFolder = entry['.tag'] === 'folder';
        return {
          id: entry.id || entry.path_lower,
          name: entry.name,
          mimeType: isFolder ? 'folder' : getMimeType(entry.name),
          size: entry.size || 0,
          modifiedTime: entry.client_modified || entry.server_modified,
          path: entry.path_lower,
        };
      });

    // Apply mime type filter if specified
    if (mimeTypeFilter) {
      files = files.filter((file: CloudFile) => 
        file.mimeType === mimeTypeFilter || file.mimeType === 'folder'
      );
    }

    return files;
  },

  async downloadFile(fileId: string): Promise<{ uri: string; name: string; size: number }> {
    let state = await loadAuthState();
    
    if (!state?.accessToken) {
      throw new Error('Not authenticated');
    }

    // Refresh token if expired
    if (state.expiresAt && Date.now() >= state.expiresAt && state.refreshToken) {
      state = await refreshAccessToken(state.refreshToken);
      if (!state?.accessToken) {
        throw new Error('Failed to refresh authentication');
      }
    }

    // The fileId for Dropbox is the path
    const path = fileId.startsWith('/') ? fileId : `/${fileId}`;
    const fileName = path.split('/').pop() || 'download';

    // Get temporary download link
    const linkResponse = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path }),
    });

    if (!linkResponse.ok) {
      const error = await linkResponse.text();
      throw new Error(`Failed to get download link: ${error}`);
    }

    const linkData = await linkResponse.json();
    const downloadUrl = linkData.link;
    const metadata = linkData.metadata;

    // Download the file
    const localUri = `${getDocumentDirectory()}dropbox_${Date.now()}_${fileName}`;

    const downloadResult = await FileSystem.downloadAsync(downloadUrl, localUri);

    if (downloadResult.status !== 200) {
      throw new Error('Failed to download file');
    }

    return {
      uri: downloadResult.uri,
      name: metadata.name || fileName,
      size: metadata.size || 0,
    };
  },

  isConfigured(): boolean {
    return getAppKey().length > 0;
  },

  /**
   * Dropbox addresses by path, so the "id" is the folder path. `rememberedId`
   * is honoured when it still resolves, matching the Drive contract — a folder
   * the user renamed keeps receiving backups instead of a duplicate appearing.
   */
  async ensureFolder(name: string, rememberedId?: string | null): Promise<string> {
    const accessToken = await getAccessToken();

    if (rememberedId) {
      const probe = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: rememberedId }),
      });
      if (probe.ok) {
        const meta = await probe.json();
        if (meta['.tag'] === 'folder') return rememberedId;
      }
    }

    const path = toFolderPath(name);
    const response = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path, autorename: false }),
    });

    if (!response.ok) {
      const body = await response.clone().text();
      // 409 + path/conflict means it already exists — that is success for us.
      if (response.status === 409 && /conflict/i.test(body)) {
        return path;
      }
      await throwFriendlyDropboxError(response, 'Failed to create folder');
    }

    return path;
  },

  async uploadFile(request: CloudUploadRequest): Promise<CloudFile> {
    const accessToken = await getAccessToken();
    const folderPath = request.folderId ?? (request.folderName ? toFolderPath(request.folderName) : '');
    const path = `${folderPath}/${request.name}`;

    const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        // Dropbox takes upload params as a JSON header, not a body field.
        // `add` + autorename keeps a same-named backup from clobbering an older
        // one; `strict_conflict` makes the rename explicit rather than silent.
        'Dropbox-API-Arg': JSON.stringify({
          path,
          mode: 'add',
          autorename: true,
          mute: true,
          strict_conflict: false,
        }),
      },
      body: request.content,
    });

    if (!response.ok) {
      await throwFriendlyDropboxError(response, 'Failed to upload file');
    }

    const file = await response.json();
    return {
      id: file.path_lower ?? path,
      name: file.name ?? request.name,
      mimeType: request.mimeType ?? 'application/json',
      size: typeof file.size === 'number' ? file.size : 0,
      modifiedTime: file.server_modified,
      path: file.path_display ?? path,
    };
  },

  async deleteFile(fileId: string): Promise<void> {
    const accessToken = await getAccessToken();
    const path = fileId.startsWith('/') ? fileId : `/${fileId}`;

    const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path }),
    });

    if (!response.ok) {
      const body = await response.clone().text();
      // Already gone — the caller's goal (file absent) is met.
      if (response.status === 409 && /not_found/i.test(body)) return;
      await throwFriendlyDropboxError(response, 'Failed to delete file');
    }
  },
};

// Helper function to get MIME type from filename
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    zip: 'application/zip',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}
