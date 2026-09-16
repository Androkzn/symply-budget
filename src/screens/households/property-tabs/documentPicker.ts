import * as DocumentPicker from 'expo-document-picker';
import { Alert, type AlertButton } from 'react-native';

import { MAX_UPLOAD_BYTES, oversizeFileMessage } from '@components/cloud-storage/CloudFilePicker';
import ImageCropPicker from '@services/image-picker-compat';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

/** A picked document ready to hand to a multipart upload ({uri,name,type}). */
export type PickedDocument = { uri: string; name: string; type: string };

/**
 * What an assessment or tax notice actually looks like on someone's device: the
 * mailed PDF, or a photo of the paper one. Filtering a cloud picker down to
 * `application/pdf` hides every photographed notice — HEIC included, which is
 * what an iPhone saves by default.
 */
export const PROPERTY_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/**
 * Infer a content type from a file name or URI. Cloud pickers hand back a name
 * and a URI but no mime type, and labelling a photographed notice
 * "application/pdf" sends it upstream untouched, where it fails.
 */
export function contentTypeFromUri(uri: string, fallback = 'image/jpeg'): string {
  const ext = uri.split('.').pop()?.toLowerCase().split('?')[0];
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return fallback;
  }
}

async function takePhoto(): Promise<PickedDocument | null> {
  try {
    const image = await ImageCropPicker.openCamera({
      cropping: false,
      compressImageQuality: 0.85,
      mediaType: 'photo',
    });
    return toVisionSafeAttachment({
      uri: image.path,
      name: `document_${Date.now()}.jpg`,
      type: image.mime || contentTypeFromUri(image.path),
    });
  } catch (error) {
    if (isPickerPermissionError(error)) {
      presentPickerPermissionDeniedAlert('camera');
    } else if ((error as { code?: string })?.code !== 'E_PICKER_CANCELLED') {
      console.error('[documentPicker] camera error:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
    return null;
  }
}

async function pickFromLibrary(): Promise<PickedDocument | null> {
  try {
    const image = await ImageCropPicker.openPicker({
      cropping: false,
      compressImageQuality: 0.85,
      mediaType: 'photo',
    });
    return toVisionSafeAttachment({
      uri: image.path,
      name: image.filename || `document_${Date.now()}.jpg`,
      type: image.mime || contentTypeFromUri(image.path),
    });
  } catch (error) {
    if (isPickerPermissionError(error)) {
      presentPickerPermissionDeniedAlert('library');
    } else if ((error as { code?: string })?.code !== 'E_PICKER_CANCELLED') {
      console.error('[documentPicker] library error:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
    return null;
  }
}

async function pickFile(): Promise<PickedDocument | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return null;
    const asset = result.assets[0];
    // Fail fast on something the upload route would reject anyway, with the real
    // limit rather than a generic "couldn't read that notice" after the upload.
    if (typeof asset.size === 'number' && asset.size > MAX_UPLOAD_BYTES) {
      Alert.alert('File Too Large', oversizeFileMessage(asset.size, asset.name));
      return null;
    }
    const picked: PickedDocument = {
      uri: asset.uri,
      name: asset.name || `document_${Date.now()}`,
      type: asset.mimeType || contentTypeFromUri(asset.name || asset.uri, 'application/pdf'),
    };
    // Files hands back whatever is on disk — on iPhone that is usually HEIC,
    // which the backend refuses. Re-encode images the way the camera and library
    // paths already do; PDFs pass through untouched.
    if (picked.type.startsWith('image/')) {
      return await toVisionSafeAttachment(picked);
    }
    return picked;
  } catch (error) {
    console.error('[documentPicker] file error:', error);
    Alert.alert('Error', 'Failed to pick file. Please try again.');
    return null;
  }
}

/**
 * Present the standard "add a document" source menu (Take Photo / Photo Library
 * / Files) and resolve with the picked document, or null if cancelled. Mirrors
 * the source options used for utility-bill uploads.
 *
 * Pass {@link Options.onGoogleDrive} to add a "Google Drive" entry — the caller
 * owns the Drive picker (a modal), so this resolves `null` and hands off to the
 * callback, which reports the chosen file separately. Each surface can pin its
 * own remembered Drive folder via the picker's `rememberScope`.
 */
type PickDocumentOptions = { onGoogleDrive?: () => void };

export function pickPropertyDocument(
  title = 'Add Document',
  options?: PickDocumentOptions
): Promise<PickedDocument | null> {
  return new Promise((resolve) => {
    const buttons: AlertButton[] = [
      { text: 'Take Photo', onPress: () => takePhoto().then(resolve) },
      { text: 'Photo Library', onPress: () => pickFromLibrary().then(resolve) },
      { text: 'Files (PDF)', onPress: () => pickFile().then(resolve) },
    ];
    if (options?.onGoogleDrive) {
      buttons.push({
        text: 'Google Drive',
        onPress: () => {
          // No local file here — the Drive picker opens next and reports back.
          resolve(null);
          options.onGoogleDrive?.();
        },
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel', onPress: () => resolve(null) });
    Alert.alert(title, 'Choose a source for the PDF or photo', buttons, {
      cancelable: true,
      onDismiss: () => resolve(null),
    });
  });
}
