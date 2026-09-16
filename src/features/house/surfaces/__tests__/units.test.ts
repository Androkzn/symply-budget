/**
 * Display units.
 *
 * The cases that matter are the ones where a wrong answer is *plausible*: a
 * suffix ignored because the picker said otherwise, a unit switch that
 * reinterprets a number instead of converting it, and a half-typed field
 * replaced with `NaN`. Each of those produces a room of the wrong size that
 * looks entirely reasonable on screen and becomes a material order.
 */

import {
  LENGTH_UNIT_OPTIONS,
  formatFeetInches,
  formatLength,
  formatSurfaceArea,
  isMetricUnit,
  lengthInputValue,
  lengthKeyboardType,
  lengthPlaceholder,
  lengthUnitFor,
  lengthUnitLabel,
  parseLength,
  type LengthUnit,
} from '../units';

const ALL_UNITS: LengthUnit[] = ['m', 'cm', 'ft', 'in'];

describe('choosing a unit', () => {
  it('defaults from the household setting, to the unit rooms are described in', () => {
    expect(lengthUnitFor('metric')).toBe('m');
    expect(lengthUnitFor('imperial')).toBe('ft');
    expect(lengthUnitFor(undefined)).toBe('ft');
  });

  it('offers all four, each with a label a screen reader can say', () => {
    expect(LENGTH_UNIT_OPTIONS.map(option => option.unit).sort()).toEqual(
      [...ALL_UNITS].sort(),
    );
    for (const option of LENGTH_UNIT_OPTIONS) {
      expect(option.accessibilityLabel.length).toBeGreaterThan(2);
    }
  });

  /**
   * A decimal pad cannot type a foot mark, so a member on `ft` with the wrong
   * keyboard enters `7.67` for `7' 8"` — a different wall, entered without any
   * sign that anything went wrong.
   *
   * The imperial answer is `numbers-and-punctuation`, NOT `default`: it still
   * carries `'` and `"` but puts the alphabet behind an `ABC` key instead of
   * offering a full QWERTY on a measurement.
   */
  it('raises a keyboard that can type the unit’s marks', () => {
    expect(lengthKeyboardType('m')).toBe('decimal-pad');
    expect(lengthKeyboardType('cm')).toBe('decimal-pad');
    expect(lengthKeyboardType('ft')).toBe('numbers-and-punctuation');
    expect(lengthKeyboardType('in')).toBe('numbers-and-punctuation');
  });

  it('knows which family a unit belongs to', () => {
    expect(isMetricUnit('m')).toBe(true);
    expect(isMetricUnit('cm')).toBe(true);
    expect(isMetricUnit('ft')).toBe(false);
    expect(isMetricUnit('in')).toBe(false);
  });

  it('has a label and a placeholder for every unit', () => {
    for (const unit of ALL_UNITS) {
      expect(lengthUnitLabel(unit)).toBeTruthy();
      expect(lengthPlaceholder(unit)).toBeTruthy();
    }
  });
});

describe('formatting', () => {
  it('renders 2.35 m in each unit', () => {
    expect(formatLength(2.35, 'm')).toBe('2.35 m');
    expect(formatLength(2.35, 'cm')).toBe('235 cm');
    expect(formatLength(2.35, 'ft')).toBe(`7' 9"`);
    expect(formatLength(2.35, 'in')).toBe('93"');
  });

  it('carries twelve inches up to a foot instead of showing 12"', () => {
    // 2.4384 m is exactly 8'. Rounding must not render it as 7' 12".
    expect(formatFeetInches(2.4384)).toBe(`8'`);
    expect(formatFeetInches(0.3048)).toBe(`1'`);
  });

  it('drops the feet when there are none', () => {
    expect(formatFeetInches(0.2032)).toBe('8"');
  });

  /**
   * A wall in square centimetres is 96,000 of them and no supplier quotes in
   * either that or square inches, so both metric units answer m² and both
   * imperial ones answer sq ft.
   */
  it('reports area in the two units anyone actually uses', () => {
    expect(formatSurfaceArea(8.64, 'm')).toBe('8.64 m²');
    expect(formatSurfaceArea(8.64, 'cm')).toBe('8.64 m²');
    expect(formatSurfaceArea(8.64, 'ft')).toContain('sq ft');
    expect(formatSurfaceArea(8.64, 'in')).toContain('sq ft');
  });

  it('prefills a field without a suffix where the keyboard is numeric', () => {
    expect(lengthInputValue(2.4, 'm')).toBe('2.40');
    expect(lengthInputValue(2.4, 'cm')).toBe('240');
    expect(lengthInputValue(2.4, 'ft')).toBe(`7' 10"`);
    expect(lengthInputValue(2.4, 'in')).toBe('94"');
  });
});

describe('parsing', () => {
  it('reads a bare number in the selected unit', () => {
    expect(parseLength('2.4', 'm')).toBeCloseTo(2.4, 6);
    expect(parseLength('240', 'cm')).toBeCloseTo(2.4, 6);
    expect(parseLength('8', 'ft')).toBeCloseTo(2.4384, 6);
    expect(parseLength('96', 'in')).toBeCloseTo(2.4384, 6);
  });

  /**
   * The rule that stops a picker from being a trap: someone reading a spec
   * sheet types what is printed on it, and honouring the suffix is the only
   * reading that cannot silently be wrong.
   */
  it('lets an explicit suffix beat the selected unit', () => {
    expect(parseLength('2.4m', 'ft')).toBeCloseTo(2.4, 6);
    expect(parseLength('240 cm', 'in')).toBeCloseTo(2.4, 6);
    expect(parseLength('600mm', 'ft')).toBeCloseTo(0.6, 6);
    expect(parseLength('18"', 'm')).toBeCloseTo(0.4572, 6);
    expect(parseLength(`6'`, 'cm')).toBeCloseTo(1.8288, 6);
    expect(parseLength('8 feet', 'm')).toBeCloseTo(2.4384, 6);
  });

  it('reads feet and inches together, with or without the space', () => {
    expect(parseLength(`7' 8"`, 'ft')).toBeCloseTo(2.3368, 4);
    expect(parseLength(`7'8`, 'ft')).toBeCloseTo(2.3368, 4);
    expect(parseLength('7ft 8in', 'ft')).toBeCloseTo(2.3368, 4);
    expect(parseLength('7 8', 'ft')).toBeCloseTo(2.3368, 4);
  });

  it('honours a foot mark whatever the picker says', () => {
    expect(parseLength(`7'8"`, 'm')).toBeCloseTo(2.3368, 4);
    expect(parseLength(`7' 8"`, 'cm')).toBeCloseTo(2.3368, 4);
  });

  /**
   * A bare pair is only a measurement in feet. In centimetres "240 3" is a
   * typo, and reading it as anything would invent a number the member did not
   * enter.
   */
  it('refuses a bare pair in a unit where it means nothing', () => {
    expect(parseLength('240 3', 'cm')).toBeNull();
    expect(parseLength('2 4', 'm')).toBeNull();
  });

  it('returns null rather than NaN for a half-typed field', () => {
    for (const unit of ALL_UNITS) {
      expect(parseLength('', unit)).toBeNull();
      expect(parseLength('   ', unit)).toBeNull();
      expect(parseLength('abc', unit)).toBeNull();
      expect(parseLength(`'`, unit)).toBeNull();
    }
  });

  it('round-trips every unit through format and back', () => {
    for (const unit of ALL_UNITS) {
      const parsed = parseLength(lengthInputValue(2.4, unit), unit);
      expect(parsed).not.toBeNull();
      // Fields are prefilled at the resolution a tape measure has — whole
      // centimetres, whole inches — so a round trip is exact to half of the
      // coarsest of those, which is half an inch.
      expect(Math.abs((parsed ?? 0) - 2.4)).toBeLessThanOrEqual(0.0127);
    }
  });

  /**
   * The conversion the unit picker performs. Switching must re-express the same
   * room, never reinterpret the digits — `11' 10"` becoming `11.83 m` is the
   * failure this guards.
   */
  it('converts a value between units without changing the room', () => {
    const typed = `11' 10"`;
    const metres = parseLength(typed, 'ft');
    expect(metres).toBeCloseTo(3.6068, 3);

    const asMetres = lengthInputValue(metres!, 'm');
    expect(asMetres).toBe('3.61');
    expect(parseLength(asMetres, 'm')).toBeCloseTo(3.61, 4);

    const asCm = lengthInputValue(metres!, 'cm');
    expect(asCm).toBe('361');
    expect(parseLength(asCm, 'cm')).toBeCloseTo(3.61, 4);
  });
});
