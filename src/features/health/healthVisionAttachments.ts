// Expo SDK 54 made the top-level `readAsStringAsync` a throw-on-call
// deprecation stub. Use the `/legacy` subpath, as every other reader here does.
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { HealthScanImage } from '@api/healthAi';

/**
 * Picked image → the base64 payload every Health vision route accepts.
 *
 * ── WHY THIS EXISTS AS A MODULE ─────────────────────────────────────────────
 *
 * The "turn what the picker gave me into what the Worker takes" step was forked
 * across the app — `HealthScanScreen.toVisionSafeBase64`,
 * `BudgetReceiptScanScreen.toVisionSafeAttachment`, plus a `mimeFor` /
 * `inferReceiptMime` / `inferMime` / `guessMimeType` in half a dozen screens.
 * They do the same two things and drift apart one screen at a time. The fridge
 * receipt reader would have been the fifth copy; it uses this instead.
 *
 * Scoped to `features/health` because that is where both of its callers live
 * today. The Budget copies do the same work against a FILE-URI payload
 * (multipart upload) rather than base64, so they are a sibling to fold in here,
 * not the same function.
 *
 * ── THE RE-ENCODE IS NOT OPTIONAL ───────────────────────────────────────────
 *
 * The Worker identifies the media type from MAGIC BYTES and REFUSES what it does
 * not recognise (`resolveVisionImages`), which is the right call — a HEIC
 * forwarded to the provider comes back as a 400 that the member reads as "could
 * not read that". An iPhone hands you HEIC by default, so anything that is not
 * already a JPEG/PNG/WebP is re-encoded to JPEG here, before it is sent.
 *
 * The declared `media_type` that goes on the wire is ADVISORY — the Worker
 * sniffs the bytes and ignores it. It is sent anyway because it costs nothing
 * and makes a request log readable.
 */

/** A picked file, however it was picked. */
export interface HealthPickedImage {
  uri: string;
  /** File name, used ONLY to decide whether a re-encode is needed. */
  name: string;
}

/** What the Worker's sniffer accepts. Anything else is re-encoded to JPEG. */
const VISION_SAFE = /\.(jpe?g|png|webp)$/i;

/** The same set as MIME strings, for the file and Drive pickers. */
export const HEALTH_VISION_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Best-effort MIME from a file name.
 *
 * JPEG is the fallback rather than `application/octet-stream` because by the
 * time this runs the bytes are either already one of the three safe types or
 * have just been re-encoded to JPEG — and, either way, the server does not
 * believe this string.
 */
export function mimeForFileName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

export async function toVisionSafeBase64(image: HealthPickedImage): Promise<HealthScanImage> {
  const alreadySafe = VISION_SAFE.test(image.name) && !/\.(heic|heif)$/i.test(image.name);
  if (alreadySafe) {
    const data = await FileSystem.readAsStringAsync(image.uri, { encoding: 'base64' });
    return { data, media_type: mimeForFileName(image.name) };
  }
  const rendered = await ImageManipulator.manipulate(image.uri).renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const data = await FileSystem.readAsStringAsync(result.uri, { encoding: 'base64' });
  return { data, media_type: 'image/jpeg' };
}
