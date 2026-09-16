/**
 * Where a resumed restore's bar picks up.
 *
 * The card can mount against a run that started minutes ago — the member left
 * the screen and came back — and the one thing it must not do is show that run
 * at 0%. The placement is pure so it is pinned here without rendering.
 */
import {
  BUDGET_RESTORE_ESTIMATE_MS,
} from '@features/budget/local/backup/restoreTaskStore';

import { resumeFillFraction } from '../BudgetRestoreProgressCard';

const ESTIMATE = BUDGET_RESTORE_ESTIMATE_MS;

describe('resumeFillFraction', () => {
  it('opens with a visible kick rather than an empty bar', () => {
    // Zero would read as "nothing is happening" for the whole first stretch,
    // which is exactly when Argon2 has the thread and nothing can repaint.
    expect(resumeFillFraction(0, ESTIMATE)).toBeCloseTo(0.12, 5);
  });

  it('places a run that is already half done past the halfway mark', () => {
    // Ease-out: most of the bar is spent early, so half the time is well past
    // half the bar — the same curve the running animation follows.
    const half = resumeFillFraction(ESTIMATE / 2, ESTIMATE);
    expect(half).toBeGreaterThan(0.5);
    expect(half).toBeLessThan(0.9);
  });

  it('stops at the ceiling, so a bar is never full while work continues', () => {
    expect(resumeFillFraction(ESTIMATE, ESTIMATE)).toBeCloseTo(0.9, 5);
    // A restore that outran the estimate still waits at 90% for the real thing.
    expect(resumeFillFraction(ESTIMATE * 10, ESTIMATE)).toBeCloseTo(0.9, 5);
  });

  it('never goes backwards as the run gets older', () => {
    const points = [0, 0.1, 0.25, 0.5, 0.75, 1, 2].map((f) =>
      resumeFillFraction(ESTIMATE * f, ESTIMATE),
    );
    const sorted = [...points].sort((a, b) => a - b);
    expect(points).toEqual(sorted);
  });

  it('degrades quietly on nonsense input instead of painting a broken bar', () => {
    // A clock that jumped backwards, or an estimate of zero.
    expect(resumeFillFraction(-5000, ESTIMATE)).toBeCloseTo(0.12, 5);
    expect(resumeFillFraction(Number.NaN, ESTIMATE)).toBeCloseTo(0.12, 5);
    expect(resumeFillFraction(1000, 0)).toBeCloseTo(0.9, 5);
  });
});
