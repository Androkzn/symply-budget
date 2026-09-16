/**
 * Compat shim: `react-native-image-crop-picker` API surface backed by
 * `expo-image-picker`.
 *
 * Why: `react-native-image-crop-picker@0.51.1` (latest on npm) does not
 * register its native TurboModule under React Native's new architecture —
 * `newArchEnabled: true` is required by `react-native-reanimated@4+` in
 * this project, so turning the new arch off isn't an option. The crop
 * picker's native module fails to register at app startup and the
 * `TurboModuleRegistry.getEnforcing('RNCImageCropPicker')` call propagates
 * up through every `app/(tabs)/*.tsx` route loader, which is why the dev
 * menu reports 7 "missing default export" warnings on boot.
 *
 * This shim:
 *   - Matches the subset of the RNICP API actually used in the codebase
 *     (`openPicker`, `openCamera`, options that the call sites pass).
 *   - Returns a `{ path, width, height, mime, size }` shape so every caller
 *     that reads `image.path` works unchanged.
 *   - Preserves the `E_PICKER_CANCELLED` error-code contract so existing
 *     try/catch guards (`if (error.code !== 'E_PICKER_CANCELLED')`) still
 *     silently swallow cancel flows.
 *   - Lazily requests permissions on each call; silent if already granted.
 *
 * Callers should import from `@services/image-picker-compat` instead of
 * `react-native-image-crop-picker`. Keeping the variable name
 * `ImageCropPicker` on the import lets the 9 call sites remain unchanged
 * apart from the import specifier.
 */

import * as ImagePicker from 'expo-image-picker';

export interface CropPickerOptions {
  cropping?: boolean;
  cropperToolbarTitle?: string;
  cropperActiveWidgetColor?: string;
  cropperStatusBarColor?: string;
  cropperToolbarColor?: string;
  cropperToolbarWidgetColor?: string;
  /** 0.0 - 1.0; matches both the RNICP and Expo conventions. */
  compressImageQuality?: number;
  mediaType?: 'photo' | 'video' | 'any';
  freeStyleCropEnabled?: boolean;
  /** Fixed aspect ratios — ignored (expo's editor doesn't expose them). */
  width?: number;
  height?: number;
  /**
   * Multi-select. Honoured only by {@link ImageCropPicker.openPickerMultiple},
   * because `openPicker`'s return type is a single result and nine call sites
   * read `.path` off it directly.
   */
  multiple?: boolean;
  /**
   * Cap on how many assets `openPickerMultiple` may return. `0` is Expo's
   * "unlimited"; pass the room actually left so the OS picker greys out the
   * eleventh photo instead of the app apologising for it afterwards.
   */
  selectionLimit?: number;
}

export interface CropPickerResult {
  path: string;
  width: number;
  height: number;
  mime: string;
  size: number;
  /** Original file name when the platform provides it (gallery / some cameras). */
  filename?: string;
}

class PickerCancelledError extends Error {
  code = 'E_PICKER_CANCELLED';
  constructor() {
    super('User cancelled image selection');
    this.name = 'PickerCancelledError';
  }
}

class PickerPermissionError extends Error {
  code = 'E_NO_LIBRARY_PERMISSION';
  constructor(msg = 'Permission to access media library was denied') {
    super(msg);
    this.name = 'PickerPermissionError';
  }
}

function mediaTypeFromOption(
  opt: CropPickerOptions['mediaType']
): ImagePicker.MediaType[] {
  switch (opt) {
    case 'video':
      return ['videos'];
    case 'any':
      return ['images', 'videos'];
    case 'photo':
    default:
      return ['images'];
  }
}

function assetToResult(asset: ImagePicker.ImagePickerAsset): CropPickerResult {
  return {
    path: asset.uri,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
    mime: asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
    size: asset.fileSize ?? 0,
    filename: asset.fileName ?? undefined,
  };
}

async function ensureLibraryPermission(): Promise<void> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') throw new PickerPermissionError();
}

async function ensureCameraPermission(): Promise<void> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') {
    throw new PickerPermissionError('Permission to use the camera was denied');
  }
}

const ImageCropPicker = {
  async openPicker(opts: CropPickerOptions = {}): Promise<CropPickerResult> {
    await ensureLibraryPermission();
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaTypeFromOption(opts.mediaType),
      allowsEditing: opts.cropping ?? false,
      quality: opts.compressImageQuality ?? 0.8,
      selectionLimit: 1,
    });
    if (result.canceled || !result.assets?.[0]) throw new PickerCancelledError();
    return assetToResult(result.assets[0]);
  },

  /**
   * The multi-select sibling of {@link openPicker}.
   *
   * A separate method rather than a `multiple` branch inside `openPicker`,
   * because RNICP models this by returning either an object or an array from
   * one call — a union every one of the nine existing call sites would have to
   * narrow, for a capability none of them use. The shim honoured `multiple` in
   * its options type and hardcoded `selectionLimit: 1` regardless, so a caller
   * that asked for several silently got one; this is where "several" actually
   * works.
   *
   * Cancelling throws `E_PICKER_CANCELLED` like every other method here, so a
   * caller's existing guard keeps working unchanged.
   */
  async openPickerMultiple(opts: CropPickerOptions = {}): Promise<CropPickerResult[]> {
    await ensureLibraryPermission();
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaTypeFromOption(opts.mediaType),
      // Expo refuses `allowsEditing` together with multiple selection, and the
      // combination is meaningless anyway — there is no single asset to crop.
      allowsMultipleSelection: true,
      quality: opts.compressImageQuality ?? 0.8,
      selectionLimit: opts.selectionLimit ?? 0,
    });
    if (result.canceled || !result.assets?.length) throw new PickerCancelledError();
    return result.assets.map(assetToResult);
  },

  async openCamera(opts: CropPickerOptions = {}): Promise<CropPickerResult> {
    await ensureCameraPermission();
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: mediaTypeFromOption(opts.mediaType),
      allowsEditing: opts.cropping ?? false,
      quality: opts.compressImageQuality ?? 0.8,
    });
    if (result.canceled || !result.assets?.[0]) throw new PickerCancelledError();
    return assetToResult(result.assets[0]);
  },

  /**
   * `openCropper` — RNICP's standalone cropper. Expo doesn't ship a
   * standalone cropper, so we just return the asset as-is. Callers that
   * need real cropping should switch to openPicker with cropping:true
   * before invoking, or chain a dedicated image-editor library later.
   */
  async openCropper(opts: { path: string } & CropPickerOptions): Promise<CropPickerResult> {
    return {
      path: opts.path,
      width: opts.width ?? 0,
      height: opts.height ?? 0,
      mime: 'image/jpeg',
      size: 0,
      filename: undefined,
    };
  },
};

export default ImageCropPicker;
