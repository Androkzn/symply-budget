/**
 * Integer minor-unit money helpers (never floating point for ledger amounts).
 */

export type MinorUnits = number;

export function assertMinorUnits(value: number): asserts value is MinorUnits {
  if (!Number.isInteger(value)) {
    throw new Error('amount must be integer minor units');
  }
}

export function addMinor(a: MinorUnits, b: MinorUnits): MinorUnits {
  assertMinorUnits(a);
  assertMinorUnits(b);
  return a + b;
}

export function subMinor(a: MinorUnits, b: MinorUnits): MinorUnits {
  assertMinorUnits(a);
  assertMinorUnits(b);
  return a - b;
}

/** Format minor units for display (not for storage). */
export function formatMinor(amount: MinorUnits, fractionDigits = 2): string {
  assertMinorUnits(amount);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 10 ** fractionDigits);
  const frac = String(abs % 10 ** fractionDigits).padStart(fractionDigits, '0');
  return `${sign}${whole}.${frac}`;
}
