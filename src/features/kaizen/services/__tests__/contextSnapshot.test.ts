import { buildKaizenContextSnapshot } from '../contextSnapshot';

function sampleState() {
  return {
    profile: {
      target_roles: JSON.stringify(['Staff Engineer']),
      career_goal_types: JSON.stringify(['promotion']),
    },
    dailyCore: [{ id: 'd1' }, { id: 'd2' }],
    todayLogs: [
      { action_id: 'd1', skipped: 0 },
      { action_id: 'd2', skipped: 1 },
    ],
    skills: [
      { id: 's1', name: 'React', mastery_0_to_100: 80, activation_state: 'active' },
      { id: 's2', name: 'Systems', mastery_0_to_100: 40, activation_state: 'activeTraining' },
      { id: 's3', name: 'Idle', mastery_0_to_100: 30, activation_state: 'planned' },
    ],
    questions: [
      { due_at: '2000-01-01T00:00:00.000Z', linked_skill_id: 's1' },
      { due_at: '2999-01-01T00:00:00.000Z', linked_skill_id: 's2' },
    ],
    reviews: [{ one_percent_change: 'Shipped faster', updated_at: '2026-07-10T00:00:00.000Z' }],
    memories: [
      { fact: 'Prefers mornings', is_approved: 1, use_in_ai_context: 1 },
      { fact: 'Hidden', is_approved: 1, use_in_ai_context: 0 },
      { fact: 'Unapproved', is_approved: 0, use_in_ai_context: 1 },
    ],
    wakeConfirmedToday: true,
    attempts: [
      { overall_score: 70, attempted_at: '2026-07-10T00:00:00.000Z' },
      { overall_score: 90, attempted_at: '2026-07-09T00:00:00.000Z' },
    ],
  };
}

describe('buildKaizenContextSnapshot', () => {
  it('summarizes readiness, career state, weak areas and approved memory', () => {
    const snap = buildKaizenContextSnapshot(sampleState());

    expect(snap.version).toBe(1);
    expect(snap.daily_readiness).toMatchObject({
      wake_confirmed: true,
      daily_core_completed: 1, // only d1 (d2 skipped)
      daily_core_total: 2,
    });
    expect(snap.career_summary.active_skills).toEqual(['React', 'Systems']);
    expect(snap.career_summary.due_reps).toBe(1);
    expect(snap.career_summary.last_week_average_score).toBe(80); // (70+90)/2
    expect(snap.career_summary.target_roles).toEqual(['Staff Engineer']);
    expect(snap.career_summary.goal_types).toEqual(['promotion']);
    // Weak skills = mastery < 55 (Systems, Idle)
    expect(snap.weak_areas).toEqual(['Systems', 'Idle']);
    expect(snap.career_summary.top_weak_criterion).toBe('Systems');
    expect(snap.recent_changes).toEqual(['Shipped faster']);
    expect(snap.approved_memory_facts).toEqual(['Prefers mornings']);
  });

  it('handles an empty / minimal state without throwing', () => {
    const snap = buildKaizenContextSnapshot({});
    expect(snap.daily_readiness).toMatchObject({ daily_core_completed: 0, daily_core_total: 0 });
    expect(snap.career_summary.last_week_average_score).toBeNull();
    expect(snap.career_summary.active_skills).toEqual([]);
    expect(snap.weak_areas).toEqual([]);
    expect(snap.approved_memory_facts).toEqual([]);
    expect(snap.habits_summary.active_systems).toEqual([]);
  });

  it('tolerates malformed JSON in profile role/goal fields', () => {
    const snap = buildKaizenContextSnapshot({ profile: { target_roles: '{bad', career_goal_types: null } });
    expect(snap.career_summary.target_roles).toEqual([]);
    expect(snap.career_summary.goal_types).toEqual([]);
  });

  it('coerces non-array profile JSON, null mastery, and null change text', () => {
    const snap = buildKaizenContextSnapshot({
      // Valid JSON but not an array -> parse() returns [].
      profile: { target_roles: JSON.stringify({ not: 'an array' }), career_goal_types: JSON.stringify(['x']) },
      // mastery null -> (null ?? 0) < 55 -> counted as weak.
      skills: [{ id: 's1', name: 'NullMastery', mastery_0_to_100: null, activation_state: 'active' }],
      // one_percent_change null -> falls back to updated_at.
      reviews: [{ one_percent_change: null, updated_at: '2026-07-11T00:00:00.000Z' }],
    });

    expect(snap.career_summary.target_roles).toEqual([]);
    expect(snap.career_summary.goal_types).toEqual(['x']);
    expect(snap.weak_areas).toEqual(['NullMastery']);
    expect(snap.career_summary.top_weak_criterion).toBe('NullMastery');
    expect(snap.recent_changes).toEqual(['2026-07-11T00:00:00.000Z']);
  });
});
