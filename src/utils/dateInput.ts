/**
 * Typed-date masks, so a date field can run on a digits-only keypad.
 *
 * These live in `@utils` rather than inside one feature because the problem is
 * app-wide: a `YYYY-MM-DD` field needs two dashes, and the tempting way to buy
 * them is `keyboardType="numbers-and-punctuation"` — the same letters-capable
 * keypad (it carries an `ABC` key) as the Budget savings-goal defect, which let
 * a member type "abc" straight into a date. Insert the separators HERE instead
 * and the field can stay `number-pad`.
 *
 * See the keyboard rule table in `@utils/keyboard` for the wider contract.
 */

/**
 * `YYYY-MM-DD` as it is typed, on a digits-only keypad.
 *
 * Backspace still behaves: the mask is rebuilt from whatever digits are left, so
 * deleting the `5` of `2026-07-15` leaves `2026-07-1`, and deleting the `1`
 * leaves `2026-07` with its trailing dash gone rather than stranded.
 *
 * Eight digits always LOOK like a day key once they are punctuated, so the shape
 * this produces is not proof of a real date — pair it with a calendar check
 * (`isRealDayKey` in the health feature does exactly this).
 */
export function maskDayKeyInput(raw: string): string {
  if (typeof raw !== 'string') return '';
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/** `HH:MM` as it is typed — the clock half of `maskDayKeyInput`, same reasoning. */
export function maskClockInput(raw: string): string {
  if (typeof raw !== 'string') return '';
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
