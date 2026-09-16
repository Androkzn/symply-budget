/**
 * savings-limits.ts — pure CRA contribution-room math for the Savings feature.
 *
 * These helpers are deliberately free of any I/O (no D1/R2/KV, no `Env`): the
 * caller (`savings-service.ts`) loads the account + aggregates transactions,
 * then feeds plain numbers in cents here. All money is integer cents.
 *
 * Correctness rules (Savings_Implementation_Plan.md Task 3.1 — read that before
 * touching this file; the RRSP/TFSA two-path branching is subtle):
 *  - RRSP has TWO mutually-exclusive paths. The NOA "RRSP deduction limit"
 *    already nets out the prior-year Pension Adjustment (PA) and prior unused
 *    room, so on the NOA path we must NOT subtract PA again nor re-add the 18%
 *    term (doing either double-counts and understates room for anyone with an
 *    employer pension). Only the from-scratch estimate applies 18% + PA.
 *  - TFSA mirrors that shape (user-room-first) and NEVER re-adds current-year
 *    withdrawals — CRA restores withdrawn room only on Jan 1 of the next year.
 *  - FHSA v1 ships balance + the $40,000 lifetime cap only; per-year annual +
 *    carryforward accounting is deferred.
 *  - `ROOM_OVER_CONTRIBUTION` is always PUSHED to `warnings[]`, never thrown.
 */
import { ValidationError } from '../utils/errors';

// ✅ Verified against CRA (2026-07). Re-verify each tax year — figures are inflation-indexed.
//    Sources: canada.ca TFSA "Contributing to a TFSA"; MP/RRSP/DPSP/TFSA limits table; FHSA "Contributing to your FHSAs".
//    `mpLimit` = money-purchase (DC pension / DPSP) annual limit for the year; a year's
//    RRSP dollar limit equals the PRIOR year's MP limit (hence rrspMax lags mpLimit by one).
export const SAVINGS_LIMITS: Record<
  number,
  { tfsa: number; rrspMax: number; mpLimit: number; fhsaAnnual: number; fhsaLifetime: number }
> = {
  2025: { tfsa: 700000, rrspMax: 3249000, mpLimit: 3381000, fhsaAnnual: 800000, fhsaLifetime: 4000000 }, // $7,000 / $32,490 / $33,810 / $8,000 / $40,000
  2026: { tfsa: 700000, rrspMax: 3381000, mpLimit: 3520500, fhsaAnnual: 800000, fhsaLifetime: 4000000 }, // $7,000 / $33,810 / $35,205* / $8,000 / $40,000  (*2026 MP limit projected — verify)
};

/** CRA $2,000 lifetime cushion before RRSP over-contribution penalties apply. */
export const RRSP_OVER_CONTRIBUTION_BUFFER_CENTS = 200000;

/** Warning code pushed to `RoomResult.warnings` when a contribution exceeds available room. */
export const ROOM_OVER_CONTRIBUTION = 'ROOM_OVER_CONTRIBUTION';

export interface RoomInputs {
  year: number;
  /** CRA-reported available room for `year` (RRSP: NOA deduction limit; TFSA: My Account room). Null → from-scratch estimate. */
  startingRoomCents: number | null;
  /** User-entered "this year's" dollar limit; overrides the CRA constant when set. */
  annualLimitOverrideCents: number | null;
  /** RRSP from-scratch only: prior-year earned income (18% basis). */
  priorEarnedIncomeCents: number | null;
  /** RRSP from-scratch only: prior-year pension adjustment. */
  pensionAdjustmentCents: number | null;
  /** Σ contributions in `year` (both kinds, both contributors). */
  usedThisYear: number;
  /** Split of `usedThisYear` by recurrence provenance, for display. */
  usedByKind: { regular: number; manual: number };
  /** Split of `usedThisYear` by who funded it (self vs employer), for display. */
  usedByContributor: { self: number; employer: number };
  /** Withdrawals dated strictly before `year` (TFSA room is restored on Jan 1 of the next year). */
  priorYearWithdrawals: number;
  /** RRSP NOA path: Σ contributions on/after `room_as_of_date`. */
  contributionsSinceAsOf: number;
  /**
   * The account's `room_as_of_date` (ISO), or null. When set, a user-entered RRSP
   * room is anchored to that date and only contributions since then reduce it (NOA
   * flow). When null (the simple "Room" flow), the room is a plain annual figure and
   * THIS year's contributions reduce it.
   */
  roomAsOfDate: string | null;
  /** FHSA: Σ contributions across all years (lifetime-cap basis). */
  totalLifetimeContributions: number;
  /** Personal yearly contribution target (cents), or null when unset. Progress = usedThisYear. */
  annualGoalCents: number | null;
}

export interface RoomResult {
  roomRemaining: number;
  annualLimit: number;
  used: number;
  usedByKind: { regular: number; manual: number };
  usedByContributor: { self: number; employer: number };
  warnings: string[];
  /** Per-account annual contribution goal (cents), or null when unset. */
  goalCents: number | null;
  /** Σ contributions in `year` counted toward the goal (self + employer). */
  goalContributedCents: number;
  /** max(0, goalCents − goalContributedCents); 0 when no goal. */
  goalRemainingCents: number;
  /** 0–100; 0 when no goal. */
  goalPct: number;
}

/** Derive goal-progress fields from a target and the year's contributions (both self + employer). */
function goalProgress(
  goalCents: number | null,
  contributedCents: number
): Pick<RoomResult, 'goalCents' | 'goalContributedCents' | 'goalRemainingCents' | 'goalPct'> {
  if (goalCents == null || goalCents <= 0) {
    return { goalCents: goalCents ?? null, goalContributedCents: contributedCents, goalRemainingCents: 0, goalPct: 0 };
  }
  const goalRemainingCents = Math.max(0, goalCents - contributedCents);
  const goalPct = Math.min(100, Math.round((contributedCents / goalCents) * 100));
  return { goalCents, goalContributedCents: contributedCents, goalRemainingCents, goalPct };
}

/**
 * Guard: throw before any room math if the ship year has no configured limits
 * (Savings_Implementation_Plan.md §10.1 R2). Surfaces as `VALIDATION_ERROR`.
 */
export function requireLimitsForYear(year: number): void {
  if (!SAVINGS_LIMITS[year]) {
    throw new ValidationError({
      year: [`Savings limits not configured for ${year} — verify at canada.ca and add to SAVINGS_LIMITS`],
    });
  }
}

/**
 * TFSA room — user-room-first (mirrors the RRSP two-path shape).
 *  - User-room path (`startingRoomCents != null`): startingRoom + priorYearWithdrawals − used.
 *    The entered room already includes accumulated unused room + this year's limit,
 *    so we do NOT also add `annualLimit`.
 *  - From-scratch (`startingRoomCents == null`): annualLimit + priorYearWithdrawals − used.
 *  - Neither path re-adds current-year withdrawals.
 */
export function getTfsaRoom(i: RoomInputs): RoomResult {
  requireLimitsForYear(i.year);
  const annualLimit = i.annualLimitOverrideCents ?? SAVINGS_LIMITS[i.year].tfsa;
  const used = i.usedThisYear;
  const warnings: string[] = [];

  const roomRemaining =
    i.startingRoomCents != null
      ? i.startingRoomCents + i.priorYearWithdrawals - used
      : annualLimit + i.priorYearWithdrawals - used;

  if (roomRemaining < 0) {
    warnings.push(ROOM_OVER_CONTRIBUTION);
  }

  return {
    roomRemaining,
    annualLimit,
    used,
    usedByKind: i.usedByKind,
    usedByContributor: i.usedByContributor,
    warnings,
    ...goalProgress(i.annualGoalCents, used),
  };
}

/**
 * RRSP room — TWO mutually-exclusive paths (NEVER additive).
 *  - NOA path (`startingRoomCents != null`): startingRoom − contributionsSinceAsOf.
 *    Do NOT subtract PA (the NOA figure already nets it out); do NOT add the 18% term.
 *  - From-scratch (`startingRoomCents == null`):
 *    min(round(0.18 * priorEarnedIncome), rrspMax) − pensionAdjustment − usedThisYear.
 *  - Over-contribution warning only once past the CRA $2,000 lifetime cushion.
 */
export function getRrspRoom(i: RoomInputs): RoomResult {
  requireLimitsForYear(i.year);
  const rrspMax = SAVINGS_LIMITS[i.year].rrspMax;
  const annualLimit = i.annualLimitOverrideCents ?? rrspMax;
  const used = i.usedThisYear;
  const warnings: string[] = [];

  let roomRemaining: number;
  if (i.startingRoomCents != null) {
    // NOA path: the deduction limit already nets PA + prior unused room. When the room
    // is anchored to an as-of date, only contributions since then reduce it; when there's
    // no as-of date (simple "Room" flow), the figure is a plain annual room, so this
    // year's contributions (incl. recurring/employer) reduce it.
    const reduction = i.roomAsOfDate != null ? i.contributionsSinceAsOf : used;
    roomRemaining = i.startingRoomCents - reduction;
  } else {
    // From-scratch estimate: 18% of earned income (capped at rrspMax), minus PA, minus this year's contributions.
    const eighteenPercent = Math.round(0.18 * (i.priorEarnedIncomeCents ?? 0));
    roomRemaining = Math.min(eighteenPercent, rrspMax) - (i.pensionAdjustmentCents ?? 0) - used;
  }

  if (roomRemaining < -RRSP_OVER_CONTRIBUTION_BUFFER_CENTS) {
    warnings.push(ROOM_OVER_CONTRIBUTION);
  }

  return {
    roomRemaining,
    annualLimit,
    used,
    usedByKind: i.usedByKind,
    usedByContributor: i.usedByContributor,
    warnings,
    ...goalProgress(i.annualGoalCents, used),
  };
}

/**
 * FHSA room (v1 — balance + lifetime cap only).
 *  - roomRemaining = fhsaLifetime − Σ contributions(all years).
 *  - Over-contribution warning when lifetime contributions exceed the $40,000 cap.
 *  - Per-year annual ($8,000) + carryforward (max $16,000/yr) accounting is deferred.
 */
export function getFhsaRoom(i: RoomInputs): RoomResult {
  requireLimitsForYear(i.year);
  const limits = SAVINGS_LIMITS[i.year];
  const annualLimit = i.annualLimitOverrideCents ?? limits.fhsaAnnual;
  const used = i.usedThisYear;
  const warnings: string[] = [];

  const roomRemaining = limits.fhsaLifetime - i.totalLifetimeContributions;

  if (i.totalLifetimeContributions > limits.fhsaLifetime) {
    warnings.push(ROOM_OVER_CONTRIBUTION);
  }

  return {
    roomRemaining,
    annualLimit,
    used,
    usedByKind: i.usedByKind,
    usedByContributor: i.usedByContributor,
    warnings,
    ...goalProgress(i.annualGoalCents, used),
  };
}

/**
 * DC workplace-plan room (DPSP / defined-contribution RPP).
 *  - roomRemaining = annualLimit − usedThisYear, where annualLimit is the money-purchase
 *    limit for the year (overridable). This is the amount that can still flow into the
 *    plan this year (employer + employee combined).
 *  - Over-contribution warning when the year's contributions exceed the MP limit.
 *  - These plans do NOT have RRSP-style carryforward; their contributions instead drive a
 *    Pension Adjustment (see `pensionAdjustmentFromDc`) that reduces next year's RRSP room.
 */
export function getDcPensionRoom(i: RoomInputs): RoomResult {
  requireLimitsForYear(i.year);
  const annualLimit = i.annualLimitOverrideCents ?? SAVINGS_LIMITS[i.year].mpLimit;
  const used = i.usedThisYear;
  const warnings: string[] = [];

  const roomRemaining = annualLimit - used;
  if (used > annualLimit) {
    warnings.push(ROOM_OVER_CONTRIBUTION);
  }

  return {
    roomRemaining,
    annualLimit,
    used,
    usedByKind: i.usedByKind,
    usedByContributor: i.usedByContributor,
    warnings,
    ...goalProgress(i.annualGoalCents, used),
  };
}

/**
 * Pension Adjustment for a DC plan year: the full amount contributed to the plan
 * (employer + employee), capped at that year's money-purchase limit. This is the
 * figure that reduces the member's NEXT-year personal RRSP deduction limit. Callers
 * sum a member's DC-plan contributions for the relevant year and pass the total here.
 */
export function pensionAdjustmentFromDc(year: number, dcContributionsCents: number): number {
  const limits = SAVINGS_LIMITS[year];
  if (!limits) return dcContributionsCents;
  return Math.min(dcContributionsCents, limits.mpLimit);
}
