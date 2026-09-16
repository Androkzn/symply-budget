/**
 * Time-effort tiers — the app's coarse "how long will this take" concept.
 *
 * Replaces the old precise `estimated_minutes` estimate: a homeowner doesn't
 * need false-precision minute counts, just a glanceable tier ("Quick" … "All
 * day"). The AI enricher outputs a tier directly, cards render its label, and
 * the "what can I do in N minutes?" planner maps each tier to a representative
 * duration for its greedy packing.
 */
export const TIME_EFFORTS = ['quick', 'short', 'medium', 'half_day', 'all_day'] as const;

export type TimeEffort = (typeof TIME_EFFORTS)[number];

const TIME_EFFORT_SET = new Set<string>(TIME_EFFORTS);

export function isTimeEffort(value: unknown): value is TimeEffort {
  return typeof value === 'string' && TIME_EFFORT_SET.has(value);
}

/** Representative hands-on minutes per tier — used only by the planner's budget packing. */
export const EFFORT_MINUTES: Record<TimeEffort, number> = {
  quick: 15,
  short: 30,
  medium: 90,
  half_day: 240,
  all_day: 480,
};

/**
 * Bucket a legacy/derived minute estimate into a tier. Kept in sync with the
 * thresholds the mobile cards used to derive the same labels from
 * `estimated_minutes`, so the one-time backfill and any minute-based caller
 * agree. Returns null for null/non-positive input.
 */
export function minutesToEffort(minutes: number | null | undefined): TimeEffort | null {
  if (typeof minutes !== 'number' || !(minutes > 0)) return null;
  if (minutes <= 15) return 'quick';
  if (minutes <= 45) return 'short';
  if (minutes <= 120) return 'medium';
  if (minutes <= 300) return 'half_day';
  return 'all_day';
}

/** Representative minutes for a tier (defaults to a modest 30 when unknown). */
export function effortToMinutes(effort: TimeEffort | null | undefined): number | null {
  return effort ? EFFORT_MINUTES[effort] : null;
}
