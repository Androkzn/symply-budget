import {
  selectAttemptsSince,
  selectDueInterviewQuestions,
  selectWeakerSkillIds,
} from '../stores/kaizenSelectors';
import type {
  KaizenInterviewAttemptEntry,
  KaizenInterviewQuestionEntry,
  KaizenSkillNodeEntry,
} from '../types';

export type CareerAnalyticsPeriod = 'today' | 'week' | 'month' | '3m';

export interface CareerProgressSnapshot {
  repsCompleted: number;
  dueRepsTotal: number;
  dueRepsCompleted: number;
  averageScore: number | null;
  bestScore: number | null;
  weakCriteria: Array<{ criterion: string; averageScore: number }>;
  lessonsLearned: string[];
  nextRecommended: KaizenInterviewQuestionEntry[];
}

function periodStart(period: CareerAnalyticsPeriod): Date {
  const start = new Date();
  if (period === 'today') start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - 7);
  if (period === 'month') start.setMonth(start.getMonth() - 1);
  if (period === '3m') start.setMonth(start.getMonth() - 3);
  return start;
}

export function buildCareerProgressSnapshot(
  questions: KaizenInterviewQuestionEntry[],
  attempts: KaizenInterviewAttemptEntry[],
  skills: KaizenSkillNodeEntry[],
  period: CareerAnalyticsPeriod,
): CareerProgressSnapshot {
  const start = periodStart(period);
  const now = new Date();
  const selectedAttempts = selectAttemptsSince(attempts, start);
  const dueQuestions = selectDueInterviewQuestions(questions, now);
  const attemptedQuestionIds = new Set(selectedAttempts.map(attempt => attempt.question_id));
  const scored = selectedAttempts.map(attempt => attempt.overall_score).filter((score): score is number => typeof score === 'number');
  const criteria = new Map<string, number[]>();
  const lessons = selectedAttempts.flatMap(attempt => attempt.lesson_learned ? [attempt.lesson_learned] : []);
  for (const attempt of selectedAttempts) {
    if (!attempt.criterion_scores) continue;
    try {
      const parsed: unknown = JSON.parse(attempt.criterion_scores);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      for (const [criterion, score] of Object.entries(parsed)) {
        if (typeof score === 'number') criteria.set(criterion, [...(criteria.get(criterion) ?? []), score]);
      }
    } catch {
      // A malformed historical score should not block progress insights.
    }
  }
  const weakCriteria = [...criteria.entries()]
    .map(([criterion, scores]) => ({ criterion, averageScore: scores.reduce((sum, score) => sum + score, 0) / scores.length }))
    .sort((a, b) => a.averageScore - b.averageScore)
    .slice(0, 3);
  const weakerSkillIds = selectWeakerSkillIds(skills);
  const nextRecommended = [...dueQuestions]
    .sort((a, b) => Number(weakerSkillIds.has(b.linked_skill_id ?? '')) - Number(weakerSkillIds.has(a.linked_skill_id ?? '')))
    .slice(0, 5);

  return {
    repsCompleted: selectedAttempts.length,
    dueRepsTotal: dueQuestions.length,
    dueRepsCompleted: dueQuestions.filter(question => attemptedQuestionIds.has(question.id)).length,
    averageScore: scored.length ? scored.reduce((sum, score) => sum + score, 0) / scored.length : null,
    bestScore: scored.length ? Math.max(...scored) : null,
    weakCriteria,
    lessonsLearned: [...new Set(lessons)].slice(0, 5),
    nextRecommended,
  };
}
