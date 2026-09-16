import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export interface VisionAttachment {
  uri: string;
  name: string;
  type: string;
}

/** Image formats the AI vision model can read directly (no HEIC/HEIF). */
export const VISION_SAFE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Savings-import precedent — long edge before JPEG 0.8. */
const VISION_LONG_EDGE = 1568;

/**
 * iOS photos come back as HEIC (`IMG_1071.heic`) by default, which the vision
 * model can't read. Re-encode any non-supported image to JPEG, and cap the
 * long edge at 1568 so Costco-length photos stay under the 5 MB BYOK cap.
 */
export async function toVisionSafeAttachment<T extends VisionAttachment>(attachment: T): Promise<T> {
  const isPdf = attachment.type === 'application/pdf' || /\.pdf$/i.test(attachment.name);
  if (isPdf) return attachment;

  const isSafeImage =
    VISION_SAFE_IMAGE_TYPES.includes(attachment.type.toLowerCase()) &&
    !/\.(heic|heif)$/i.test(attachment.name);

  const preview = await ImageManipulator.manipulate(attachment.uri).renderAsync();
  const longEdge = Math.max(preview.width, preview.height);
  const needsResize = longEdge > VISION_LONG_EDGE;
  if (isSafeImage && !needsResize) {
    return attachment;
  }

  const context = needsResize
    ? ImageManipulator.manipulate(attachment.uri).resize({
        width:
          preview.width >= preview.height
            ? VISION_LONG_EDGE
            : Math.round((preview.width / preview.height) * VISION_LONG_EDGE),
      })
    : ImageManipulator.manipulate(attachment.uri);
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const name = `${attachment.name.replace(/\.[^.]+$/, '') || 'attachment'}.jpg`;
  if (__DEV__) {
    console.log(
      `[BUDGET-E2E][scan.asset.client] ${JSON.stringify({
        from: attachment.type,
        longEdge,
        resized: needsResize,
        outWidth: rendered.width,
        outHeight: rendered.height,
      })}`,
    );
  }
  return { ...attachment, uri: result.uri, name, type: 'image/jpeg' };
}
