import { gradeForScore, review, schedule, type FSRSState } from '../fsrs';

const DAY_MS = 86_400_000;

function state(over: Partial<FSRSState> = {}): FSRSState {
  return {
    stability: null,
    difficulty: null,
    retrievability: null,
    reps: 0,
    lapses: 0,
    last_reviewed_at: null,
    due_at: null,
    desired_retention: 0.9,
    ...over,
  };
}

/** Days between reviewedAt and the scheduled due_at. */
function intervalDays(next: FSRSState, reviewedAt: string): number {
  return (new Date(next.due_at!).getTime() - new Date(reviewedAt).getTime()) / DAY_MS;
}

describe('kaizen fsrs — gradeForScore', () => {
  it('maps scores to ratings across every band', () => {
    expect(gradeForScore(0)).toBe(1);
    expect(gradeForScore(2.5)).toBe(1);
    expect(gradeForScore(2.99)).toBe(1);
    expect(gradeForScore(3)).toBe(2); // lower boundary of "hard"
    expect(gradeForScore(3.5)).toBe(2);
    expect(gradeForScore(3.74)).toBe(2);
    expect(gradeForScore(3.75)).toBe(3); // lower boundary of "good"
    expect(gradeForScore(4)).toBe(3);
    expect(gradeForScore(4.49)).toBe(3);
    expect(gradeForScore(4.5)).toBe(4); // lower boundary of "easy"
    expect(gradeForScore(4.8)).toBe(4);
    expect(gradeForScore(5)).toBe(4);
  });

  it('clamps out-of-range scores before grading', () => {
    expect(gradeForScore(-10)).toBe(1); // clamps up to 0
    expect(gradeForScore(99)).toBe(4); // clamps down to 5
  });
});

describe('kaizen fsrs — schedule', () => {
  const reviewedAt = '2026-07-10T12:00:00.000Z';

  it('handles a lapse (rating 1): 10-minute relearn step, lapse++, retrievability cleared', () => {
    const next = schedule(state({ reps: 4, lapses: 1, difficulty: 2.5, stability: 30 }), 1, reviewedAt);
    expect(next.lapses).toBe(2);
    expect(next.reps).toBe(4); // reps do not advance on a lapse
    expect(next.retrievability).toBeNull();
    // 10 minutes past the review instant.
    expect(new Date(next.due_at!).getTime()).toBe(new Date(reviewedAt).getTime() + 10 * 60_000);
    expect(next.stability).toBeCloseTo((10 * 60_000) / DAY_MS, 10);
    // rating 1 lowers ease by 0.2.
    expect(next.difficulty).toBeCloseTo(2.3, 10);
  });

  it('first successful review schedules ~1 day out', () => {
    const next = schedule(state(), 3, reviewedAt);
    expect(next.reps).toBe(1);
    expect(next.retrievability).toBe(1);
    expect(intervalDays(next, reviewedAt)).toBeCloseTo(1, 5);
  });

  it('second successful review schedules ~6 days out', () => {
    const prev = state({ reps: 1, stability: 1, difficulty: 2.5 });
    const next = schedule(prev, 3, reviewedAt);
    expect(next.reps).toBe(2);
    expect(intervalDays(next, reviewedAt)).toBeCloseTo(6, 5);
  });

  it('third+ review grows the interval by the ease factor', () => {
    const prev = state({ reps: 2, stability: 6, difficulty: 2.5 });
    const next = schedule(prev, 3, reviewedAt);
    expect(next.reps).toBe(3);
    // base = previousInterval(6) * ease(2.5) = 15 days for a "good" rating.
    expect(intervalDays(next, reviewedAt)).toBeCloseTo(15, 5);
  });

  it('applies the hard multiplier (rating 2) and lowers ease', () => {
    const prev = state({ reps: 2, stability: 6, difficulty: 2.5 });
    const next = schedule(prev, 2, reviewedAt);
    // ease drops by 0.15 → 2.35; base 6*2.35=14.1; hard ×1.2.
    expect(next.difficulty).toBeCloseTo(2.35, 10);
    expect(intervalDays(next, reviewedAt)).toBeCloseTo(6 * 2.35 * 1.2, 5);
  });

  it('applies the easy bonus (rating 4) and raises ease (clamped at MAX)', () => {
    const prev = state({ reps: 2, stability: 6, difficulty: 2.5 });
    const next = schedule(prev, 4, reviewedAt);
    // ease would be 2.65 but clamps to MAX_EASE 2.5; base 6*2.5=15; easy ×1.3.
    expect(next.difficulty).toBeCloseTo(2.5, 10);
    expect(intervalDays(next, reviewedAt)).toBeCloseTo(6 * 2.5 * 1.3, 5);
  });

  it('clamps ease to the MIN floor', () => {
    const prev = state({ reps: 2, stability: 6, difficulty: 1.3 });
    const next = schedule(prev, 2, reviewedAt); // 1.3-0.15=1.15 → floored to 1.3
    expect(next.difficulty).toBeCloseTo(1.3, 10);
  });

  it('scales the interval up for a lower desired retention', () => {
    const highRetention = schedule(state({ reps: 2, stability: 6, difficulty: 2.5, desired_retention: 0.9 }), 3, reviewedAt);
    const lowRetention = schedule(state({ reps: 2, stability: 6, difficulty: 2.5, desired_retention: 0.5 }), 3, reviewedAt);
    // retentionScale = 0.9 / retention → lower retention means a longer interval.
    expect(intervalDays(lowRetention, reviewedAt)).toBeGreaterThan(intervalDays(highRetention, reviewedAt));
    expect(intervalDays(lowRetention, reviewedAt)).toBeCloseTo(15 * (0.9 / 0.5), 4);
  });

  it('clamps desired retention into [0.5, 0.99]', () => {
    const tooLow = schedule(state({ reps: 2, stability: 6, difficulty: 2.5, desired_retention: 0.1 }), 3, reviewedAt);
    const clampedLow = schedule(state({ reps: 2, stability: 6, difficulty: 2.5, desired_retention: 0.5 }), 3, reviewedAt);
    expect(intervalDays(tooLow, reviewedAt)).toBeCloseTo(intervalDays(clampedLow, reviewedAt), 6);

    const tooHigh = schedule(state({ reps: 2, stability: 6, difficulty: 2.5, desired_retention: 2 }), 3, reviewedAt);
    const clampedHigh = schedule(state({ reps: 2, stability: 6, difficulty: 2.5, desired_retention: 0.99 }), 3, reviewedAt);
    expect(intervalDays(tooHigh, reviewedAt)).toBeCloseTo(intervalDays(clampedHigh, reviewedAt), 6);
  });

  it('never schedules a successful review below the 1-day floor', () => {
    // A tiny grown interval combined with high retention would drop below 1 day.
    const next = schedule(state({ reps: 5, stability: 0.1, difficulty: 1.3, desired_retention: 0.99 }), 3, reviewedAt);
    expect(intervalDays(next, reviewedAt)).toBeGreaterThanOrEqual(1);
  });

  it('derives the previous interval from due/last timestamps when stability is missing', () => {
    // stability null, but a 4-day gap is recoverable from due_at - last_reviewed_at.
    const prev = state({
      reps: 2,
      stability: null,
      difficulty: 2.5,
      last_reviewed_at: '2026-07-01T00:00:00.000Z',
      due_at: '2026-07-05T00:00:00.000Z',
    });
    const next = schedule(prev, 3, reviewedAt);
    // base = 4 * 2.5 = 10 days.
    expect(intervalDays(next, reviewedAt)).toBeCloseTo(10, 5);
  });

  it('falls back to the first interval when no previous interval can be derived', () => {
    const prev = state({ reps: 3, stability: null, difficulty: 2.5, last_reviewed_at: null, due_at: null });
    const next = schedule(prev, 3, reviewedAt);
    expect(intervalDays(next, reviewedAt)).toBeCloseTo(1, 5);
  });

  it('accepts a string reviewedAt and a Date reviewedAt equivalently', () => {
    const asString = schedule(state(), 3, reviewedAt);
    const asDate = schedule(state(), 3, new Date(reviewedAt));
    expect(asDate.due_at).toBe(asString.due_at);
  });

  it('defaults reviewedAt to now when omitted', () => {
    const before = Date.now();
    const next = schedule(state(), 3);
    const after = Date.now();
    const reviewed = new Date(next.last_reviewed_at!).getTime();
    expect(reviewed).toBeGreaterThanOrEqual(before);
    expect(reviewed).toBeLessThanOrEqual(after);
  });

  it('throws on an invalid reviewedAt', () => {
    expect(() => schedule(state(), 3, 'not-a-date')).toThrow('reviewedAt must be a valid date');
  });
});

describe('kaizen fsrs — review', () => {
  it('grades the score and advances the state exactly once', () => {
    const result = review(
      state({ stability: 1, difficulty: 2.5, retrievability: 1, reps: 1, last_reviewed_at: '2026-07-01T12:00:00.000Z', due_at: '2026-07-02T12:00:00.000Z' }),
      5,
      '2026-07-10T12:00:00.000Z',
    );
    expect(result.rating).toBe(4);
    expect(result.state.reps).toBe(2);
  });

  it('grades a failing score as a lapse', () => {
    const result = review(state({ reps: 3, lapses: 0, difficulty: 2.5, stability: 20 }), 1);
    expect(result.rating).toBe(1);
    expect(result.state.lapses).toBe(1);
  });
});
