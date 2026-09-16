import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How much of the screen bottom the software keyboard is covering right now.
 *
 * A bottom sheet is anchored to the bottom edge, so an open keyboard sits on
 * top of it and hides whatever is lowest — which, in a sheet built around a
 * text field, is the field itself plus its Save button. (Reproduced on the
 * Device Sync → Rename sheet: only the handle and title cleared the keyboard,
 * and again on Budget's Savings → Projection goal sheet.)
 *
 * Sheets are rendered inside a `Modal`, where `KeyboardAvoidingView` is
 * unreliable, and a plain `behavior="padding"` wrapper would push a fixed-height
 * sheet off the TOP of the screen instead. Measuring the inset ourselves lets us
 * do both halves correctly: lift the sheet clear of the keyboard, and shrink its
 * height ceiling by the same amount so a tall sheet stays fully on screen.
 *
 * `will*` events on iOS fire alongside the keyboard's own animation, so the
 * sheet moves with it rather than after it; Android only has `did*`.
 *
 * Use this for content inside a `Modal`. A plain scrollable form needs no hook
 * at all — spread `keyboardDismissScrollProps` on its scroller instead, and read
 * `src/utils/keyboard.ts` for why a `KeyboardAvoidingView` is not a substitute.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvent, (event) => {
      // endCoordinates.height is 0 for an undocked/floating iPad keyboard, which
      // covers nothing — treating it as an inset would lift the sheet for no reason.
      setInset(event?.endCoordinates?.height ?? 0);
    });
    const onHide = Keyboard.addListener(hideEvent, () => setInset(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  return inset;
}
