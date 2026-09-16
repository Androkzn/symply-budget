import {
  healthAssetsApi,
  HEALTH_FILE_MAX_BYTES,
  HEALTH_FILE_MIME_TYPES,
  type CreateHealthFileInput,
  type HealthFile,
  type HealthFileType,
} from '@api/healthAssets';
import { storageHelpers } from '@services/storage';

import { readThrough } from './healthRepository';

/**
 * Symply Health — USER FILES (the donor's "My Files", `Features/Files`).
 *
 * Record of truth: `/health/files` on the `symply-health-api` Worker (R2 for the
 * bytes, D1 for the row). MMKV is an offline read-through cache of the METADATA
 * only, exactly as in every other Health store — never the record, and never the
 * bytes (see `healthRepository`).
 *
 * ## The upload is two requests, and the first one can outlive the second
 *
 * `POST /health/files` reserves a row and returns where to PUT; the bytes go in
 * a second request. If the PUT fails, the reservation is already in D1 and would
 * show up in the list as a file whose content 404s — a ghost the member can see
 * but never open. {@link uploadHealthFile} deletes the reservation on a failed
 * PUT for exactly that reason.
 *
 * ## What is cached, and what is not
 *
 * Only metadata: names, types, sizes, dates. The BYTES are never mirrored to
 * this device's cache. A `body_photo` is the most sensitive thing this app
 * stores, and a copy sitting in MMKV would outlive both the session and any
 * server-side delete.
 *
 * ## Deliberately absent
 *
 * The donor's `GET /files/storage-usage` has no counterpart on this Worker, so
 * {@link summarizeFiles} counts what the list actually returned rather than
 * printing a server figure that does not exist. It says "across N files" so the
 * number is checkable rather than magic.
 */

export const HEALTH_FILES_KEY = 'health.files.v1';

/* ==================================================================== */
/* Vocabulary                                                            */
/* ==================================================================== */

export const HEALTH_FILE_TYPES: readonly HealthFileType[] = ['photo', 'document', 'body_photo'];

export const HEALTH_FILE_TYPE_LABELS: Record<HealthFileType, string> = {
  photo: 'Photo',
  document: 'Document',
  body_photo: 'Body photo',
};

/** Filter chips across the top of the screen. `all` is the unfiltered list. */
export const HEALTH_FILE_FILTERS = ['all', 'photo', 'document', 'body_photo'] as const;
export type HealthFileFilter = (typeof HEALTH_FILE_FILTERS)[number];

export const HEALTH_FILE_FILTER_LABELS: Record<HealthFileFilter, string> = {
  all: 'All',
  photo: 'Photos',
  document: 'Documents',
  body_photo: 'Body',
};

/** Ionicons glyph per type — used for the row icon when there is no thumbnail. */
export const HEALTH_FILE_TYPE_ICONS: Record<HealthFileType, string> = {
  photo: 'image-outline',
  document: 'document-text-outline',
  body_photo: 'body-outline',
};

/** Extensions offered to the document picker, per the server's allow-list. */
export const HEALTH_DOCUMENT_MIME_TYPES = HEALTH_FILE_MIME_TYPES.document;
export const HEALTH_PHOTO_MIME_TYPES = HEALTH_FILE_MIME_TYPES.photo;

export { HEALTH_FILE_MAX_BYTES };

/* ==================================================================== */
/* Screen shape                                                          */
/* ==================================================================== */

export interface HealthFileEntry {
  id: string;
  name: string;
  type: HealthFileType;
  mimeType: string;
  /** True byte length once uploaded; the DECLARED size until then. */
  sizeBytes: number;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  /** Proxied, auth-checked path — needs the bearer token, never public. */
  contentPath: string;
  /** Whether this can be rendered inline as an image. */
  isImage: boolean;
}

function isHealthFileType(value: string): value is HealthFileType {
  return (HEALTH_FILE_TYPES as readonly string[]).includes(value);
}

export function fromWireHealthFile(row: HealthFile): HealthFileEntry {
  const type: HealthFileType =
    typeof row.file_type === 'string' && isHealthFileType(row.file_type) ? row.file_type : 'document';
  return {
    id: row.id,
    name: row.file_name,
    type,
    mimeType: row.mime_type,
    sizeBytes: Number.isFinite(row.file_size) && row.file_size > 0 ? row.file_size : 0,
    category: row.category ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contentPath: row.content_path,
    isImage: typeof row.mime_type === 'string' && row.mime_type.startsWith('image/'),
  };
}

function isValidEntry(entry: HealthFileEntry | null | undefined): entry is HealthFileEntry {
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.contentPath === 'string' &&
    typeof entry.createdAt === 'string'
  );
}

function byNewestFirst(a: HealthFileEntry, b: HealthFileEntry): number {
  if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
  return a.name.localeCompare(b.name);
}

export function sortFiles(files: HealthFileEntry[]): HealthFileEntry[] {
  return [...files].filter(isValidEntry).sort(byNewestFirst);
}

/* ==================================================================== */
/* Formatting, filtering, summary                                        */
/* ==================================================================== */

/**
 * Human file size. Uses 1024-based units with the decimal labels every OS file
 * browser prints, because matching what Finder/Files shows for the same object
 * matters more here than the SI purity of "KiB".
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** `2026-07-25` from an ISO stamp — the day key every Health surface prints. */
export function fileDayKey(iso: string): string {
  return typeof iso === 'string' ? iso.slice(0, 10) : '';
}

export interface HealthFilesSummary {
  total: number;
  photos: number;
  documents: number;
  bodyPhotos: number;
  /** Sum of the sizes of the files IN THIS LIST — not a server storage quota. */
  totalBytes: number;
}

export function summarizeFiles(files: HealthFileEntry[]): HealthFilesSummary {
  let photos = 0;
  let documents = 0;
  let bodyPhotos = 0;
  let totalBytes = 0;
  for (const file of files) {
    if (file.type === 'photo') photos += 1;
    else if (file.type === 'document') documents += 1;
    else if (file.type === 'body_photo') bodyPhotos += 1;
    totalBytes += file.sizeBytes;
  }
  return { total: files.length, photos, documents, bodyPhotos, totalBytes };
}

/** Apply the filter chip + a trimmed, case-insensitive name search. */
export function viewFiles(
  files: HealthFileEntry[],
  options: { filter?: HealthFileFilter; query?: string } = {}
): HealthFileEntry[] {
  let out = files;
  if (options.filter && options.filter !== 'all') {
    out = out.filter((file) => file.type === options.filter);
  }
  const needle = (options.query ?? '').trim().toLowerCase();
  if (needle.length > 0) {
    out = out.filter(
      (file) =>
        file.name.toLowerCase().includes(needle) ||
        (file.category ?? '').toLowerCase().includes(needle)
    );
  }
  return out;
}

/* ==================================================================== */
/* Picking → wire input                                                  */
/* ==================================================================== */

/** Extension → MIME, restricted to what the server allows. */
const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  json: 'application/json',
};

/**
 * Best MIME for a picked file.
 *
 * A picker's own `mimeType` is preferred when it is one the server admits;
 * otherwise the extension decides. `application/octet-stream` — what iOS hands
 * back for plenty of ordinary files — is never trusted, because the POST would
 * be refused and the member would be told their PDF is "not allowed".
 */
export function resolveMimeType(fileName: string, declared?: string | null): string | null {
  const allowed = new Set<string>([
    ...HEALTH_FILE_MIME_TYPES.photo,
    ...HEALTH_FILE_MIME_TYPES.document,
  ]);
  if (declared && allowed.has(declared)) return declared;
  const ext = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  const guess = EXTENSION_MIME[ext];
  return guess && allowed.has(guess) ? guess : null;
}

/** Images are photos, everything else is a document. `body_photo` is explicit. */
export function fileTypeForMime(mimeType: string): HealthFileType {
  return mimeType.startsWith('image/') ? 'photo' : 'document';
}

/** A file name that is safe to send and readable when it comes back. */
export function cleanFileName(raw: string | null | undefined, mimeType: string): string {
  const fallbackExt = mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/').pop() ?? 'bin';
  const base = (raw ?? '').split('/').pop()?.split('?')[0]?.trim() ?? '';
  if (base.length === 0) return `file-${Date.now()}.${fallbackExt}`;
  return base.slice(0, 200);
}

/* ==================================================================== */
/* Failure copy — no raw error string ever reaches the UI                */
/* ==================================================================== */

export type HealthFileWriteStatus = 'saved' | 'rejected' | 'offline';

export const FILE_OFFLINE_MESSAGE =
  'That did not reach your account. Check your connection and try again.';
export const FILE_MISSING_MESSAGE = 'That file is no longer in your account.';
export const FILE_TOO_LARGE_MESSAGE = `That file is larger than ${formatFileSize(
  HEALTH_FILE_MAX_BYTES
)}. Try a smaller one.`;
export const FILE_TYPE_MESSAGE =
  'That kind of file cannot be stored here. Photos (JPEG, PNG, WebP, HEIC), PDFs and plain text are supported.';
export const FILE_EMPTY_MESSAGE = 'That file is empty, so there was nothing to upload.';
export const FILE_UNREADABLE_MESSAGE = 'That file could not be read from this device.';

function httpStatusOf(error: unknown): number | undefined {
  const response = (error as { response?: { status?: unknown } } | null | undefined)?.response;
  const status = response?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Friendly copy for a request the SERVER refused, or `null` when the failure
 * looks like a lost connection. Only the HTTP status is inspected — the error's
 * own message is never read, so a raw string cannot leak into the UI.
 */
export function fileRejectionMessageFor(error: unknown): string | null {
  const status = httpStatusOf(error);
  if (status === undefined) return null;
  if (status === 404) return FILE_MISSING_MESSAGE;
  if (status === 413) return FILE_TOO_LARGE_MESSAGE;
  if (status === 400 || status === 415 || status === 422) return FILE_TYPE_MESSAGE;
  if (status === 401 || status === 403) return 'Please sign in again to do that.';
  if (status >= 500) return null;
  return 'That could not be saved. Please try again.';
}

/* ==================================================================== */
/* Reads                                                                 */
/* ==================================================================== */

async function fetchFiles(): Promise<HealthFileEntry[]> {
  const payload = await healthAssetsApi.listFiles();
  return (payload?.files ?? []).map(fromWireHealthFile);
}

/** Every file, newest first — mirrors the Worker's own ordering. */
export async function loadFiles(): Promise<HealthFileEntry[]> {
  return sortFiles(await readThrough(HEALTH_FILES_KEY, fetchFiles, []));
}

/* ==================================================================== */
/* Writes                                                                */
/* ==================================================================== */

export interface HealthFileWriteResult {
  files: HealthFileEntry[];
  status: HealthFileWriteStatus;
  /** Friendly copy, or null when there is nothing to say. Never a raw error. */
  message: string | null;
}

/** What the picker hands over. `uri` is a local `file://` path. */
export interface HealthFileUploadRequest {
  uri: string;
  /** Suggested name; falls back to the URI's last segment. */
  name?: string | null;
  /** The picker's own MIME, if it gave one. Verified against the allow-list. */
  mimeType?: string | null;
  /** `photo` / `document` are inferred from the MIME; pass to force `body_photo`. */
  fileType?: HealthFileType;
  category?: string;
}

/**
 * Read a local file into bytes the PUT can carry.
 *
 * `fetch()` on a `file://` URI is the one form that works across iOS and
 * Android in React Native without pulling the whole thing through base64 (which
 * inflates a 50MB object to ~67MB of JS string before it is even sent).
 */
async function readLocalBytes(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  return await response.blob();
}

/**
 * Upload one picked file: reserve, PUT the bytes, then re-read the list.
 *
 * Every refusal the CLIENT can see coming — an unsupported type, an empty file,
 * something over the 50MB cap — is answered here rather than by letting the
 * Worker 400 and mapping the status back into words.
 *
 * If the PUT fails after the reservation succeeded, the reservation is deleted:
 * a row whose bytes never arrived shows in the list as a file that cannot be
 * opened, and the member has no way to tell it apart from a real one.
 */
export async function uploadHealthFile(
  request: HealthFileUploadRequest
): Promise<HealthFileWriteResult> {
  const before = await loadFiles();
  const reject = (message: string): HealthFileWriteResult => ({
    files: before,
    status: 'rejected',
    message,
  });

  const mimeType = resolveMimeType(request.name ?? request.uri, request.mimeType);
  if (!mimeType) return reject(FILE_TYPE_MESSAGE);

  const fileType = request.fileType ?? fileTypeForMime(mimeType);
  if (!HEALTH_FILE_MIME_TYPES[fileType].includes(mimeType)) return reject(FILE_TYPE_MESSAGE);

  let bytes: Blob;
  try {
    bytes = await readLocalBytes(request.uri);
  } catch {
    return reject(FILE_UNREADABLE_MESSAGE);
  }

  const size = typeof bytes.size === 'number' ? bytes.size : 0;
  if (size <= 0) return reject(FILE_EMPTY_MESSAGE);
  if (size > HEALTH_FILE_MAX_BYTES) return reject(FILE_TOO_LARGE_MESSAGE);

  const input: CreateHealthFileInput = {
    file_name: cleanFileName(request.name ?? request.uri, mimeType),
    file_type: fileType,
    mime_type: mimeType,
    file_size: size,
    ...(request.category ? { category: request.category } : {}),
  };

  let reservationId: string | null = null;
  try {
    const reservation = await healthAssetsApi.createFile(input);
    reservationId = reservation.file.id;
    await healthAssetsApi.uploadFileBytes(reservation.upload.path, bytes, mimeType);
  } catch (error) {
    if (reservationId) {
      // Best effort. A reservation we cannot reach to delete is a metadata row
      // with no bytes, which the next successful list will still show — but
      // leaving it deliberately would be worse.
      await healthAssetsApi.deleteFile(reservationId).catch(() => undefined);
    }
    const rejection = fileRejectionMessageFor(error);
    return {
      files: before,
      status: rejection === null ? 'offline' : 'rejected',
      message: rejection ?? FILE_OFFLINE_MESSAGE,
    };
  }

  // Re-read rather than splicing the reservation in: the Worker corrects
  // `file_size` to the true byte length on upload, so the row it holds is the
  // only one that is right.
  try {
    const files = sortFiles(await fetchFiles());
    await storageHelpers.setObject(HEALTH_FILES_KEY, files);
    return { files, status: 'saved', message: null };
  } catch {
    // The upload DID land; only the refresh failed. Say so, and keep the
    // pre-upload list rather than claiming the file is gone.
    return { files: before, status: 'saved', message: null };
  }
}

export interface HealthPhotoUploadResult {
  /** The proxied, ownership-checked path — feed to `healthFileContentSource`. Null on failure. */
  contentPath: string | null;
  status: HealthFileWriteStatus;
  message: string | null;
}

/**
 * Upload one photo and hand back WHERE it landed, rather than the whole
 * refreshed file list {@link uploadHealthFile} returns.
 *
 * Same reserve → PUT dance, same validation, same rollback-on-failed-PUT rule
 * as `uploadHealthFile` — a caller that needs the Files list (the Files tab)
 * still uses that one. This is for a caller that attaches a photo to something
 * ELSE (a recipe's `image_url`) and only needs to know the path it landed at,
 * not force a refetch + re-cache of the whole Files list for an object that
 * will never show up filtered under "Photos" as a recipe photo anyway.
 */
export async function uploadHealthPhoto(
  request: HealthFileUploadRequest,
  opts: { category?: string } = {}
): Promise<HealthPhotoUploadResult> {
  const reject = (message: string): HealthPhotoUploadResult => ({
    contentPath: null,
    status: 'rejected',
    message,
  });

  const mimeType = resolveMimeType(request.name ?? request.uri, request.mimeType);
  if (!mimeType || !HEALTH_PHOTO_MIME_TYPES.includes(mimeType)) return reject(FILE_TYPE_MESSAGE);

  let bytes: Blob;
  try {
    bytes = await readLocalBytes(request.uri);
  } catch {
    return reject(FILE_UNREADABLE_MESSAGE);
  }

  const size = typeof bytes.size === 'number' ? bytes.size : 0;
  if (size <= 0) return reject(FILE_EMPTY_MESSAGE);
  if (size > HEALTH_FILE_MAX_BYTES) return reject(FILE_TOO_LARGE_MESSAGE);

  const input: CreateHealthFileInput = {
    file_name: cleanFileName(request.name ?? request.uri, mimeType),
    file_type: 'photo',
    mime_type: mimeType,
    file_size: size,
    ...(opts.category ? { category: opts.category } : {}),
  };

  let reservationId: string | null = null;
  try {
    const reservation = await healthAssetsApi.createFile(input);
    reservationId = reservation.file.id;
    await healthAssetsApi.uploadFileBytes(reservation.upload.path, bytes, mimeType);
    return { contentPath: reservation.file.content_path, status: 'saved', message: null };
  } catch (error) {
    if (reservationId) {
      // Best effort — see `uploadHealthFile` for why a reservation with no
      // bytes behind it must not be left standing.
      await healthAssetsApi.deleteFile(reservationId).catch(() => undefined);
    }
    const rejection = fileRejectionMessageFor(error);
    return {
      contentPath: null,
      status: rejection === null ? 'offline' : 'rejected',
      message: rejection ?? FILE_OFFLINE_MESSAGE,
    };
  }
}

/**
 * Delete a file (soft server-side; the R2 object really is removed).
 *
 * Optimistic: the row leaves the list immediately, and is put back only if the
 * server refused — a phantom row that reappears on the next cold start is worse
 * than a moment of lag.
 */
export async function deleteHealthFile(id: string): Promise<HealthFileWriteResult> {
  const before = await loadFiles();
  const optimistic = before.filter((file) => file.id !== id);
  try {
    await healthAssetsApi.deleteFile(id);
  } catch (error) {
    const rejection = fileRejectionMessageFor(error);
    if (rejection === null) {
      return { files: before, status: 'offline', message: FILE_OFFLINE_MESSAGE };
    }
    // A 404 means it is already gone, so the optimistic list is the true one.
    if (httpStatusOf(error) === 404) {
      await storageHelpers.setObject(HEALTH_FILES_KEY, optimistic);
      return { files: optimistic, status: 'saved', message: null };
    }
    return { files: before, status: 'rejected', message: rejection };
  }

  await storageHelpers.setObject(HEALTH_FILES_KEY, optimistic);
  try {
    const files = sortFiles(await fetchFiles());
    await storageHelpers.setObject(HEALTH_FILES_KEY, files);
    return { files, status: 'saved', message: null };
  } catch {
    return { files: optimistic, status: 'saved', message: null };
  }
}
