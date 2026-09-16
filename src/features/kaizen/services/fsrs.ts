/**
 * Kaizen interview-review scheduler. This preserves the iOS score-to-rating
 * contract and its deterministic SM-2-style fallback state advance.
 */

export type FSRSRating = 1 | 2 | 3 | 4;

export interface FSRSState {
  stability: number | null;
  difficulty: number | null;
  retrievability: number | null;
  reps: number;
  lapses: number;
  last_reviewed_at: string | null;
  due_at: string | null;
  desired_retention: number;
}

export interface FSRSReviewResult {
  rating: FSRSRating;
  state: FSRSState;
}

const DAY_IN_MS = 86_400_000;
const MIN_EASE = 1.3;
const MAX_EASE = 2.5;
const DEFAULT_EASE = 2.5;
const FIRST_INTERVAL_DAYS = 1;
const SECOND_INTERVAL_DAYS = 6;
const LAPSE_RELEARN_MINUTES = 10;
const LAPSE_FLOOR_DAYS = 1;
const HARD_MULTIPLIER = 1.2;
const EASY_BONUS = 1.3;

/** Maps an overall attempt score (0–5) to the authoritative FSRS rating. */
export function gradeForScore(overallScore: number): FSRSRating {
  const clamped = Math.min(Math.max(overallScore, 0), 5);

  if (clamped < 3) return 1;
  if (clamped < 3.75) return 2;
  if (clamped < 4.5) return 3;
  return 4;
}

/**
 * Advances a question's memory state for one practice event.
 *
 * Rating 1 is a lapse and schedules a 10-minute relearning step. Ratings 2–4
 * are successful recalls that grow the interval in days.
 */
export function schedule(
  state: FSRSState,
  rating: FSRSRating,
  reviewedAt: Date | string = new Date(),
): FSRSState {
  const reviewedAtDate = toDate(reviewedAt);
  const ease = clamp(adjustEase(state.difficulty ?? DEFAULT_EASE, rating), MIN_EASE, MAX_EASE);
  const previousIntervalDays = lastIntervalDays(state);
  const isLapse = rating === 1;

  let intervalMs: number;
  let reps = state.reps;
  let lapses = state.lapses;
  let retrievability: number | null;

  if (isLapse) {
    lapses += 1;
    retrievability = null;
    intervalMs = LAPSE_RELEARN_MINUTES * 60_000;
  } else {
    reps += 1;
    const grownDays = grownIntervalDays(previousIntervalDays, reps, ease, rating);
    const effectiveDays = Math.max(
      LAPSE_FLOOR_DAYS,
      grownDays * retentionScale(state.desired_retention),
    );
    intervalMs = effectiveDays * DAY_IN_MS;
    retrievability = 1;
  }

  return {
    ...state,
    stability: intervalMs / DAY_IN_MS,
    difficulty: ease,
    retrievability,
    reps,
    lapses,
    last_reviewed_at: reviewedAtDate.toISOString(),
    due_at: new Date(reviewedAtDate.getTime() + intervalMs).toISOString(),
  };
}

/** Grades an overall score and advances the state exactly once. */
export function review(
  state: FSRSState,
  overallScore: number,
  reviewedAt: Date | string = new Date(),
): FSRSReviewResult {
  const rating = gradeForScore(overallScore);
  return { rating, state: schedule(state, rating, reviewedAt) };
}

function adjustEase(ease: number, rating: FSRSRating): number {
  switch (rating) {
    case 1:
      return ease - 0.2;
    case 2:
      return ease - 0.15;
    case 3:
      return ease;
    case 4:
      return ease + 0.15;
  }
}

function lastIntervalDays(state: FSRSState): number {
  if (state.stability !== null && state.stability > 0) return state.stability;
  if (state.due_at && state.last_reviewed_at) {
    return Math.max(0, (toDate(state.due_at).getTime() - toDate(state.last_reviewed_at).getTime()) / DAY_IN_MS);
  }
  return 0;
}

function grownIntervalDays(
  previousIntervalDays: number,
  reps: number,
  ease: number,
  rating: FSRSRating,
): number {
  const base =
    reps <= 1 || previousIntervalDays <= 0
      ? FIRST_INTERVAL_DAYS
      : reps === 2
        ? SECOND_INTERVAL_DAYS
        : previousIntervalDays * ease;

  switch (rating) {
    /* istanbul ignore next -- rating 1 is a lapse, short-circuited in schedule() before this runs; kept for switch exhaustiveness */
    case 1:
      return base;
    case 2:
      return base * HARD_MULTIPLIER;
    case 3:
      return base;
    case 4:
      return base * EASY_BONUS;
  }
}

function retentionScale(desiredRetention: number): number {
  return 0.9 / clamp(desiredRetention, 0.5, 0.99);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('reviewedAt must be a valid date');
  return date;
}
