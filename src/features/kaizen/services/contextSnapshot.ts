type StoreLike = {
  profile?: { target_roles?: string | null; career_goal_types?: string | null } | null;
  dailyCore?: Array<{ id: string }>;
  todayLogs?: Array<{ action_id: string; skipped: number }>;
  skills?: Array<{ id: string; name: string; mastery_0_to_100: number | null; activation_state: string }>;
  questions?: Array<{ due_at: string | null; linked_skill_id: string | null }>;
  knowledge?: Array<{ title: string; para_type: string }>;
  reviews?: Array<{ one_percent_change: string | null; updated_at: string }>;
  memories?: Array<{ fact: string; is_approved: number; use_in_ai_context: number }>;
  wakeConfirmedToday?: boolean;
  attempts?: Array<{ overall_score: number | null; attempted_at: string }>;
};

const parse = (value?: string | null): unknown[] => {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** Matches Simple Health `KaizenContextSnapshot` snake_case contract for coach chat. */
export function buildKaizenContextSnapshot(state: StoreLike) {
  const completedIds = new Set(
    (state.todayLogs ?? []).filter(log => !log.skipped).map(log => log.action_id),
  );
  const dailyCore = state.dailyCore ?? [];
  const completed = dailyCore.filter(action => completedIds.has(action.id)).length;
  const total = dailyCore.length;
  const skills = state.skills ?? [];
  const dueReps = (state.questions ?? []).filter(
    question => question.due_at && new Date(question.due_at) <= new Date(),
  ).length;
  const weak = skills.filter(skill => (skill.mastery_0_to_100 ?? 0) < 55);
  const recentScores = (state.attempts ?? [])
    .filter(attempt => typeof attempt.overall_score === 'number')
    .slice(0, 10)
    .map(attempt => attempt.overall_score as number);
  const lastWeekAverage =
    recentScores.length > 0
      ? recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length
      : null;

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    freshness: 'fresh',
    daily_readiness: {
      wake_confirmed: Boolean(state.wakeConfirmedToday),
      daily_core_completed: completed,
      daily_core_total: total,
      energy_note: null,
    },
    habits_summary: {
      active_systems: skills.length ? ['career'] : [],
      streaks: {},
    },
    career_summary: {
      active_skills: skills
        .filter(skill => skill.activation_state === 'active' || skill.activation_state === 'activeTraining')
        .map(skill => skill.name),
      due_reps: dueReps,
      last_week_average_score: lastWeekAverage,
      top_weak_criterion: weak[0]?.name ?? null,
      target_roles: parse(state.profile?.target_roles),
      goal_types: parse(state.profile?.career_goal_types),
    },
    recent_changes: (state.reviews ?? []).slice(0, 3).map(review => review.one_percent_change ?? review.updated_at),
    weak_areas: weak.map(skill => skill.name),
    approved_memory_facts: (state.memories ?? [])
      .filter(memory => memory.is_approved && memory.use_in_ai_context)
      .map(memory => memory.fact),
  };
}
