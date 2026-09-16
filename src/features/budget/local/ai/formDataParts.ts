export type ImportAttachment = { uri: string; type: string; name: string };

/** RN FormData file blob shape used by Expo / React Native uploads. */
type RnFilePart = { uri?: string; name?: string; type?: string };

/**
 * Read text + file parts from React Native `FormData` (`_parts` internal)
 * or standard `FormData.get` when available (Jest / web).
 */
export function readFormDataImportParts(form: FormData): {
  text: string | null;
  file: ImportAttachment | null;
} {
  let text: string | null = null;
  let file: ImportAttachment | null = null;

  const withGet = form as FormData & { get?: (name: string) => unknown };
  if (typeof withGet.get === 'function') {
    const t = withGet.get('text');
    if (typeof t === 'string' && t.trim()) text = t.trim();
    const f = withGet.get('file') as RnFilePart | null;
    if (f && typeof f === 'object' && typeof f.uri === 'string') {
      file = {
        uri: f.uri,
        name: f.name || 'upload.bin',
        type: f.type || 'application/octet-stream',
      };
    }
  }

  const parts = (form as unknown as { _parts?: Array<[string, unknown]> })._parts;
  if (Array.isArray(parts)) {
    for (const [key, value] of parts) {
      if (key === 'text' && typeof value === 'string' && value.trim()) {
        text = value.trim();
      }
      if (key === 'file' && value && typeof value === 'object') {
        const f = value as RnFilePart;
        if (typeof f.uri === 'string') {
          file = {
            uri: f.uri,
            name: f.name || 'upload.bin',
            type: f.type || 'application/octet-stream',
          };
        }
      }
    }
  }

  return { text, file };
}
