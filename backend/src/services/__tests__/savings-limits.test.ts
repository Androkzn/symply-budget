/**
 * savings-limits.test.ts — pure CRA contribution-room math (Savings Task 3.4 / §6.1).
 *
 * These are pure functions (no D1/R2/Miniflare), so we import Vitest primitives
 * directly and call the helpers with plain cents inputs. Focus areas are the
 * correctness-critical branches called out in Task 3.1:
 *  - RRSP NOA path does NOT subtract the Pension Adjustment (no double-count).
 *  - RRSP from-scratch subtracts PA exactly once and caps 18% at rrspMax.
 *  - TFSA never re-adds current-year withdrawals; user-room path does not double-add annualLimit.
 *  - annualLimitOverrideCents beats the CRA constant.
 *  - usedByKind passes through.
 *  - FHSA lifetime-cap warning.
 *  - Unconfigured tax year throws (VALIDATION_ERROR).
 *  - Over-contribution surfaces in warnings[] as the string 'ROOM_OVER_CONTRIBUTION'.
 */
import { describe, it, expect } from 'vitest';

import { ValidationError } from '../../utils/errors';
import {
  SAVINGS_LIMITS,
  RRSP_OVER_CONTRIBUTION_BUFFER_CENTS,
  requireLimitsForYear,
  getTfsaRoom,
  getRrspRoom,
  getFhsaRoom,
  getDcPensionRoom,
  pensionAdjustmentFromDc,
  type RoomInputs,
} from '../savings-limits';

/** A fully-zeroed RoomInputs for `year` — override only the fields a test cares about. */
function baseInputs(overrides: Partial<RoomInputs> = {}): RoomInputs {
  return {
    year: 2026,
    startingRoomCents: null,
    annualLimitOverrideCents: null,
    priorEarnedIncomeCents: null,
    pensionAdjustmentCents: null,
    usedThisYear: 0,
    usedByKind: { regular: 0, manual: 0 },
    usedByContributor: { self: 0, employer: 0 },
    priorYearWithdrawals: 0,
    contributionsSinceAsOf: 0,
    roomAsOfDate: null,
    totalLifetimeContributions: 0,
    annualGoalCents: null,
    ...overrides,
  };
}

describe('requireLimitsForYear', () => {
  it('does not throw for a configured year', () => {
    expect(() => requireLimitsForYear(2025)).not.toThrow();
    expect(() => requireLimitsForYear(2026)).not.toThrow();
  });

  it('throws a ValidationError for an unconfigured year (2027)', () => {
    expect(() => requireLimitsForYear(2027)).toThrow(ValidationError);
    // Surfaces as VALIDATION_ERROR (code), never a silent pass.
    try {
      requireLimitsForYear(2027);
      throw new Error('expected requireLimitsForYear(2027) to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).name).toBe('ValidationError');
      expect((err as ValidationError).code).toBe('validation_error');
    }
  });
});

describe('getRrspRoom', () => {
  it('NOA path does NOT subtract the pension adjustment', () => {
    // startingRoom 1,000,000 − contributionsSinceAsOf 200,000 = 800,000.
    // PA (500,000) and usedThisYear (200,000) must NOT move the NOA-path result.
    const res = getRrspRoom(
      baseInputs({
        startingRoomCents: 1_000_000,
        roomAsOfDate: '2026-01-01', // NOA flow: room anchored to an as-of date.
        pensionAdjustmentCents: 500_000,
        contributionsSinceAsOf: 200_000,
        usedThisYear: 200_000,
      })
    );
    expect(res.roomRemaining).toBe(800_000);
    expect(res.warnings).not.toContain('ROOM_OVER_CONTRIBUTION');
  });

  it('from-scratch subtracts the pension adjustment exactly once', () => {
    // 18% × 10,000,000 = 1,800,000 (under rrspMax) − PA 300,000 − used 100,000 = 1,400,000.
    const res = getRrspRoom(
      baseInputs({
        startingRoomCents: null,
        priorEarnedIncomeCents: 10_000_000,
        pensionAdjustmentCents: 300_000,
        usedThisYear: 100_000,
      })
    );
    expect(res.roomRemaining).toBe(1_400_000);
  });

  it('from-scratch caps the 18% term at rrspMax', () => {
    // 18% × 100,000,000 = 18,000,000 → capped at rrspMax(2026)=3,381,000; no PA/used → equals the cap.
    const res = getRrspRoom(
      baseInputs({
        year: 2026,
        startingRoomCents: null,
        priorEarnedIncomeCents: 100_000_000,
      })
    );
    expect(res.roomRemaining).toBe(SAVINGS_LIMITS[2026].rrspMax);
    expect(res.roomRemaining).toBe(3_381_000);
  });

  it('honors annualLimitOverrideCents over the CRA rrspMax constant', () => {
    const res = getRrspRoom(
      baseInputs({ startingRoomCents: 500_000, annualLimitOverrideCents: 2_500_000 })
    );
    expect(res.annualLimit).toBe(2_500_000);
    expect(res.annualLimit).not.toBe(SAVINGS_LIMITS[2026].rrspMax);
  });

  it('passes usedByKind through (regular vs manual split)', () => {
    const res = getRrspRoom(
      baseInputs({
        startingRoomCents: 1_000_000,
        usedThisYear: 300_000,
        usedByKind: { regular: 200_000, manual: 100_000 },
      })
    );
    expect(res.usedByKind).toEqual({ regular: 200_000, manual: 100_000 });
    expect(res.used).toBe(300_000);
  });

  it('warns ROOM_OVER_CONTRIBUTION only past the $2,000 buffer (NOA path)', () => {
    // Just inside the buffer: −2,000 exactly → no warning (< −buffer is strict).
    const atBuffer = getRrspRoom(
      baseInputs({
        startingRoomCents: 0,
        roomAsOfDate: '2026-01-01', // NOA flow: over-contribution measured since the as-of date.
        contributionsSinceAsOf: RRSP_OVER_CONTRIBUTION_BUFFER_CENTS,
      })
    );
    expect(atBuffer.roomRemaining).toBe(-RRSP_OVER_CONTRIBUTION_BUFFER_CENTS);
    expect(atBuffer.warnings).not.toContain('ROOM_OVER_CONTRIBUTION');

    // Past the buffer: −2,001 → warning.
    const past = getRrspRoom(
      baseInputs({
        startingRoomCents: 0,
        roomAsOfDate: '2026-01-01',
        contributionsSinceAsOf: RRSP_OVER_CONTRIBUTION_BUFFER_CENTS + 100,
      })
    );
    expect(past.warnings).toContain('ROOM_OVER_CONTRIBUTION');
  });

  it('simple Room flow (no as-of date) reduces RRSP room by this year\'s contributions', () => {
    // Regression: the Pension "Room" tab sets a plain annual room with NO
    // room_as_of_date. Before, RRSP room only subtracted contributionsSinceAsOf
    // (always 0 without an as-of date) so recurring/employer contributions never
    // lowered the remaining room. Now this year's contributions reduce it.
    const res = getRrspRoom(
      baseInputs({
        startingRoomCents: 4_000_000, // $40,000 room
        roomAsOfDate: null,
        usedThisYear: 520_000, // $2,600 self + $2,600 employer
        usedByContributor: { self: 260_000, employer: 260_000 },
        contributionsSinceAsOf: 0, // no as-of date → this stays 0
      })
    );
    expect(res.roomRemaining).toBe(3_480_000); // $34,800 left, NOT the full $40,000
    expect(res.used).toBe(520_000);
  });
});

describe('getTfsaRoom', () => {
  it('does NOT add current-year withdrawals (only priorYearWithdrawals)', () => {
    // startingRoom 700,000 + priorYearWithdrawals 0 − used 100,000 = 600,000.
    // A same-year withdrawal is intentionally NOT modeled here — priorYearWithdrawals
    // is the ONLY add-back, so leaving it 0 must yield 600,000.
    const res = getTfsaRoom(
      baseInputs({ startingRoomCents: 700_000, priorYearWithdrawals: 0, usedThisYear: 100_000 })
    );
    expect(res.roomRemaining).toBe(600_000);

    // Sanity: a PRIOR-year withdrawal (150,000) DOES add back → 750,000.
    const withPrior = getTfsaRoom(
      baseInputs({
        startingRoomCents: 700_000,
        priorYearWithdrawals: 150_000,
        usedThisYear: 100_000,
      })
    );
    expect(withPrior.roomRemaining).toBe(750_000);
  });

  it('user-room path does NOT double-add annualLimit', () => {
    // If annualLimit were (incorrectly) added, room would be 700,000 + 700,000 = 1,400,000.
    const res = getTfsaRoom(baseInputs({ startingRoomCents: 700_000 }));
    expect(res.roomRemaining).toBe(700_000);
    expect(res.roomRemaining).not.toBe(700_000 + SAVINGS_LIMITS[2026].tfsa);
  });

  it('from-scratch path uses annualLimit + priorYearWithdrawals − used', () => {
    // annualLimit(2026)=700,000 + priorYearWithdrawals 50,000 − used 200,000 = 550,000.
    const res = getTfsaRoom(
      baseInputs({ startingRoomCents: null, priorYearWithdrawals: 50_000, usedThisYear: 200_000 })
    );
    expect(res.roomRemaining).toBe(550_000);
    expect(res.annualLimit).toBe(SAVINGS_LIMITS[2026].tfsa);
  });

  it('honors annualLimitOverrideCents over the CRA tfsa constant', () => {
    const res = getTfsaRoom(
      baseInputs({ startingRoomCents: null, annualLimitOverrideCents: 900_000 })
    );
    expect(res.annualLimit).toBe(900_000);
    expect(res.roomRemaining).toBe(900_000);
  });

  it('passes usedByKind through', () => {
    const res = getTfsaRoom(
      baseInputs({
        startingRoomCents: 700_000,
        usedThisYear: 250_000,
        usedByKind: { regular: 150_000, manual: 100_000 },
      })
    );
    expect(res.usedByKind).toEqual({ regular: 150_000, manual: 100_000 });
  });

  it('warns ROOM_OVER_CONTRIBUTION (as a warnings[] string) when room goes negative', () => {
    const res = getTfsaRoom(baseInputs({ startingRoomCents: 100_000, usedThisYear: 250_000 }));
    expect(res.roomRemaining).toBeLessThan(0);
    expect(res.warnings).toContain('ROOM_OVER_CONTRIBUTION');
  });
});

describe('getFhsaRoom', () => {
  it('roomRemaining = fhsaLifetime − totalLifetimeContributions', () => {
    const res = getFhsaRoom(baseInputs({ totalLifetimeContributions: 1_500_000 }));
    expect(res.roomRemaining).toBe(SAVINGS_LIMITS[2026].fhsaLifetime - 1_500_000);
    expect(res.roomRemaining).toBe(2_500_000);
    expect(res.warnings).not.toContain('ROOM_OVER_CONTRIBUTION');
  });

  it('warns ROOM_OVER_CONTRIBUTION when lifetime contributions exceed the $40,000 cap', () => {
    const res = getFhsaRoom(baseInputs({ totalLifetimeContributions: 4_000_001 }));
    expect(res.warnings).toContain('ROOM_OVER_CONTRIBUTION');
    expect(res.roomRemaining).toBeLessThan(0);
  });

  it('does NOT warn exactly at the lifetime cap', () => {
    const res = getFhsaRoom(baseInputs({ totalLifetimeContributions: 4_000_000 }));
    expect(res.roomRemaining).toBe(0);
    expect(res.warnings).not.toContain('ROOM_OVER_CONTRIBUTION');
  });

  it('honors annualLimitOverrideCents over the CRA fhsaAnnual constant', () => {
    const res = getFhsaRoom(baseInputs({ annualLimitOverrideCents: 1_000_000 }));
    expect(res.annualLimit).toBe(1_000_000);
    expect(res.annualLimit).not.toBe(SAVINGS_LIMITS[2026].fhsaAnnual);
  });
});

// ============ Pension-tab additions (employer / DC plans, split, goal) ============

describe('getDcPensionRoom (DPSP / DC-RPP)', () => {
  it('roomRemaining = mpLimit − usedThisYear against the money-purchase limit', () => {
    const res = getDcPensionRoom(baseInputs({ usedThisYear: 1_000_000 }));
    expect(res.annualLimit).toBe(SAVINGS_LIMITS[2026].mpLimit);
    expect(res.roomRemaining).toBe(SAVINGS_LIMITS[2026].mpLimit - 1_000_000);
  });

  it('warns ROOM_OVER_CONTRIBUTION when contributions exceed the MP limit', () => {
    const res = getDcPensionRoom(baseInputs({ usedThisYear: SAVINGS_LIMITS[2026].mpLimit + 1 }));
    expect(res.warnings).toContain('ROOM_OVER_CONTRIBUTION');
  });
});

describe('pensionAdjustmentFromDc', () => {
  it('returns the DC contributions when under the MP limit', () => {
    expect(pensionAdjustmentFromDc(2026, 500_000)).toBe(500_000);
  });

  it('caps the PA at the year MP limit', () => {
    const cap = SAVINGS_LIMITS[2026].mpLimit;
    expect(pensionAdjustmentFromDc(2026, cap + 1_000_000)).toBe(cap);
  });
});

describe('employer contributions & the self/employer split', () => {
  it('group-RRSP employer match consumes current-year room (used counts both contributors)', () => {
    // $5,000 self + $2,500 employer, both recorded on the same RRSP → $7,500 used.
    const res = getRrspRoom(
      baseInputs({
        startingRoomCents: 1_000_000, // $10,000 NOA room
        contributionsSinceAsOf: 750_000,
        usedThisYear: 750_000,
        usedByContributor: { self: 500_000, employer: 250_000 },
      })
    );
    // NOA path: room = startingRoom − contributionsSinceAsOf.
    expect(res.roomRemaining).toBe(250_000);
    expect(res.usedByContributor).toEqual({ self: 500_000, employer: 250_000 });
  });

  it('a resolved (auto) pension adjustment reduces from-scratch RRSP room', () => {
    // 18% of $60,000 = $10,800 capped at rrspMax; PA of $4,000 → room $6,800.
    const res = getRrspRoom(
      baseInputs({ priorEarnedIncomeCents: 6_000_000, pensionAdjustmentCents: 400_000 })
    );
    expect(res.roomRemaining).toBe(1_080_000 - 400_000);
  });
});

describe('annual contribution goal progress', () => {
  it('reports goal progress from the year contributions (self + employer)', () => {
    const res = getTfsaRoom(baseInputs({ usedThisYear: 300_000, annualGoalCents: 1_000_000 }));
    expect(res.goalCents).toBe(1_000_000);
    expect(res.goalContributedCents).toBe(300_000);
    expect(res.goalRemainingCents).toBe(700_000);
    expect(res.goalPct).toBe(30);
  });

  it('caps goalPct at 100 and floors remaining at 0 when the goal is exceeded', () => {
    const res = getTfsaRoom(baseInputs({ usedThisYear: 1_500_000, annualGoalCents: 1_000_000 }));
    expect(res.goalPct).toBe(100);
    expect(res.goalRemainingCents).toBe(0);
  });

  it('returns null/zero goal fields when no goal is set', () => {
    const res = getTfsaRoom(baseInputs({ usedThisYear: 300_000, annualGoalCents: null }));
    expect(res.goalCents).toBeNull();
    expect(res.goalPct).toBe(0);
    expect(res.goalRemainingCents).toBe(0);
  });
});
