import { readAsStringAsync } from 'expo-file-system/legacy';

import type { KaizenUploadedFile } from './rememberScopes';

/**
 * Best-effort UTF-8 read for pasted-import flows (resume, question lists).
 * Binary-only formats may return garbled text — callers should surface that in UI.
 */
export async function readUploadFileText(file: KaizenUploadedFile): Promise<string> {
  return readAsStringAsync(file.uri);
}
