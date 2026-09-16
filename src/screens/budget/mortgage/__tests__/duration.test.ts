/**
 * Unit toggle helpers for the mortgage forms — amortization/term can be entered
 * in years or months, but the API stores months. These tests pin the conversion
 * (including the years⇄months round-trip) so the toggle can never silently
 * change the real duration.
 */

import { convertDurationValue, durationToMonths } from '../duration';

describe('durationToMonths', () => {
  it('multiplies years by 12', () => {
    expect(durationToMonths('25', 'years')).toBe(300);
    expect(durationToMonths('5', 'years')).toBe(60);
  });

  it('takes months verbatim (rounded to whole months)', () => {
    expect(durationToMonths('18', 'months')).toBe(18);
    expect(durationToMonths('6', 'months')).toBe(6);
  });

  it('handles fractional years', () => {
    expect(durationToMonths('1.5', 'years')).toBe(18);
    expect(durationToMonths('2.5', 'years')).toBe(30);
  });

  it('returns NaN for empty / non-positive / non-numeric input', () => {
    expect(durationToMonths('', 'years')).toBeNaN();
    expect(durationToMonths('0', 'months')).toBeNaN();
    expect(durationToMonths('-3', 'years')).toBeNaN();
    expect(durationToMonths('abc', 'months')).toBeNaN();
  });
});

describe('convertDurationValue', () => {
  it('is a no-op when the unit does not change', () => {
    expect(convertDurationValue('25', 'years', 'years')).toBe('25');
  });

  it('converts years to months', () => {
    expect(convertDurationValue('25', 'years', 'months')).toBe('300');
    expect(convertDurationValue('5', 'years', 'months')).toBe('60');
  });

  it('converts months to years, allowing halves', () => {
    expect(convertDurationValue('300', 'months', 'years')).toBe('25');
    expect(convertDurationValue('18', 'months', 'years')).toBe('1.5');
  });

  it('passes empty / non-numeric input through unchanged', () => {
    expect(convertDurationValue('', 'years', 'months')).toBe('');
    expect(convertDurationValue('abc', 'months', 'years')).toBe('abc');
  });

  it('round-trips back to the same canonical months', () => {
    for (const months of [6, 12, 18, 60, 300, 13, 25]) {
      const asYears = convertDurationValue(String(months), 'months', 'years');
      expect(durationToMonths(asYears, 'years')).toBe(months);
    }
  });
});
