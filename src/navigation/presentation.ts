import { Platform, type ModalProps } from 'react-native';

import { useDeviceType } from '@hooks/useDeviceType';

export type NativeStackPresentation =
  | 'card'
  | 'modal'
  | 'transparentModal'
  | 'containedModal'
  | 'containedTransparentModal'
  | 'fullScreenModal'
  | 'formSheet';

/**
 * Returns the right modal presentation for the current device.
 * On iPad (iOS, regular width) → `formSheet` (centered ~540pt panel, iPadOS HIG).
 * On iPhone / compact widths → the caller-provided default (typically `modal`).
 *
 * Use this in screen options for create/edit/setup flows so the same screen
 * renders as a phone-style sheet on iPhone and a desktop-style form sheet
 * on iPad without needing two screen registrations.
 */
export function useModalPresentation(
  fallback: NativeStackPresentation = 'modal'
): NativeStackPresentation {
  const { isIPad, width } = useDeviceType();
  // Prefer form sheets on regular-width iPad windows, regardless of whether
  // the app is currently showing a sidebar.
  if (Platform.OS === 'ios' && isIPad && width >= 768) {
    return 'formSheet';
  }
  return fallback;
}

/**
 * Tall presentation for scroll-heavy create/edit forms (budget item, task edit, etc.).
 * iPad formSheet is a short centered panel where ScrollView often fails to receive
 * touches; fullScreenModal uses the entire screen so the form can scroll reliably.
 */
export function useScrollableFormPresentation(
  fallback: NativeStackPresentation = 'modal'
): NativeStackPresentation {
  const { isIPad, width } = useDeviceType();
  if (Platform.OS === 'ios' && isIPad && width >= 768) {
    return 'fullScreenModal';
  }
  return fallback;
}

/** @deprecated Use {@link useScrollableFormPresentation} */
export const useBudgetFormPresentation = useScrollableFormPresentation;

/**
 * True when a presentation renders as an iOS sheet card that slides up below
 * the status bar (`modal` → `UIModalPresentationPageSheet`, `formSheet`).
 *
 * Such a screen must NOT re-apply `useSafeAreaInsets().top` as top padding:
 * those are *window* insets, already outside the card, so applying them leaves
 * a blank status-bar-sized band inside the sheet. Pass the result to
 * `ScreenHeader`'s `insideSheet`. Full-screen presentations (`card`,
 * `fullScreenModal`, and everything on Android) do own the status bar and keep
 * the inset.
 */
export function isSheetPresentation(
  presentation: NativeStackPresentation
): boolean {
  if (Platform.OS !== 'ios') return false;
  return presentation === 'modal' || presentation === 'formSheet';
}

/**
 * Is THIS screen — one registered with {@link useScrollableFormPresentation} —
 * rendering as an iOS sheet card right now?
 *
 * Screens must DERIVE this rather than hardcode it. The presentation is
 * device-dependent (iPhone → `modal`, a page sheet whose card starts below the
 * status bar; iPad → `fullScreenModal`, which owns the status bar), so a
 * hand-set answer is wrong on one of the two form factors and has been wrong in
 * both directions: a blank status-bar-sized band inside the card when it says
 * "not a sheet", and header controls under the clock when it says "sheet" about
 * a full-screen presentation. Deriving it from the same helper the navigator
 * registered the screen with is what keeps the two ends from drifting apart.
 *
 * Pass the result to `ScreenHeader`'s `insideSheet` (and drop the `top`
 * safe-area edge from any `SafeAreaView` wrapping the screen — the card is
 * already below the status bar, so that inset would land inside it).
 */
export function useIsScrollableFormSheet(
  fallback: NativeStackPresentation = 'modal'
): boolean {
  return isSheetPresentation(useScrollableFormPresentation(fallback));
}

/** Sheet-ness of a screen registered with {@link useModalPresentation}. */
export function useIsModalSheet(
  fallback: NativeStackPresentation = 'modal'
): boolean {
  return isSheetPresentation(useModalPresentation(fallback));
}

/**
 * Task detail flow (nested detail → edit stack).
 * iPad formSheet breaks touch handling for the nested edit push — use card.
 */
export function useTaskDetailFlowPresentation(
  fallback: NativeStackPresentation = 'card'
): NativeStackPresentation {
  // Nested detail → edit must stay card on iOS (formSheet/modal breaks touches).
  if (Platform.OS === 'ios') {
    return 'card';
  }
  return fallback;
}

/** React Native Modal uses a different presentation vocabulary from a stack. */
export function useNativeModalPresentation(
  fallback: NonNullable<ModalProps['presentationStyle']> = 'pageSheet',
): NonNullable<ModalProps['presentationStyle']> {
  const { isIPad, width } = useDeviceType();
  return Platform.OS === 'ios' && isIPad && width >= 768 ? 'formSheet' : fallback;
}
