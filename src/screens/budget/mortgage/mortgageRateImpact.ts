import type { MortgageStatement } from '@api/mortgage';
import type { AppBarStack } from '@components/ui/AppBarChart';
import type { AppLinePoint } from '@components/ui/AppLineChart';

/**
 * "What did the rate changes actually cost me?" — built from the ACTUAL
 * statements, not the projected schedule.
 *
 * The existing schedule charts answer a theoretical question (how a level
 * payment splits over 25 years at the signed rate). A variable / HELOC borrower
 * has a different, concrete one: *my rate moved five times this term — where is
 * my money going now versus then?* That is answered by the statements' own
 * principal / interest split.
 *
 * The load-bearing metric here is the INTEREST SHARE of each payment
 * (interest ÷ payment), because it is scale-invariant: a partial first month
 * (one payment instead of two) or a payment change midway would wreck a raw
 * dollar comparison, but the share stays truthful. Dollar figures are still
 * plotted — they're what the user recognises from the statement — while every
 * *conclusion* is drawn from the share.
 *
 * Pure + deterministic (no I/O, no clock) → unit-testable without a render.
 */

/** A statement reduced to its actual split. Cents in, cents out. */
export interface ActualSplitPoint {
  /** `YYYY-MM-DD` — the statement date. */
  date: string;
  /** `YYYY-MM` — the chart label. */
  label: string;
  principalCents: number;
  interestCents: number;
  /** principal + interest (the statement's own payment total when it gave one). */
  totalCents: number;
  /** interest ÷ total, 0..1. */
  interestShare: number;
  /** The rate in effect on this statement (bps), when it reported one. */
  rateBps: number | null;
}

export interface RateImpactSummary {
  /** Oldest → newest. At least 2 entries whenever `hasComparison` is true. */
  points: ActualSplitPoint[];
  /** True once there are ≥2 statements with a usable split to compare. */
  hasComparison: boolean;
  first: ActualSplitPoint | null;
  latest: ActualSplitPoint | null;
  /**
   * Change in interest share, in PERCENTAGE POINTS (latest − first). Negative is
   * the good direction: less of every payment going to the bank.
   */
  interestShareDeltaPp: number;
  /** Rate move over the same window, bps (latest − first). Null if unknown. */
  rateDeltaBps: number | null;
  /**
   * Principal earned per $100 paid, first vs latest — the plain-language framing
   * of `interestShare` ("$29 of every $100 went to your loan; now it's $38").
   */
  principalPer100First: number;
  principalPer100Latest: number;
}

/** Statements are only comparable once they carry both halves of the split. */
function toPoint(s: MortgageStatement): ActualSplitPoint | null {
  const principal = s.principal_paid_cents;
  const interest = s.interest_paid_cents;
  if (principal == null || interest == null) return null;
  // Statements store payments as negative (money out) — compare magnitudes.
  const p = Math.abs(principal);
  const i = Math.abs(interest);
  const total = p + i;
  if (total <= 0) return null;
  return {
    date: s.statement_date,
    label: s.statement_date.slice(0, 7),
    principalCents: p,
    interestCents: i,
    totalCents: total,
    interestShare: i / total,
    rateBps: s.interest_rate_bps != null && s.interest_rate_bps > 0 ? s.interest_rate_bps : null,
  };
}

/** Every statement with a usable principal/interest split, OLDEST first. */
export function buildActualSplitPoints(statements: MortgageStatement[]): ActualSplitPoint[] {
  return statements
    .map(toPoint)
    .filter((p): p is ActualSplitPoint => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Stacked principal-vs-interest bars from the ACTUAL statements (dollars).
 * Newest `maxBars` kept — the recent trend is the story; the full term lives in
 * the schedule chart.
 */
export function buildActualSplitStacks(
  points: ActualSplitPoint[],
  principalColor: string,
  interestColor: string,
  maxBars = 12
): AppBarStack[] {
  return points.slice(-maxBars).map((p) => ({
    label: p.label,
    segments: [
      { value: p.principalCents / 100, color: principalColor },
      { value: p.interestCents / 100, color: interestColor },
    ],
  }));
}

/** Interest share of each payment as a percent line (the scale-invariant trend). */
export function buildInterestShareSeries(points: ActualSplitPoint[], maxPoints = 12): AppLinePoint[] {
  return points.slice(-maxPoints).map((p) => ({
    value: Number((p.interestShare * 100).toFixed(1)),
    label: p.label,
  }));
}

/** The rate in effect per statement, as a percent step line aligned to the same x. */
export function buildAlignedRateSeries(points: ActualSplitPoint[], maxPoints = 12): AppLinePoint[] {
  return points
    .slice(-maxPoints)
    .filter((p) => p.rateBps != null)
    .map((p) => ({ value: Number(((p.rateBps as number) / 100).toFixed(3)), label: p.label }));
}

/**
 * Compare the oldest and newest comparable statements. Deliberately endpoint-to-
 * endpoint rather than a fitted trend: the user is asking "versus when I
 * started", and an average would hide the very step changes we're surfacing.
 */
export function buildRateImpactSummary(statements: MortgageStatement[]): RateImpactSummary {
  const points = buildActualSplitPoints(statements);
  const first = points[0] ?? null;
  const latest = points.length > 1 ? points[points.length - 1] : null;
  const hasComparison = first !== null && latest !== null;

  const principalPer100 = (p: ActualSplitPoint | null) =>
    p ? Number(((1 - p.interestShare) * 100).toFixed(1)) : 0;

  return {
    points,
    hasComparison,
    first,
    latest,
    interestShareDeltaPp: hasComparison
      ? Number(((latest!.interestShare - first!.interestShare) * 100).toFixed(1))
      : 0,
    rateDeltaBps:
      hasComparison && first!.rateBps != null && latest!.rateBps != null
        ? latest!.rateBps - first!.rateBps
        : null,
    principalPer100First: principalPer100(first),
    principalPer100Latest: principalPer100(latest),
  };
}
