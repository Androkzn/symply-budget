// Google Drive Service
// Uses OAuth2 with expo-auth-session and Google Drive REST API

import * as AuthSession from 'expo-auth-session';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { ENV } from '@config/env';

import { CloudReauthRequiredError } from './types';
import type {
  CloudStorageService,
  CloudAuthState,
  CloudFile,
  CloudFolder,
  CloudUploadRequest,
} from './types';

// Helper to get document directory with type safety
const getDocumentDirectory = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (FileSystem as any).documentDirectory || '';
};

// Complete auth session for web browser
WebBrowser.maybeCompleteAuthSession();

// Google OAuth Configuration
// Credentials are centralized in src/config/env.ts (ENV.GOOGLE_DRIVE_OAUTH).
// See that file for setup instructions in Google Cloud Console.
// Read lazily inside getClientId() (never at module init): ENV's brand-backed
// getters can be mid-initialization under a circular import, so a top-level
// `ENV.GOOGLE_DRIVE_OAUTH.*` read would crash on import.

/**
 * Full Drive access — read AND write anywhere in the user's Drive.
 *
 * The narrower pair this replaced (`drive.readonly` + `drive.file`) could not
 * support the one thing the backup folder picker is for: `drive.file` grants
 * access only to files THIS app created, so `files.create` with a parent the
 * member picked out of their own Drive comes back 404 "File not found: <id>".
 * Browsing was never the blocker — `drive.readonly` already listed the whole
 * tree — writing into the chosen folder was.
 *
 * Both of the old scopes were already Google "restricted" scopes, so this does
 * not newly pull the app into CASA assessment; it does broaden the consent
 * screen, and every existing grant is narrower than this one. See
 * `canBrowseFolders` for how a pre-existing grant is detected and re-consented
 * BEFORE the member picks a folder it could not write to.
 */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

const SCOPES = [
  DRIVE_SCOPE,
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const STORAGE_KEY = 'google_drive_auth';

// Discovery document for Google OAuth
const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

function getClientId(): string {
  // Coalesce every branch: `isConfigured` runs during render to decide whether
  // to offer Drive at all, so a brand without the block (or a partially-stubbed
  // ENV) must read as "not configured" rather than throw.
  const oauth = ENV.GOOGLE_DRIVE_OAUTH ?? {};
  if (Platform.OS === 'ios') {
    return oauth.IOS_CLIENT_ID ?? '';
  } else if (Platform.OS === 'android') {
    return oauth.ANDROID_CLIENT_ID ?? '';
  }
  return oauth.WEB_CLIENT_ID ?? '';
}

// Google's native iOS/Android OAuth clients require the reversed-client-ID URL
// scheme as the redirect target (a custom app scheme like `symply://` is
// rejected by Google for native clients). e.g.
//   123456789012-abc.apps.googleusercontent.com
//   -> com.googleusercontent.apps.123456789012-abc
function getReversedClientId(): string {
  const id = getClientId().replace('.apps.googleusercontent.com', '');
  return `com.googleusercontent.apps.${id}`;
}

function getRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    native: `${getReversedClientId()}:/oauth2redirect`,
  });
}

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
    console.error('Error loading Google auth state:', error);
  }
  return null;
}

async function clearAuthState(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}

/**
 * Swap a refresh token for a new access token, keeping everything the refresh
 * response does not re-state.
 *
 * `previous` matters: a refresh returns only the new token and its lifetime, so
 * building the state from that alone silently dropped the signed-in identity —
 * and now the granted scopes, which is what tells a current grant apart from a
 * narrower legacy one. Losing those would make `canBrowseFolders` report "too
 * narrow" after every refresh and ask for a pointless reconnect.
 */
async function refreshAccessToken(
  refreshToken: string,
  previous?: CloudAuthState | null,
): Promise<CloudAuthState | null> {
  try {
    const response = await fetch(discovery.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: getClientId(),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh token');
    }

    const data = await response.json();
    const newState: CloudAuthState = {
      ...previous,
      isAuthenticated: true,
      accessToken: data.access_token,
      refreshToken: refreshToken,
      expiresAt: Date.now() + (data.expires_in * 1000),
      // Google re-states the scope on a refresh only sometimes; keep whatever
      // the original grant recorded when it doesn't.
      scopes:
        typeof data.scope === 'string' ? data.scope.split(' ') : previous?.scopes,
    };

    await saveAuthState(newState);
    return newState;
  } catch (error) {
    console.error('Error refreshing Google token:', error);
    return null;
  }
}

// Maps a failed Drive API response to a friendly re-auth error. A 401 (revoked/
// expired) or a 403 caused by a missing scope (ACCESS_TOKEN_SCOPE_INSUFFICIENT /
// insufficientPermissions — e.g. a grant issued before Drive access was added)
// both mean the stored grant is unusable, so we clear it and ask the user to
// reconnect. Any other failure re-throws the original error unchanged.
async function throwFriendlyDriveError(response: Response, context: string): Promise<never> {
  const body = await response.text();

  const isScopeIssue =
    response.status === 403 &&
    /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient authentication scopes/i.test(
      body
    );

  if (response.status === 401 || isScopeIssue) {
    await clearAuthState();
    throw new CloudReauthRequiredError(
      'Your Google Drive access needs to be renewed. Please reconnect.'
    );
  }

  // Non-auth failure — keep the raw text for logs, but the picker maps unknown
  // messages to generic copy so nothing leaks to the UI.
  throw new Error(`${context}: ${body}`);
}

async function getUserInfo(accessToken: string): Promise<{ email: string; name: string } | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
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
      name: data.name,
    };
  } catch (error) {
    console.error('Error getting Google user info:', error);
    return null;
  }
}

/**
 * Stored access token, refreshed first when expired. Every Drive call needs the
 * same load → refresh → bail dance; keeping it in one place stops the branches
 * from drifting apart as endpoints are added.
 */
async function getAccessToken(): Promise<string> {
  let state = await loadAuthState();

  if (!state?.accessToken) {
    throw new Error('Not authenticated');
  }

  if (state.expiresAt && Date.now() >= state.expiresAt && state.refreshToken) {
    state = await refreshAccessToken(state.refreshToken, state);
    if (!state?.accessToken) {
      throw new Error('Failed to refresh authentication');
    }
  }

  return state.accessToken;
}

/**
 * True when `id` still points at a live (non-trashed) folder this app can see.
 * A remembered id can go stale — the user may delete the folder, or empty the
 * trash — and Drive answers a query against a dead parent with an empty list
 * rather than an error, so the id has to be probed directly.
 */
async function folderIsUsable(id: string, accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?fields=id,mimeType,trashed`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return false;
    const file = await response.json();
    return file.mimeType === FOLDER_MIME && file.trashed !== true;
  } catch {
    return false;
  }
}

/**
 * Resolve an app-owned folder, creating it on first use.
 *
 * `rememberedId` wins when it still resolves, so backups keep landing in the
 * same folder even after the user renames or moves it in Drive. Only when that
 * id is gone do we fall back to a lookup by name (and finally to creating it),
 * which avoids silently scattering archives across duplicate folders.
 */
async function ensureFolderId(name: string, rememberedId?: string | null): Promise<string> {
  const accessToken = await getAccessToken();

  if (rememberedId && (await folderIsUsable(rememberedId, accessToken))) {
    return rememberedId;
  }

  const params = new URLSearchParams({
    q: `mimeType='${FOLDER_MIME}' and name='${name.replace(/'/g, "\\'")}' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: '1',
  });

  const found = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!found.ok) {
    await throwFriendlyDriveError(found, 'Failed to look up folder');
  }

  const existing = await found.json();
  if (existing.files?.[0]?.id) {
    return existing.files[0].id as string;
  }

  const created = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
  });

  if (!created.ok) {
    await throwFriendlyDriveError(created, 'Failed to create folder');
  }

  const folder = await created.json();
  return folder.id as string;
}

export const googleDriveService: CloudStorageService = {
  provider: 'google-drive',

  async isAuthenticated(): Promise<boolean> {
    const state = await loadAuthState();
    if (!state?.accessToken) {
      return false;
    }

    // Check if token is expired
    if (state.expiresAt && Date.now() >= state.expiresAt) {
      // Try to refresh
      if (state.refreshToken) {
        const newState = await refreshAccessToken(state.refreshToken, state);
        return !!newState?.accessToken;
      }
      return false;
    }

    return true;
  },

  async authenticate(): Promise<CloudAuthState> {
    const clientId = getClientId();
    
    // Check for placeholder credentials
    if (clientId.includes('YOUR_')) {
      throw new Error(
        'Google Drive integration requires setup. Please configure your Google Cloud OAuth credentials in src/services/cloud-storage/google-drive.ts'
      );
    }

    const redirectUri = getRedirectUri();

    const request = new AuthSession.AuthRequest({
      clientId,
      scopes: SCOPES,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      // access_type=offline → issue a refresh token; prompt=consent → always
      // re-show the consent screen so a grant that predates a scope change (e.g.
      // Drive access added later) is upgraded to the full scope set instead of
      // silently reusing a token that can't list files.
      extraParams: {
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
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
          client_id: clientId,
          code: result.params.code,
          code_verifier: request.codeVerifier || '',
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        throw new Error(`Failed to exchange code: ${error}`);
      }

      const tokenData = await tokenResponse.json();

      // Guard against a consent where the user unticked Drive: the token would
      // authenticate fine but every listFiles() and every upload would 403.
      // Catch it here so the user re-consents instead of hitting a confusing
      // error later.
      if (
        typeof tokenData.scope === 'string' &&
        !tokenData.scope.split(' ').includes(DRIVE_SCOPE)
      ) {
        throw new CloudReauthRequiredError(
          'Drive access wasn’t granted. Please allow file access to continue.'
        );
      }

      const userInfo = await getUserInfo(tokenData.access_token);

      const authState: CloudAuthState = {
        isAuthenticated: true,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || null,
        expiresAt: Date.now() + (tokenData.expires_in * 1000),
        userEmail: userInfo?.email,
        userName: userInfo?.name,
        scopes: typeof tokenData.scope === 'string' ? tokenData.scope.split(' ') : [DRIVE_SCOPE],
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
        await fetch(`${discovery.revocationEndpoint}?token=${state.accessToken}`, {
          method: 'POST',
        });
      } catch (error) {
        console.error('Error revoking Google token:', error);
      }
    }

    await clearAuthState();
  },

  async getAuthState(): Promise<CloudAuthState | null> {
    return loadAuthState();
  },

  async listFiles(folderId?: string, mimeTypeFilter?: string): Promise<CloudFile[]> {
    const accessToken = await getAccessToken();

    const parentQuery = folderId ? `'${folderId}' in parents` : "'root' in parents";
    const mimeQuery = mimeTypeFilter ? ` and mimeType='${mimeTypeFilter}'` : '';
    const query = `${parentQuery}${mimeQuery} and trashed=false`;

    const params = new URLSearchParams({
      q: query,
      fields: 'files(id,name,mimeType,size,modifiedTime,thumbnailLink,webContentLink)',
      orderBy: 'modifiedTime desc',
      pageSize: '100',
    });

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      await throwFriendlyDriveError(response, 'Failed to list files');
    }

    const data = await response.json();

    return (data.files || []).map((file: any) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: parseInt(file.size || '0', 10),
      modifiedTime: file.modifiedTime,
      thumbnailUrl: file.thumbnailLink,
      downloadUrl: file.webContentLink,
    }));
  },

  async downloadFile(fileId: string): Promise<{ uri: string; name: string; size: number }> {
    const accessToken = await getAccessToken();

    // Get file metadata first
    const metadataResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,size,mimeType`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!metadataResponse.ok) {
      await throwFriendlyDriveError(metadataResponse, 'Failed to get file metadata');
    }

    const metadata = await metadataResponse.json();

    // Download the file
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const localUri = `${getDocumentDirectory()}gdrive_${fileId}_${metadata.name}`;

    const downloadResult = await FileSystem.downloadAsync(downloadUrl, localUri, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (downloadResult.status !== 200) {
      throw new Error('Failed to download file');
    }

    return {
      uri: downloadResult.uri,
      name: metadata.name,
      size: parseInt(metadata.size || '0', 10),
    };
  },

  isConfigured(): boolean {
    return !getClientId().includes('YOUR_') && getClientId().length > 0;
  },

  async ensureFolder(name: string, rememberedId?: string | null): Promise<string> {
    return ensureFolderId(name, rememberedId);
  },

  async listFolders(parentId?: string): Promise<CloudFolder[]> {
    const accessToken = await getAccessToken();

    // Shared drives and "Shared with me" are deliberately out: a backup written
    // somewhere other people can reach is a different decision from choosing a
    // tidy folder, and nothing in this flow asks the member to make it.
    const params = new URLSearchParams({
      q: `'${(parentId ?? 'root').replace(/'/g, "\\'")}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: 'files(id,name)',
      orderBy: 'name',
      pageSize: '200',
    });

    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      await throwFriendlyDriveError(response, 'Failed to list folders');
    }

    const data = await response.json();
    return ((data.files ?? []) as { id: string; name: string }[]).map((folder) => ({
      id: folder.id,
      name: folder.name,
    }));
  },

  async createFolder(name: string, parentId?: string | null): Promise<CloudFolder> {
    const accessToken = await getAccessToken();

    const response = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        // Omitted rather than sent as 'root': Drive treats a missing parent as
        // My Drive already, and naming it explicitly is one more thing to get
        // wrong for accounts where the root id is not the literal string.
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });

    if (!response.ok) {
      await throwFriendlyDriveError(response, 'Failed to create folder');
    }

    const folder = await response.json();
    return { id: folder.id as string, name: (folder.name as string) ?? name };
  },

  /**
   * `false` ONLY when Drive itself says the folder is gone — a 404, or a
   * trashed / non-folder answer. Anything that says nothing about the folder
   * (no usable grant, a dropped connection, a 5xx, a rate limit) throws.
   *
   * This used to fold every failure into `false`, and the callers treat
   * `false` as "forget the folder the member picked and start a new one at the
   * account root". One flaky probe during a scheduled run was therefore enough
   * to silently move every future backup out of the folder they chose — which
   * is exactly the misfiling the probe exists to prevent. A caller that cannot
   * tell has to keep the pointer, not act on a guess.
   */
  async folderExists(id: string): Promise<boolean> {
    const accessToken = await getAccessToken();
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?fields=id,mimeType,trashed`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (response.status === 404) return false;
    if (!response.ok) {
      // 401 / scope-403 become the reconnect error; anything else stays a
      // plain failure. Neither is a verdict on the folder.
      await throwFriendlyDriveError(response, 'Failed to check folder');
    }
    const file = await response.json();
    return file.mimeType === FOLDER_MIME && file.trashed !== true;
  },

  async canBrowseFolders(): Promise<boolean> {
    const state = await loadAuthState();
    if (!state?.accessToken) return false;
    // An older grant carries the narrow pair (`drive.readonly` + `drive.file`)
    // instead. It still reads, and still writes into the folder this app made,
    // so nothing already working
    // breaks — but it cannot create a file inside a folder the member picks out
    // of their own Drive, which is the entire point of the picker. No recorded
    // scopes at all means a grant from before they were stored: same answer,
    // and one reconnect settles it.
    return state.scopes?.includes(DRIVE_SCOPE) ?? false;
  },

  async deleteFile(fileId: string): Promise<void> {
    const accessToken = await getAccessToken();
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 404 means it is already gone — the caller's goal (file absent) is met.
    if (!response.ok && response.status !== 404) {
      await throwFriendlyDriveError(response, 'Failed to delete file');
    }
  },

  async uploadFile(request: CloudUploadRequest): Promise<CloudFile> {
    const accessToken = await getAccessToken();
    const mimeType = request.mimeType ?? 'application/json';
    const folderId =
      request.folderId ?? (request.folderName ? await ensureFolderId(request.folderName) : null);
    const parents = folderId ? [folderId] : undefined;

    // Multipart upload: metadata part + content part in one request. The body
    // is plain text (archives are UTF-8 JSON), so no binary/base64 path is
    // needed and the boundary can never collide with JSON content.
    const boundary = 'symply-backup-boundary-9f2c1a';
    // Updating an existing file is a PATCH against its id. `parents` must NOT
    // ride along on an update — Drive treats it as an add-parent instruction
    // and rejects it here, and the file is already in the right folder anyway.
    const replacing = Boolean(request.replaceFileId);
    const metadata = replacing
      ? { name: request.name, mimeType }
      : { name: request.name, mimeType, ...(parents ? { parents } : {}) };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mimeType}; charset=UTF-8`,
      '',
      request.content,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const target = replacing
      ? `https://www.googleapis.com/upload/drive/v3/files/${request.replaceFileId}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime';

    const response = await fetch(target, {
      method: replacing ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      await throwFriendlyDriveError(response, 'Failed to upload file');
    }

    const file = await response.json();
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType ?? mimeType,
      size: parseInt(file.size || '0', 10),
      modifiedTime: file.modifiedTime,
    };
  },
};
