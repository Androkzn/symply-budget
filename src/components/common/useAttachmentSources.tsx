/**
 * The four places a file can come from, once, for the whole app.
 *
 * ## Why this exists
 *
 * Every surface that accepts an image had grown its own picker, and none of
 * them offered the same list: the material references opened the photo library
 * and nothing else, the avatar offered camera and library, the contractor form
 * added Files, and only six surfaces in the whole fleet ever reached Google
 * Drive. Where a member's images live is a FACT about their phone, not a
 * preference — the shot taken just now is in the camera, the one saved months
 * ago is in the gallery, anything that arrived by email is in Files, and a
 * household that keeps its documents in Drive has none of them on the device at
 * all. A surface offering three of the four silently excludes whoever keeps
 * theirs in the fourth, and there is no error message for that: the member just
 * cannot do the thing.
 *
 * So the list is not a per-screen decision any more. `ScanImportSources` was
 * already the shared ROW; this is the shared BEHAVIOUR behind it — the picker
 * calls, the cancel contract, the permission alerts, the mime filtering and the
 * Drive browse — so a screen supplies a destination and gets all four sources
 * whether it wants them or not.
 *
 * ## What a caller still owns
 *
 * Only the destination. `onPicked` receives {@link PickedAttachment}s in pick
 * order and does whatever that surface does with them — seal a blob, upload to
 * R2, set a draft field. Nothing here writes anything.
 *
 * ## The cancel contract
 *
 * `image-picker-compat` throws `E_PICKER_CANCELLED` rather than returning
 * empty, and `expo-document-picker` returns `{canceled: true}`. Both mean "the
 * member changed their mind", both are swallowed here, and neither reaches
 * `onPicked`. A denied OS permission is different — it is answered with the
 * one shared alert that offers Settings, because by the time the shim throws it
 * the OS has already asked and there is nothing left to retry in-app.
 */
import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { CloudFilePicker } from '@components/cloud-storage';
import ImageCropPicker, {
  type CropPickerOptions,
  type CropPickerResult,
} from '@services/image-picker-compat';
import {
  isPickerPermissionError,
  presentPickerPermissionDeniedAlert,
} from '@utils/pickerPermissionAlert';

import type { ScanImportSourceKey } from './ScanImportSources';

/**
 * One picked file, in the only shape every source can honestly produce.
 *
 * `uri` is the sole guarantee. The camera rarely names its output, Drive
 * reports a name and a size but no mime, and only Files reports all four — so
 * everything except the uri is optional rather than invented. A caller that
 * needs a mime for a file that has none should derive it from the name, which
 * is what {@link mimeFromName} does for the Drive branch.
 */
export interface PickedAttachment {
  uri: string;
  name?: string;
  mime?: string;
  size?: number;
}

/**
 * The image types every surface in the fleet accepts.
 *
 * HEIC is included deliberately: an iPhone original is a normal thing to pick,
 * and both upload paths re-encode to JPEG before sending anything. Leaving it
 * out would grey out the member's own photos in the Files browser.
 */
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
];

/** Images plus PDF — for surfaces where a document is as valid as a photo. */
export const IMAGE_OR_PDF_MIME_TYPES = [...IMAGE_MIME_TYPES, 'application/pdf'];

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
  gif: 'image/gif',
  pdf: 'application/pdf',
};

/**
 * Best-effort mime for a file that only reported a name.
 *
 * Drive hands back a name and no content type, and a blob sealed with no mime
 * renders as nothing at all on the other device — so a guess from the extension
 * beats `undefined` here. `undefined` when the extension is unrecognised, which
 * lets the caller decide rather than mislabelling the bytes.
 */
export function mimeFromName(name?: string): string | undefined {
  const ext = name?.split('.').pop()?.toLowerCase();
  return ext ? EXTENSION_MIME[ext] : undefined;
}

export interface UseAttachmentSourcesOptions {
  /**
   * Every picked file, in pick order. Called once per trip, never per file, so
   * a surface that batches its writes gets to batch them.
   */
  onPicked: (
    items: PickedAttachment[],
    source: ScanImportSourceKey,
  ) => void | Promise<void>;
  /**
   * How many files one trip may return. `1` (the default) keeps the gallery,
   * Files and Drive single-select, which is what a field holding ONE image
   * wants — a member who ticks six for an avatar has been misled by the UI.
   */
  limit?: number;
  /** What the Files and Drive browsers may return. Defaults to images. */
  mimeTypes?: string[];
  /**
   * Namespaces Drive's remembered folder. Required rather than defaulted: two
   * surfaces sharing a scope would silently fight over one pinned folder, and
   * the member would see a picker that keeps opening somewhere else.
   */
  rememberScope: string;
  /** Passed through to the camera and gallery — cropping, quality, media type. */
  pickerOptions?: CropPickerOptions;
  /** Largest file Drive may hand back, in bytes. Defaults to the fleet's 32 MB. */
  maxFileBytes?: number;
  /** Blocks every source. The tiles disable themselves from the same flag. */
  disabled?: boolean;
  /**
   * Handle a picker failure yourself instead of letting it raise an alert.
   *
   * Some surfaces answer failures inline rather than with a modal — the Health
   * screens keep a `message` line under the tile row, and replacing it with an
   * alert would be a regression in that screen's idiom for the sake of
   * uniformity nobody asked for. The LIST is what has to be identical
   * everywhere; how a screen voices a failure is its own business. A denied
   * permission still goes to the shared Settings alert, because that one has an
   * action attached and inline text cannot offer it.
   */
  onError?: (message: string) => void;
}

export interface AttachmentSources {
  /** Spread straight onto `<ScanImportSources />`. */
  sourceHandlers: {
    onCamera: () => void;
    onGallery: () => void;
    onFile: () => void;
    onDrive: () => void;
  };
  /** Mount once, anywhere in the tree. Renders nothing until Drive is opened. */
  drivePicker: React.ReactElement;
  /** True while the Drive browse is on screen — a host sheet should hide itself. */
  driveOpen: boolean;
}

function fromCropResult(result: CropPickerResult): PickedAttachment {
  return {
    uri: result.path,
    name: result.filename,
    mime: result.mime,
    size: result.size,
  };
}

/**
 * The single-pick result, whatever shape it arrives in.
 *
 * `openPicker` is typed to return one asset, but the RNICP API it stands in for
 * answered a single pick with an ARRAY under some options, and several screens
 * carried their own `Array.isArray(image) ? image[0] : image` guard because of
 * it. Keeping that guard in one place is the point of this hook: dropping it
 * per-screen would turn one picked photo into `uri: undefined` and an upload of
 * nothing, with no error anywhere.
 */
function firstCropResult(
  result: CropPickerResult | CropPickerResult[],
): CropPickerResult | undefined {
  return Array.isArray(result) ? result[0] : result;
}

export function useAttachmentSources({
  onPicked,
  limit = 1,
  mimeTypes = IMAGE_MIME_TYPES,
  rememberScope,
  pickerOptions,
  maxFileBytes,
  disabled,
  onError,
}: UseAttachmentSourcesOptions): AttachmentSources {
  const [driveOpen, setDriveOpen] = useState(false);
  const multiple = limit > 1;

  const deliver = useCallback(
    async (items: PickedAttachment[], source: ScanImportSourceKey) => {
      const room = items.slice(0, limit);
      if (room.length === 0) return;
      await onPicked(room, source);
      if (items.length > room.length) {
        Alert.alert(
          'That is the limit',
          `We take ${limit} at a time, so the last ${
            items.length - room.length
          } were not added.`,
        );
      }
    },
    [limit, onPicked],
  );

  /**
   * One catch for both image pickers.
   *
   * The three outcomes are genuinely different and were being collapsed into
   * one generic line across the fleet: a cancel is silence, a denied permission
   * is the Settings alert, and anything else names the OTHER sources rather
   * than leaving the member at a dead end.
   */
  const handlePickerError = useCallback(
    (error: unknown, kind: 'camera' | 'library') => {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert(kind);
        return;
      }
      if ((error as { code?: string } | null)?.code === 'E_PICKER_CANCELLED') {
        return;
      }
      const title =
        kind === 'camera'
          ? 'The camera could not be opened.'
          : 'The photo library could not be opened.';
      if (onError) {
        onError(title);
        return;
      }
      Alert.alert(title, 'Try one of the other sources instead.');
    },
    [onError],
  );

  const onCamera = useCallback(() => {
    if (disabled) return;
    void (async () => {
      try {
        const shot = firstCropResult(
          await ImageCropPicker.openCamera({
            mediaType: 'photo',
            compressImageQuality: 0.9,
            ...pickerOptions,
          }),
        );
        if (!shot) return;
        await deliver([fromCropResult(shot)], 'camera');
      } catch (error) {
        handlePickerError(error, 'camera');
      }
    })();
  }, [deliver, disabled, handlePickerError, pickerOptions]);

  const onGallery = useCallback(() => {
    if (disabled) return;
    void (async () => {
      try {
        if (multiple) {
          const picked = await ImageCropPicker.openPickerMultiple({
            mediaType: 'photo',
            compressImageQuality: 0.9,
            ...pickerOptions,
            // The room actually left, so the OS picker greys out the one over
            // the limit instead of the app apologising for it afterwards.
            selectionLimit: limit,
          });
          await deliver(picked.map(fromCropResult), 'gallery');
          return;
        }
        const picked = firstCropResult(
          await ImageCropPicker.openPicker({
            mediaType: 'photo',
            compressImageQuality: 0.9,
            ...pickerOptions,
          }),
        );
        if (!picked) return;
        await deliver([fromCropResult(picked)], 'gallery');
      } catch (error) {
        handlePickerError(error, 'library');
      }
    })();
  }, [deliver, disabled, handlePickerError, limit, multiple, pickerOptions]);

  const onFile = useCallback(() => {
    if (disabled) return;
    void (async () => {
      try {
        const picked = await DocumentPicker.getDocumentAsync({
          type: mimeTypes,
          copyToCacheDirectory: true,
          multiple,
        });
        if (picked.canceled) return;
        await deliver(
          picked.assets.map(asset => ({
            uri: asset.uri,
            name: asset.name,
            mime: asset.mimeType ?? mimeFromName(asset.name),
            size: asset.size ?? undefined,
          })),
          'file',
        );
      } catch {
        const message = 'The file picker could not be opened.';
        if (onError) onError(message);
        else Alert.alert(message, 'Try one of the other sources instead.');
      }
    })();
  }, [deliver, disabled, mimeTypes, multiple, onError]);

  const onDrive = useCallback(() => {
    if (disabled) return;
    setDriveOpen(true);
  }, [disabled]);

  const handleDriveFiles = useCallback(
    (files: ReadonlyArray<{ uri: string; name: string; size: number }>) => {
      setDriveOpen(false);
      void deliver(
        files.map(file => ({
          uri: file.uri,
          name: file.name,
          mime: mimeFromName(file.name),
          size: file.size,
        })),
        'drive',
      );
    },
    [deliver],
  );

  const drivePicker = useMemo(
    () => (
      <CloudFilePicker
        visible={driveOpen}
        provider="google-drive"
        mimeTypeFilter={mimeTypes}
        rememberScope={rememberScope}
        multiSelect={multiple}
        {...(maxFileBytes ? { maxFileBytes } : {})}
        onClose={() => setDriveOpen(false)}
        onFileSelected={file => handleDriveFiles([file])}
        onFilesSelected={files => handleDriveFiles(files)}
      />
    ),
    [driveOpen, handleDriveFiles, maxFileBytes, mimeTypes, multiple, rememberScope],
  );

  const sourceHandlers = useMemo(
    () => ({ onCamera, onGallery, onFile, onDrive }),
    [onCamera, onDrive, onFile, onGallery],
  );

  return { sourceHandlers, drivePicker, driveOpen };
}
