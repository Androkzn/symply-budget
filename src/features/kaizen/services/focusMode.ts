import { Linking, Platform } from 'react-native';

import { storageHelpers } from './storage';

/** Matches native `KaizenNativeConstants.focusFilterKey` / Focus Filter intent. */
export const FOCUS_FILTER_ACTIVE_KEY = 'kaizen.deepWork.focusFilterActive';

export function isDeepWorkFocusFilterActive(): boolean {
  return storageHelpers.getString(FOCUS_FILTER_ACTIVE_KEY) === 'true';
}

export function setDeepWorkFocusFilterActive(active: boolean): void {
  if (active) storageHelpers.setString(FOCUS_FILTER_ACTIVE_KEY, 'true');
  else storageHelpers.remove(FOCUS_FILTER_ACTIVE_KEY);
}

/**
 * Deep-work Focus Mode helpers.
 * Native `SetFocusFilterIntent` writes App Group `group.com.kaizen.app`;
 * `installKaizenNativeBridge` mirrors that into MMKV via this module.
 */
export async function openSystemFocusSettings(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const candidates = [
      'App-prefs:FOCUS',
      'App-prefs:root=FOCUS',
      'prefs:root=FOCUS',
    ];
    for (const url of candidates) {
      try {
        const can = await Linking.canOpenURL(url);
        if (can) {
          await Linking.openURL(url);
          return true;
        }
      } catch {
        /* try next */
      }
    }
    try {
      await Linking.openSettings();
      return true;
    } catch {
      return false;
    }
  }
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

export function focusModeHint(suggestFocusMode: boolean): string {
  if (!suggestFocusMode) return 'Focus Mode suggestion is off for this block.';
  if (isDeepWorkFocusFilterActive()) {
    return 'Deep Work Focus filter is active — non-deep-work nudges are muted.';
  }
  return Platform.OS === 'ios'
    ? 'Attach Kaizen Deep Work under Settings → Focus → Filters to mute nudges automatically.'
    : 'Silence notifications for this block using your device Focus / DND settings.';
}
