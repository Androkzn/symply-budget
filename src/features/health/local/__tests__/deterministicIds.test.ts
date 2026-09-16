import { healthDeterministicIds, localDateKey, newLocalId } from '../ids';

/**
 * He1 — S3b convergence.
 *
 * The ledger has no unique index. Two devices creating "the same" row offline
 * would both survive the merge as duplicates unless they independently compute
 * the SAME id from the natural key. Health has exactly two such tables; the
 * counter-test at the bottom is just as important as the two positive ones.
 */

describe('deterministic ids — purity and stability', () => {
  it('habitLog is stable across calls', () => {
    const a = healthDeterministicIds.habitLog('habit_abc', '2026-08-13');
    const b = healthDeterministicIds.habitLog('habit_abc', '2026-08-13');
    expect(a).toBe(b);
    expect(a).toEqual(expect.any(String));
    expect(a.length).toBeGreaterThan(0);
  });

  it('healthGoal is stable across calls', () => {
    const a = healthDeterministicIds.healthGoal('2026-08-13');
    const b = healthDeterministicIds.healthGoal('2026-08-13');
    expect(a).toBe(b);
  });

  it('survives a JSON round-trip unchanged', () => {
    const id = healthDeterministicIds.habitLog('habit_abc', '2026-08-13');
    expect(JSON.parse(JSON.stringify({ id })).id).toBe(id);
  });

  it('does not leak the natural key in plaintext', () => {
    // `deterministicRowId` hashes. If the raw habit id or date appeared in the
    // row key it would be readable in any store dump — the row key is NOT
    // covered by the per-row AEAD.
    const id = healthDeterministicIds.habitLog('habit_secret', '2026-08-13');
    expect(id).not.toContain('habit_secret');
    expect(id).not.toContain('2026-08-13');
  });
});

describe('deterministic ids — offline double-create converges', () => {
  it('habit_logs: two devices ticking the same habit on the same day converge', () => {
    // Device A and device B are offline from each other; both mint an id for
    // "habit_abc on 2026-08-13". Same id ⇒ LWW merges them into ONE row.
    const deviceA = healthDeterministicIds.habitLog('habit_abc', '2026-08-13');
    const deviceB = healthDeterministicIds.habitLog('habit_abc', '2026-08-13');
    expect(deviceA).toBe(deviceB);
  });

  it('health_goals: two devices setting a goal for the same day converge', () => {
    const deviceA = healthDeterministicIds.healthGoal('2026-08-13');
    const deviceB = healthDeterministicIds.healthGoal('2026-08-13');
    expect(deviceA).toBe(deviceB);
  });

  it('different natural keys never collide', () => {
    const seen = new Set<string>();
    for (let habit = 0; habit < 20; habit += 1) {
      for (let day = 1; day <= 28; day += 1) {
        const date = `2026-08-${String(day).padStart(2, '0')}`;
        seen.add(healthDeterministicIds.habitLog(`habit_${habit}`, date));
      }
    }
    expect(seen.size).toBe(20 * 28);
  });

  it('a different day is a different goal row', () => {
    expect(healthDeterministicIds.healthGoal('2026-08-13')).not.toBe(
      healthDeterministicIds.healthGoal('2026-08-14'),
    );
  });
});

describe('random ids — the counter-test that protects real readings', () => {
  /**
   * This is the failure an earlier draft of the plan would have shipped: it
   * listed "weight-per-date" as a deterministic id. A user who weighs in morning
   * AND evening would then have the second reading LWW away the first — silent
   * loss of real data in the app's flagship metric, caused by the id scheme.
   */
  it('two weigh-ins on the same day get DIFFERENT ids, so both survive', () => {
    const date = localDateKey(new Date('2026-08-13T07:30:00Z'));
    const morning = newLocalId('w');
    const evening = newLocalId('w');
    expect(morning).not.toBe(evening);
    expect(date).toBe('2026-08-13');
  });

  it('newLocalId is collision-free across a large batch', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newLocalId('w')));
    expect(ids.size).toBe(5000);
  });

  it('newLocalId carries its prefix', () => {
    expect(newLocalId('nut').startsWith('nut_')).toBe(true);
  });
});

describe('localDateKey', () => {
  it('formats as YYYY-MM-DD and zero-pads', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
