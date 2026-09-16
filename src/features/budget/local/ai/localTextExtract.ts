import { readAsStringAsync } from 'expo-file-system/legacy';

const TEXT_MIMES = new Set([
  'text/plain',
  'text/csv',
  'text/tab-separated-values',
  'application/csv',
  'application/json',
]);

const TEXT_EXTENSIONS = new Set(['txt', 'csv', 'tsv', 'json']);

export function isTextImportMime(mime: string | null | undefined, name: string): boolean {
  const normalized = (mime ?? '').toLowerCase();
  if (TEXT_MIMES.has(normalized)) return true;
  if (normalized.startsWith('text/')) return true;
  const ext = name.split('.').pop()?.toLowerCase();
  return ext ? TEXT_EXTENSIONS.has(ext) : false;
}

export async function readAttachmentAsText(file: {
  uri: string;
  type: string;
  name: string;
}): Promise<string | null> {
  if (!isTextImportMime(file.type, file.name)) return null;
  try {
    const text = await readAsStringAsync(file.uri);
    return text.trim() || null;
  } catch {
    return null;
  }
}

export async function readAttachmentAsBase64(file: {
  uri: string;
  type: string;
  name: string;
}): Promise<{ base64: string; mime: string } | null> {
  if (isTextImportMime(file.type, file.name)) return null;
  try {
    const base64 = await readAsStringAsync(file.uri, { encoding: 'base64' });
    return { base64, mime: file.type || 'image/jpeg' };
  } catch (error) {
    // Silently returning null here reads downstream as "the member attached
    // nothing", so say which file could not be read — a `ph://` asset URI or a
    // cache entry the OS already evicted both land here.
    console.warn(
      `[BUDGET-BYOK][attachment] unreadable ${file.name} (${file.type}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}
