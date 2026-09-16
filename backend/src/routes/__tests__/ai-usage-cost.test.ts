/**
 * micro-USD → USD conversion for the AI-usage cost report. Stored cost is in
 * micro-USD (1_000_000 = $1); the endpoint renders dollars rounded to 4 dp.
 */
import { describe, it, expect } from 'vitest';

import { toUsd } from '../ai-usage';

describe('toUsd — micro-USD → USD (4 dp)', () => {
  it('converts whole and fractional dollars', () => {
    expect(toUsd(1_000_000)).toBe(1);
    expect(toUsd(1_500_000)).toBe(1.5);
    expect(toUsd(2_340_000)).toBe(2.34);
  });

  it('rounds to 4 decimal places (hundredths of a cent)', () => {
    expect(toUsd(1234)).toBe(0.0012); // 0.001234 → 0.0012
    expect(toUsd(500)).toBe(0.0005);
    expect(toUsd(50)).toBe(0.0001); // 0.00005 rounds up at 4 dp
  });

  it('treats 0, null, undefined, and NaN as $0', () => {
    expect(toUsd(0)).toBe(0);
    // @ts-expect-error — runtime guards for null rows
    expect(toUsd(null)).toBe(0);
    // @ts-expect-error — runtime guards for undefined
    expect(toUsd(undefined)).toBe(0);
    expect(toUsd(NaN)).toBe(0);
  });

  it('preserves sign for credits/refunds', () => {
    expect(toUsd(-2_000_000)).toBe(-2);
  });
});
