/**
 * Normalisation for a VISUAL ATTACHMENT that is going to be stored and synced —
 * a project photo, a before/after shot of a selection.
 *
 * **Why a stored attachment needs its own cap, separate from the vision one.**
 * `visionSafeAttachment.ts` caps the long edge at 1568 because a model has to
 * read the bytes and a BYOK request has a 5 MB ceiling. That number is wrong
 * here in both directions: this image is read by PEOPLE, on a retina phone and
 * on an iPad, and it is kept rather than posted once. 1568 is visibly soft when
 * a member opens a photo full-screen to look at a tile edge or a scratch, which
 * is exactly what a renovation photo is for.
 *
 * **Why not the camera original either.** Under local-first these bytes are
 * sealed and pushed through the H6 blob channel, and then EVERY OTHER MEMBER of
 * the household downloads and decrypts them. A 12 MP iPhone original is 3–8 MB;
 * a fifty-photo bathroom project would be a few hundred MB that every member
 * pays for, against a household blob quota, on whatever connection they have.
 * The original also arrives as HEIC on iOS, which React Native's `<Image>` will
 * not render and a non-Apple peer cannot open at all.
 *
 * 2048 on the long edge at JPEG 0.85 lands around 400–700 KB: sharp at full
 * screen on a 3x phone and on an iPad, roughly a fifth of the original's
 * bytes, and in a format every peer can decode.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Long edge for a stored, synced attachment. See the header for the trade-off. */
export const ATTACHMENT_LONG_EDGE = 2048;

/** JPEG quality for a stored attachment. 0.85 keeps edges clean at 2048. */
export const ATTACHMENT_JPEG_QUALITY = 0.85;

export type NormalizedAttachmentImage = {
  uri: string;
  /** Always JPEG — HEIC is re-encoded so every peer can decode it. */
  mime: 'image/jpeg';
  width: number;
  height: number;
  /** True when the source was above the cap and was actually downscaled. */
  resized: boolean;
};

/**
 * Cap and re-encode an image for storage + sync.
 *
 * Always re-encodes, even when the source is already small enough: the source
 * may be HEIC at any size, and a JPEG round-trip is what guarantees the peer
 * can render it. The manipulator reports the post-render dimensions, so the
 * returned width/height describe the bytes that were actually written rather
 * than the ones that were picked.
 */
export async function normalizeAttachmentImage(
  sourceUri: string
): Promise<NormalizedAttachmentImage> {
  const preview = await ImageManipulator.manipulate(sourceUri).renderAsync();
  const longEdge = Math.max(preview.width, preview.height);
  const resized = longEdge > ATTACHMENT_LONG_EDGE;

  // Resize by the LONG edge whichever way the photo is oriented — passing a
  // width on a portrait photo would upscale it.
  const context = resized
    ? ImageManipulator.manipulate(sourceUri).resize(
        preview.width >= preview.height
          ? { width: ATTACHMENT_LONG_EDGE }
          : { height: ATTACHMENT_LONG_EDGE }
      )
    : ImageManipulator.manipulate(sourceUri);

  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: ATTACHMENT_JPEG_QUALITY,
  });

  return {
    uri: result.uri,
    mime: 'image/jpeg',
    width: rendered.width,
    height: rendered.height,
    resized,
  };
}

/** Filename for a normalised attachment — the extension must match the bytes. */
export function normalizedAttachmentFilename(sourceUri: string): string {
  const raw = sourceUri.split('/').pop()?.split('?')[0] || 'photo';
  const stem = raw.replace(/\.[^.]+$/, '') || 'photo';
  return `${stem}.jpg`;
}
