import {
  isNumericKeyboardType,
  numericTextHandler,
  stripLettersForNumericInput,
} from '@utils/keyboard';

/**
 * Guards the fix for the Savings-goal defect: the field shipped with
 * `numbers-and-punctuation`, a keypad carrying an ABC key, so a member could
 * type letters straight into a currency field.
 */
describe('isNumericKeyboardType', () => {
  it.each(['number-pad', 'decimal-pad', 'numeric'] as const)('treats %s as numeric', (kt) => {
    expect(isNumericKeyboardType(kt)).toBe(true);
  });

  it.each(['default', 'email-address', 'url', 'phone-pad', 'numbers-and-punctuation'] as const)(
    'leaves %s alone',
    (kt) => {
      expect(isNumericKeyboardType(kt)).toBe(false);
    }
  );

  it('is false when a field declares no keyboardType at all', () => {
    expect(isNumericKeyboardType(undefined)).toBe(false);
  });
});

describe('stripLettersForNumericInput', () => {
  it('drops letters pasted into a money field', () => {
    expect(stripLettersForNumericInput('12abc34')).toBe('1234');
  });

  it('drops non-Latin letters too — the app ships in several locales', () => {
    expect(stripLettersForNumericInput('12абв34')).toBe('1234');
    expect(stripLettersForNumericInput('50円')).toBe('50');
  });

  // Fields across the app re-feed a FORMATTED value back into `value`, so
  // stripping punctuation here would fight the formatter and jump the caret.
  it('keeps the separators, signs and symbols a formatted value carries', () => {
    expect(stripLettersForNumericInput('-1,200.50')).toBe('-1,200.50');
    expect(stripLettersForNumericInput('$1 200')).toBe('$1 200');
  });

  it('leaves a clean number untouched', () => {
    expect(stripLettersForNumericInput('7000')).toBe('7000');
  });

  it('can empty the field when the paste was entirely letters', () => {
    expect(stripLettersForNumericInput('abc')).toBe('');
  });
});

describe('numericTextHandler', () => {
  it('filters before handing the text to the raw TextInput owner', () => {
    const onChangeText = jest.fn();
    numericTextHandler(onChangeText)('9a9');
    expect(onChangeText).toHaveBeenCalledWith('99');
  });

  it('is safe on a field with no handler', () => {
    expect(() => numericTextHandler(undefined)('123')).not.toThrow();
  });
});
