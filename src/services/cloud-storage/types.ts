// Cloud Storage Types

export type CloudProvider = 'google-drive' | 'dropbox' | 'device';

/**
 * Thrown when the stored grant is missing/expired or lacks the scope a request
 * needs (e.g. a token issued before `drive.readonly` was added — Google returns
 * 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT`). The service clears the stale grant
 * before throwing so the UI can drop back to the Connect screen and re-consent.
 * Carries no raw provider payload — the picker shows friendly copy.
 */
export class CloudReauthRequiredError extends Error {
  constructor(message = 'Please reconnect to continue.') {
    super(message);
    this.name = 'CloudReauthRequiredError';
  }
}

export interface CloudFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime?: string;
  thumbnailUrl?: string;
  downloadUrl?: string;
  path?: string;
}

export interface CloudFolder {
  id: string;
  name: string;
  /**
   * Display path, when the provider gives one cheaply. Drive addresses folders
   * by id and would need one request per ancestor to build this, so its browser
   * assembles the trail from the route the user actually walked instead.
   */
  path?: string;
}

export interface CloudAuthState {
  isAuthenticated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  userEmail?: string;
  userName?: string;
  /**
   * Scopes the provider actually granted, as returned by the token exchange.
   * Stored so a grant issued under an older, narrower scope set can be told
   * apart from a current one BEFORE a write fails on it — see `canBrowseFolders`.
   */
  scopes?: string[];
}

/** Text payload to push into a provider folder (backups are UTF-8 JSON). */
export interface CloudUploadRequest {
  name: string;
  /** UTF-8 file body. Archives are JSON text, so no binary path is needed yet. */
  content: string;
  mimeType?: string;
  /** Provider folder to create-or-reuse. Omit to write to the account root. */
  folderName?: string;
  /**
   * Known folder id — skips the name lookup and keeps writing to the *same*
   * folder even after the user renames or moves it. Takes precedence over
   * `folderName`; callers should fall back to the name if this id 404s.
   */
  folderId?: string;
  /**
   * Overwrite this existing file instead of creating a new one. Providers do
   * not treat a name as unique — uploading `backup.json` twice leaves two files
   * of that name — so a caller that means "replace the previous backup" has to
   * name the file it is replacing.
   */
  replaceFileId?: string;
}

export interface CloudStorageService {
  provider: CloudProvider;
  isAuthenticated: () => Promise<boolean>;
  authenticate: () => Promise<CloudAuthState>;
  logout: () => Promise<void>;
  listFiles: (folderId?: string, mimeTypeFilter?: string) => Promise<CloudFile[]>;
  downloadFile: (fileId: string) => Promise<{ uri: string; name: string; size: number }>;
  getAuthState: () => Promise<CloudAuthState | null>;
  /**
   * Optional — only providers wired for write implement this. Dropbox still
   * ships placeholder OAuth keys, so Google Drive is the only writer today;
   * callers must check for the method before offering an upload destination.
   */
  uploadFile?: (request: CloudUploadRequest) => Promise<CloudFile>;
  /**
   * Optional — resolve (creating if absent) a folder id by name. Pass a
   * previously returned id as `rememberedId` to keep using the same folder
   * across renames; implementations fall back to the name when it is stale.
   *
   * For path-addressed providers (Dropbox) the returned "id" is the folder
   * path — callers must treat it as an opaque handle either way.
   */
  ensureFolder?: (name: string, rememberedId?: string | null) => Promise<string>;
  /** Optional — remove a file this app created. Used to prune old backups. */
  deleteFile?: (fileId: string) => Promise<void>;
  /**
   * Optional — sub-folders of `parentId` (the account root when omitted), for a
   * browser that lets the user choose where backups land. Folders only: the
   * files beside them are noise in a "pick a place" list.
   */
  listFolders?: (parentId?: string) => Promise<CloudFolder[]>;
  /** Optional — create a sub-folder and return it, so the picker can offer "New folder". */
  createFolder?: (name: string, parentId?: string | null) => Promise<CloudFolder>;
  /**
   * Optional — true when `id` still points at a live folder this app may write
   * to. A remembered pointer goes stale silently (the user deletes the folder in
   * the provider's own app), and providers answer a query against a dead parent
   * with an empty list rather than an error, so it has to be probed directly.
   *
   * Resolves `false` only when the provider positively says the folder is gone.
   * When it cannot tell — offline, no usable grant, a provider error — it must
   * REJECT rather than answer `false`: callers drop a folder the member chose on
   * a `false`, and a guess there sends every later backup somewhere they never
   * agreed to.
   */
  folderExists?: (id: string) => Promise<boolean>;
  /**
   * Optional — false when the stored grant is too narrow to write outside the
   * app's own files, so the UI can ask for one reconnect up front instead of
   * letting the member pick a folder and only then discovering the write is
   * refused. True when there is no such distinction for this provider.
   */
  canBrowseFolders?: () => Promise<boolean>;
  /**
   * False when the provider has no usable OAuth credentials in this build, so
   * the UI can hide it instead of offering a destination that always errors.
   * Absent means "always configured".
   */
  isConfigured?: () => boolean;
}

export interface PickerResult {
  canceled: boolean;
  file?: {
    uri: string;
    name: string;
    size: number;
    mimeType: string;
    provider: CloudProvider;
  };
}
