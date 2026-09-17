import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

/**
 * Convert a picked avatar into the data URL accepted by the profile API.
 *
 * Native pickers return file:// URIs, which expo-file-system reads reliably.
 * Expo Web returns a blob: URL instead; expo-file-system cannot read that
 * browser-owned URL, so Web must use fetch + FileReader.
 */
export async function avatarUriToDataUrl(
  uri: string,
  mime = 'image/jpeg',
  platform = Platform.OS,
): Promise<string> {
  if (uri.startsWith('data:image/')) return uri;

  if (platform === 'web') {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`Could not read selected avatar (${response.status})`);
    }
    const bytes = new Uint8Array(await (await response.blob()).arrayBuffer());
    let binary = '';
    // Build in chunks so a large portrait does not overflow the JS call stack.
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const encoded = btoa(binary);
    return `data:${mime};base64,${encoded}`;
  }

  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  return `data:${mime};base64,${base64}`;
}
