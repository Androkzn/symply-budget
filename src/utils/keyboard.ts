import { Keyboard } from 'react-native';
import type { KeyboardTypeOptions, ScrollViewProps } from 'react-native';

/**
 * Standard "tap outside to dismiss the keyboard" behaviour for scrollable forms.
 *
 * Spread this onto any `ScrollView` / `FlatList` / `SectionList` that contains
 * text inputs:
 *
 * ```tsx
 * <ScrollView {...keyboardDismissScrollProps}>...</ScrollView>
 * ```
 *
 * Why `"handled"` (and not the RN default of `"never"`):
 *  - Tapping empty space inside the scroll view dismisses the keyboard.
 *  - Tapping another field focuses it directly instead of the tap being
 *    swallowed (the default "never" eats the first tap, requiring a second).
 *  - Tapping a button still fires it while the keyboard is open.
 *
 * Screens that DON'T scroll should dismiss via their own handlers or
 * `Keyboard.dismiss()` — the root `TapOutsideWrapper` is intentionally a plain
 * `View` (a root `Pressable` breaks iOS ScrollView pans under Fabric; RN #56879).
 *
 * Searchable dropdown / picker lists are the one intentional exception — they
 * use `keyboardShouldPersistTaps="always"` so the keyboard stays up while you
 * tap a result.
 *
 * `automaticallyAdjustKeyboardInsets` is bundled in because dismissal and
 * OCCLUSION are the same problem seen from two sides, and shipping one without
 * the other is what produced a real defect twice: the keypad opened ON TOP of
 * the field that summoned it, so the member could not see what they were typing
 * and the button beside it was unreachable. It happened on Symply Health's Home
 * tab (log row at y≈569pt, keypad top edge at ≈568pt) and then again, unfixed,
 * in the shared `HealthSectionScreen` behind all twelve of its tabs.
 *
 * If a container genuinely must not shift — a full-bleed viewer, a map, a sheet
 * that does its own inset maths — do not spread this; set
 * `keyboardShouldPersistTaps` alone and say why in a comment.
 *
 * ## A `KeyboardAvoidingView` around the scroller is NOT a substitute
 *
 * This is the trap that produced the Budget "Edit income" defect: the form was
 * wrapped in `<KeyboardAvoidingView behavior="padding">`, so it *looked* handled.
 * But KAV only SHRINKS the viewport — it never moves the content inside it. The
 * field the member just tapped keeps its position, the viewport bottom rises
 * past it, and the field ends up behind the keypad with nothing scrolling it
 * back. `automaticallyAdjustKeyboardInsets` is the half that actually scrolls:
 * RN's iOS scroll view measures the focused input against the incoming keyboard
 * frame and offsets the content by the overlap (`RCTScrollViewComponentView`,
 * `_keyboardWillChangeFrame`). One shrinks, the other reveals — and only the
 * second one is what the member sees.
 *
 * So a scrollable form does not need a KAV at all: spread these props on the
 * ScrollView and delete the wrapper. Keep a KAV only where something OUTSIDE
 * the scroller must clear the keyboard — a pinned chat composer, a sheet whose
 * footer buttons sit below the list.
 *
 * Same reasoning rules out a fixed pixel `height` on a form scroller: it was
 * measured before the keyboard existed, so nothing about it survives the field
 * being focused. Let the scroller flex.
 */
export const keyboardDismissScrollProps: Pick<
  ScrollViewProps,
  'keyboardShouldPersistTaps' | 'automaticallyAdjustKeyboardInsets'
> = {
  keyboardShouldPersistTaps: 'handled',
  automaticallyAdjustKeyboardInsets: true,
};

/** Imperatively hide the keyboard from anywhere (services, effects, handlers). */
export const dismissKeyboard = (): void => Keyboard.dismiss();

/**
 * ## Which `keyboardType` a field gets
 *
 * Pick by what the field MEANS, not by what happens to parse. A member who taps
 * a money field and gets a QWERTY row has been handed the wrong tool, and on a
 * letters-capable keypad they can type "abc" into a figure that reaches D1.
 *
 * | Field means…                            | `keyboardType`                     |
 * |-----------------------------------------|------------------------------------|
 * | Money, weight, distance, any decimal    | `decimal-pad`                      |
 * | Whole count — reps, servings, age, days | `number-pad`                       |
 * | PIN / verification code                 | `number-pad` + `secureTextEntry`   |
 * | Phone number                            | `phone-pad`                        |
 * | Email                                   | `email-address` + `autoCapitalize="none"` |
 * | URL                                     | `url` + `autoCapitalize="none"`    |
 * | Free text, names, notes                 | omit (`default`)                   |
 *
 * **`numbers-and-punctuation` is never the right answer for a number.** It is
 * the keypad in the Budget Savings-goal defect: it carries an `ABC` key, so the
 * member can type letters straight into a currency field. It exists for mixed
 * strings (a licence plate, a flight number) — reach for it only there.
 *
 * ### Negative numbers
 * `decimal-pad` has no minus key on iOS. A field that legitimately accepts a
 * negative (a planned deficit month) must therefore render its own sign control
 * — a `±` toggle beside the field — and keep `decimal-pad`. Do NOT downgrade the
 * keypad to `numbers-and-punctuation` to buy a minus sign; that reopens letters.
 */
const NUMERIC_KEYBOARD_TYPES: ReadonlySet<string> = new Set([
  'number-pad',
  'decimal-pad',
  'numeric',
]);

/** True for the keypads that are supposed to produce a number and nothing else. */
export function isNumericKeyboardType(keyboardType?: KeyboardTypeOptions): boolean {
  return keyboardType != null && NUMERIC_KEYBOARD_TYPES.has(keyboardType);
}

/**
 * Remove letters from text headed for a numeric field.
 *
 * Choosing the right keypad is necessary but NOT sufficient — a keypad is a
 * suggestion, not a constraint. Letters still arrive three ways it cannot stop:
 * a paste from the clipboard, a hardware/Bluetooth keyboard, and several Android
 * IMEs that keep their alphabetic row on a `numeric` field. This is the last
 * line, applied on every keystroke at the shared `TextInput`.
 *
 * **Letters only.** Separators, currency symbols and signs are deliberately left
 * alone: fields across this app re-feed a FORMATTED value back into `value`
 * ("$1,200", "-2 500"), so stripping punctuation here would fight the formatter
 * and make the caret jump on the next keystroke. Every numeric parser in the
 * codebase already discards non-digits (see `parseTargetDollars`, `toCents`), so
 * letters are the only class that has to die at the input.
 *
 * Unicode-aware (`\p{L}`) so Cyrillic, Greek and CJK are caught too, not just
 * A–Z — the app ships in multiple locales.
 */
export function stripLettersForNumericInput(text: string): string {
  return text.replace(/\p{L}/gu, '');
}

/**
 * Wrap an `onChangeText` so a numeric field can never receive letters.
 *
 * The shared `@components/ui` `TextInput` already does this for itself, keyed
 * off `keyboardType` — use this only on a RAW `react-native` `TextInput`, which
 * has no such chokepoint:
 *
 * ```tsx
 * <TextInput keyboardType="decimal-pad" onChangeText={numericTextHandler(setAmount)} />
 * ```
 */
export function numericTextHandler(
  handler?: (text: string) => void
): (text: string) => void {
  return (text: string) => handler?.(stripLettersForNumericInput(text));
}
