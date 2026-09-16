/**
 * Client-safe CRA contribution-room math for the Savings / Pension feature.
 * Ported from backend/src/services/savings-limits.ts — keep in sync.
 */

export const SAVINGS_LIMITS: Record<
  number,
  { tfsa: number; rrspMax: number; mpLimit: number; fhsaAnnual: number; fhsaLifetime: number }
> = {
  2025: { tfsa: 700000, rrspMax: 3249000, mpLimit: 3381000, fhsaAnnual: 800000, fhsaLifetime: 4000000 },
  2026: { tfsa: 700000, rrspMax: 3381000, mpLimit: 3520500, fhsaAnnual: 800000, fhsaLifetime: 4000000 },
};

export const RRSP_OVER_CONTRIBUTION_BUFFER_CENTS = 200000;
export const ROOM_OVER_CONTRIBUTION = 'ROOM_OVER_CONTRIBUTION';

export interface RoomInputs {
  year: number;
  startingRoomCents: number | null;
  annualLimitOverrideCents: number | null;
  priorEarnedIncomeCents: number | null;
  pensionAdjustmentCents: number | null;
  usedThisYear: number;
  usedByKind: { regular: number; manual: number };
  usedByContributor: { self: number; employer: number };
  priorYearWithdrawals: number;
  contributionsSinceAsOf: number;
  roomAsOfDate: string | null;
  totalLifetimeContributions: number;
  annualGoalCents: number | null;
}

export interface RoomResult {
  roomRemaining: number;
  annualLimit: number;
  used: number;
  usedByKind: { regular: number; manual: number };
  usedByContributor: { self: number; employer: number };
  warnings: string[];
  goalCents: number | null;
  goalContributedCents: number;
  goalRemainingCents: number;
  goalPct: number;
}

function goalProgress(
  goalCents: number | null,
  contributedCents: number,
): Pick<RoomResult, 'goalCents' | 'goalContributedCents' | 'goalRemainingCents' | 'goalPct'> {
  if (goalCents == null || goalCents <= 0) {
    return {
      goalCents: goalCents ?? null,
      goalContributedCents: contributedCents,
      goalRemainingCents: 0,
      goalPct: 0,
    };
  }
  const goalRemainingCents = Math.max(0, goalCents - contributedCents);
  const goalPct = Math.min(100, Math.round((contributedCents / goalCents) * 100));
  return { goalCents, goalContributedCents: contributedCents, goalRemainingCents, goalPct };
}

export function requireLimitsForYear(year: number): void {
  if (!SAVINGS_LIMITS[year]) {
    throw new Error(
      `Savings limits not configured for ${year} — verify at canada.ca and add to SAVINGS_LIMITS`,
    );
  }
}

export function getTfsaRoom(i: RoomInputs): RoomResult {
  requireLimitsForYear(i.year);
  const annualLimit = i.annualLimitOverrideCents ?? SAVINGS_LIMITS[i.year].tfsa;
  const used = i.usedThisYear;
  const warnings: string[] = [];

  const roomRemaining =
    i.startingRoomCents != null
      ? i.startingRoomCents + i.priorYearWithdrawals - used
      : annualLimit + i.priorYearWithdrawals - used;

  if (roomRemaining < 0) warnings.push(ROOM_OVER_CONTRIBUTION);

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

export function getRrspRoom(i: RoomInputs): RoomResult {
  requireLimitsForYear(i.year);
  const rrspMax = SAVINGS_LIMITS[i.year].rrspMax;
  const annualLimit = i.annualLimitOverrideCents ?? rrspMax;
  const used = i.usedThisYear;
  const warnings: string[] = [];

  let roomRemaining: number;
  if (i.startingRoomCents != null) {
    const reduction = i.roomAsOfDate != null ? i.contributionsSinceAsOf : used;
    roomRemaining = i.startingRoomCents - reduction;
  } else {
    const eighteenPercent = Math.round(0.18 * (i.priorEarnedIncomeCents ?? 0));
    roomRemaining =
      Math.min(eighteenPercent, rrspMax) - (i.pensionAdjustmentCents ?? 0) - used;
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

export function getDcPensionRoom(i: RoomInputs): RoomResult {
  requireLimitsForYear(i.year);
  const annualLimit = i.annualLimitOverrideCents ?? SAVINGS_LIMITS[i.year].mpLimit;
  const used = i.usedThisYear;
  const warnings: string[] = [];

  const roomRemaining = annualLimit - used;
  if (used > annualLimit) warnings.push(ROOM_OVER_CONTRIBUTION);

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

export function pensionAdjustmentFromDc(year: number, dcContributionsCents: number): number {
  const limits = SAVINGS_LIMITS[year];
  if (!limits) return dcContributionsCents;
  return Math.min(dcContributionsCents, limits.mpLimit);
}
