/**
 * Book Comprehension — Gemini Files API bridge.
 *
 * Ported from `backend-language/src/services/kaizen/geminiFilesApi.ts`. Gemini
 * can't read R2 directly, so a book PDF reaches the model through the Files API:
 * the Worker uploads the bytes (resumable protocol), polls until ACTIVE, then
 * references the file by URI in generateContent. Raw bytes are never logged.
 */

const FILES_BASE = 'https://generativelanguage.googleapis.com';

export class BooksFilesApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BooksFilesApiError';
  }
}

export interface UploadedFile {
  name: string; // resource name, e.g. "files/abc123"
  uri: string; // file_uri used in generateContent parts
  mimeType: string;
  state: string;
}

/** Upload bytes via the resumable protocol (single finalize) and return the file. */
export async function uploadToFilesApi(
  apiKey: string,
  bytes: ArrayBuffer,
  mimeType: string,
  displayName: string,
): Promise<UploadedFile> {
  const numBytes = bytes.byteLength;

  const startRes = await fetch(`${FILES_BASE}/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(numBytes),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!startRes.ok) {
    throw new BooksFilesApiError(`files start failed: HTTP ${startRes.status}`);
  }
  const uploadUrl =
    startRes.headers.get('X-Goog-Upload-URL') ?? startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new BooksFilesApiError('files start did not return an upload URL');
  }

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'Content-Length': String(numBytes),
    },
    body: bytes,
  });
  if (!uploadRes.ok) {
    throw new BooksFilesApiError(`files upload failed: HTTP ${uploadRes.status}`);
  }
  const json = (await uploadRes.json()) as {
    file?: { name?: string; uri?: string; mimeType?: string; state?: string };
  };
  const file = json.file;
  if (!file?.name || !file.uri) {
    throw new BooksFilesApiError('files upload returned no file resource');
  }
  return {
    name: file.name,
    uri: file.uri,
    mimeType: file.mimeType ?? mimeType,
    state: file.state ?? 'PROCESSING',
  };
}

/** Poll a file until it is ACTIVE (ready for inference) or throw. */
export async function waitForFileActive(
  apiKey: string,
  fileName: string,
  opts: { maxAttempts?: number; delayMs?: number } = {},
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? 30;
  const delayMs = opts.delayMs ?? 1500;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${FILES_BASE}/v1beta/${fileName}?key=${apiKey}`);
    if (!res.ok) throw new BooksFilesApiError(`files get failed: HTTP ${res.status}`);
    const json = (await res.json()) as { state?: string };
    if (json.state === 'ACTIVE') return;
    if (json.state === 'FAILED') throw new BooksFilesApiError('file processing FAILED');
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new BooksFilesApiError('file did not become ACTIVE in time');
}

/** Best-effort delete (privacy: don't retain the book PDF at Gemini). */
export async function deleteFile(apiKey: string, fileName: string): Promise<void> {
  try {
    await fetch(`${FILES_BASE}/v1beta/${fileName}?key=${apiKey}`, { method: 'DELETE' });
  } catch {
    /* best effort */
  }
}
