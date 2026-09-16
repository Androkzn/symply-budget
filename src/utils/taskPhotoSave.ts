/**
 * Task photo model + picker, shared by every form that attaches photos.
 *
 * A task photo can reach the server on either of TWO paths, and this module is
 * where they meet:
 *
 *   **legacy R2** — `uploadTaskPhotos` POSTs to `/tasks/photos/upload-url` and
 *   the form keeps a `photo_key`. Correct for a server-backed household, and
 *   completely wrong for a local-first one: the key names an object the peer's
 *   Worker never wrote.
 *
 *   **H6 encrypted blob channel** — `uploadHouseBlob` seals the bytes to the
 *   household key and the form keeps a `HouseBlobDescriptor`. Content-derived
 *   and device-independent, so a peer that syncs the row can open the photo.
 *
 * `TaskFormPhoto` carries whichever one produced it, and `buildTaskPhotoSavePayload`
 * refuses to re-upload a photo that already has bytes somewhere — which is the
 * whole reason a descriptor is allowed to ride alongside a key rather than
 * replacing it. Both fields optional, both paths intact.
 */
import {
  blobKeyFor as blobPhotoKey,
  type HouseBlobDescriptor,
} from '@features/house/local/blobs';
import ImageCropPicker from '@services/image-picker-compat';
import { uploadTaskPhotos } from '@utils/photoUpload';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';

export const MAX_TASK_PHOTOS = 5;

/**
 * Synthetic `photo_key` namespace for blob-backed photos.
 *
 * Re-exported, not defined: the namespace is a fact about the blob channel and
 * now lives beside the descriptor it is built from
 * (`@features/house/local/blobs`). It stays named here because a task photo is
 * the reason it exists and every caller in `src/components/tasks/**` reaches for
 * it under these names — moving the definition should not mean touching them.
 */
export {
  BLOB_KEY_PREFIX as BLOB_PHOTO_KEY_PREFIX,
  blobKeyFor as blobPhotoKey,
  isBlobKey as isBlobPhotoKey,
} from '@features/house/local/blobs';

export interface TaskFormPhoto {
  /** Server id when editing an existing attachment. */
  id?: string;
  /**
   * Local file path or remote URL for preview.
   *
   * Empty for a photo that arrived from a peer through the blob channel — those
   * have no URL at all, only a descriptor, and render through `HouseBlobImage`.
   */
  uri: string;
  /** R2 key after upload, or existing key from the server. */
  photo_key?: string;
  /**
   * H6 descriptor when the bytes went through the encrypted blob channel.
   * Present ⇒ the bytes are already uploaded and sealed; the legacy R2 path
   * must not run for this photo.
   */
  blob?: HouseBlobDescriptor | null;
}

/** One entry of the create/update photo array. */
export interface TaskPhotoSaveItem {
  photo_key: string;
  /** Rides alongside the key so the descriptor reaches the ledger row. */
  blob?: HouseBlobDescriptor;
}

export interface TaskPhotoSavePayload {
  photos?: TaskPhotoSaveItem[];
  cover_photo_index?: number;
}

/**
 * Upload local photos and build the API payload for create/update.
 *
 * The ordering of the three branches is the contract. A descriptor is checked
 * FIRST: a blob-backed photo also carries a synthetic `photo_key`, and reading
 * that key as "already on R2" would drop the descriptor on the floor and leave
 * the row pointing at an object that does not exist. Only a photo with neither
 * bytes-on-R2 nor bytes-in-the-blob-channel is uploaded here.
 */
export async function buildTaskPhotoSavePayload(
  householdId: string,
  photos: TaskFormPhoto[],
  coverPhotoIndex: number
): Promise<TaskPhotoSavePayload> {
  if (photos.length === 0) {
    return { photos: [], cover_photo_index: 0 };
  }

  const uploaded: TaskPhotoSaveItem[] = [];

  for (const photo of photos) {
    if (photo.blob) {
      // Already sealed and uploaded by the picker. Re-running the legacy path
      // here would send the same image a second time, to a bucket the
      // local-first household does not read from.
      uploaded.push({ photo_key: blobPhotoKey(photo.blob), blob: photo.blob });
      continue;
    }

    if (photo.photo_key) {
      uploaded.push({ photo_key: photo.photo_key });
      continue;
    }

    const results = await uploadTaskPhotos(householdId, [photo.uri]);
    uploaded.push({ photo_key: results[0].photo_key });
  }

  return {
    photos: uploaded,
    cover_photo_index: Math.min(
      Math.max(coverPhotoIndex, 0),
      uploaded.length - 1
    ),
  };
}

/**
 * What a picker returns.
 *
 * The `mime` is not decoration: `uploadHouseBlob` writes it into the descriptor,
 * and it is what tells a peer whether to render the attachment as an image at
 * all. The legacy path never needed it because R2 kept the content type.
 */
export interface TaskPickedPhoto {
  uri: string;
  mime: string;
}

export async function pickTaskPhotoFromLibrary(
  accentColor: string
): Promise<TaskPickedPhoto | null> {
  try {
    const image = await ImageCropPicker.openPicker({
      width: 1200,
      height: 900,
      cropping: true,
      cropperToolbarTitle: 'Crop Photo',
      cropperActiveWidgetColor: accentColor,
      cropperStatusBarColor: '#000000',
      cropperToolbarColor: '#000000',
      cropperToolbarWidgetColor: '#FFFFFF',
      compressImageQuality: 0.8,
      mediaType: 'photo',
      freeStyleCropEnabled: false,
    });
    return { uri: image.path, mime: image.mime || 'image/jpeg' };
  } catch (error: unknown) {
    if (isPickerPermissionError(error)) {
      presentPickerPermissionDeniedAlert('library');
      return null;
    }
    const err = error as { code?: string };
    if (err.code !== 'E_PICKER_CANCELLED') {
      throw error;
    }
    return null;
  }
}

export async function takeTaskPhoto(
  accentColor: string
): Promise<TaskPickedPhoto | null> {
  try {
    const image = await ImageCropPicker.openCamera({
      width: 1200,
      height: 900,
      cropping: true,
      cropperToolbarTitle: 'Crop Photo',
      cropperActiveWidgetColor: accentColor,
      cropperStatusBarColor: '#000000',
      cropperToolbarColor: '#000000',
      cropperToolbarWidgetColor: '#FFFFFF',
      compressImageQuality: 0.8,
      freeStyleCropEnabled: false,
    });
    return { uri: image.path, mime: image.mime || 'image/jpeg' };
  } catch (error: unknown) {
    if (isPickerPermissionError(error)) {
      presentPickerPermissionDeniedAlert('camera');
      return null;
    }
    const err = error as { code?: string };
    if (err.code !== 'E_PICKER_CANCELLED') {
      throw error;
    }
    return null;
  }
}
