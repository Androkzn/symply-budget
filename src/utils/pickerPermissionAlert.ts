import { Alert, Linking } from 'react-native';

/**
 * The error code `image-picker-compat.ts` throws for both camera and photo
 * library denial (`PickerPermissionError`). One constant here so the ~20
 * call sites across the fleet that catch it don't each retype the string.
 */
export const PICKER_PERMISSION_ERROR_CODE = 'E_NO_LIBRARY_PERMISSION';

export function isPickerPermissionError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === PICKER_PERMISSION_ERROR_CODE;
}

/**
 * The one denied-permission alert for every `ImageCropPicker.openCamera` /
 * `openPicker` call site in the app (receipts, recipes, floor plans, task
 * photos, property documents — ~20 screens across House/Budget/Kaizen/Health).
 *
 * Before this, every one of those catch blocks only recognised
 * `E_PICKER_CANCELLED` and fell through to a generic "Could not open the
 * camera" for anything else, including a denied OS permission — which left
 * the member with no explanation and no way back except finding Settings
 * themselves. `image-picker-compat.ts` already calls
 * `request*PermissionsAsync()` before every picker/camera launch, so by the
 * time it throws this error the OS has already asked (or already refused to
 * ask again) — there is nothing left to retry in-app, only Settings.
 */
export function presentPickerPermissionDeniedAlert(kind: 'camera' | 'library'): void {
  const noun = kind === 'camera' ? 'Camera' : 'Photos';
  Alert.alert(
    `${noun} access is off`,
    `That's a fine choice — you can still add this by hand. If you change your mind, ${noun.toLowerCase()} access lives in Settings.`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ],
  );
}
