/**
 * Time-effort tier bucketing. Pure functions — the planner's greedy packing
 * relies on these thresholds, so every boundary is pinned.
 */
import { describe, it, expect } from 'vitest';

import {
  minutesToEffort,
  effortToMinutes,
  isTimeEffort,
  EFFORT_MINUTES,
  TIME_EFFORTS,
} from '../time-effort';

describe('minutesToEffort — bucket boundaries', () => {
  it('null / undefined / non-positive → null', () => {
    expect(minutesToEffort(null)).toBeNull();
    expect(minutesToEffort(undefined)).toBeNull();
    expect(minutesToEffort(0)).toBeNull();
    expect(minutesToEffort(-10)).toBeNull();
  });

  it('non-number input → null', () => {
    expect(minutesToEffort(NaN)).toBeNull();
    // @ts-expect-error — guarding runtime callers passing junk
    expect(minutesToEffort('30')).toBeNull();
  });

  it('quick: (0, 15]', () => {
    expect(minutesToEffort(1)).toBe('quick');
    expect(minutesToEffort(15)).toBe('quick'); // inclusive upper bound
  });

  it('short: (15, 45]', () => {
    expect(minutesToEffort(16)).toBe('short');
    expect(minutesToEffort(45)).toBe('short');
  });

  it('medium: (45, 120]', () => {
    expect(minutesToEffort(46)).toBe('medium');
    expect(minutesToEffort(120)).toBe('medium');
  });

  it('half_day: (120, 300]', () => {
    expect(minutesToEffort(121)).toBe('half_day');
    expect(minutesToEffort(300)).toBe('half_day');
  });

  it('all_day: > 300', () => {
    expect(minutesToEffort(301)).toBe('all_day');
    expect(minutesToEffort(10_000)).toBe('all_day');
  });
});

describe('effortToMinutes', () => {
  it('maps each tier to its representative minutes', () => {
    expect(effortToMinutes('quick')).toBe(15);
    expect(effortToMinutes('short')).toBe(30);
    expect(effortToMinutes('medium')).toBe(90);
    expect(effortToMinutes('half_day')).toBe(240);
    expect(effortToMinutes('all_day')).toBe(480);
  });

  it('null / undefined → null', () => {
    expect(effortToMinutes(null)).toBeNull();
    expect(effortToMinutes(undefined)).toBeNull();
  });

  it('every canonical tier resolves to a positive integer', () => {
    for (const tier of TIME_EFFORTS) {
      const mins = effortToMinutes(tier);
      expect(mins).toBe(EFFORT_MINUTES[tier]);
      expect(Number.isInteger(mins) && (mins as number) > 0).toBe(true);
    }
  });
});

describe('minutesToEffort ∘ effortToMinutes is stable on each tier', () => {
  it('the representative minutes for a tier bucket back into the same tier', () => {
    for (const tier of TIME_EFFORTS) {
      expect(minutesToEffort(EFFORT_MINUTES[tier])).toBe(tier);
    }
  });
});

describe('isTimeEffort', () => {
  it('accepts the five canonical tiers', () => {
    for (const tier of TIME_EFFORTS) expect(isTimeEffort(tier)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isTimeEffort('QUICK')).toBe(false);
    expect(isTimeEffort('huge')).toBe(false);
    expect(isTimeEffort(15)).toBe(false);
    expect(isTimeEffort(null)).toBe(false);
    expect(isTimeEffort(undefined)).toBe(false);
    expect(isTimeEffort('')).toBe(false);
  });
});
