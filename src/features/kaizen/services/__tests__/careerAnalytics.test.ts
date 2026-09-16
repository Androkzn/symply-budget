import type { KaizenInterviewQuestionEntry } from '../../types';
import { buildCareerProgressSnapshot, type CareerAnalyticsPeriod } from '../careerAnalytics';

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const now = () => iso(new Date());

/** Approved interview questions count toward due/nextRecommended selectors. */
const interviewQuestion = (
  q: { id: string; due_at: string | null; linked_skill_id?: string | null },
): KaizenInterviewQuestionEntry => ({
  user_id: 'user-1', prompt: 'Explain a tradeoff', question_bank: 'interview', kind: null,
  purpose: 'interview', linked_skill_id: null, linked_concept_id: null, concept_band: null,
  difficulty_0_to_100: null, topic_tags: null, import_source: null, import_batch_id: null,
  source_document_name: null, source_hash: null, import_review_status: 'approved',
  ideal_answer: null, rubric: null, judge_model: null, ideal_answer_version: 1,
  baseline_attempt_id: null, stability: null, difficulty: null, retrievability: null,
  reps: 0, lapses: 0, last_reviewed_at: null, desired_retention: 0.9,
  created_at: '2026-07-01', updated_at: '2026-07-01', deleted_at: null,
  ...q,
});

describe('buildCareerProgressSnapshot', () => {
  // Freeze the wall clock to local noon so the period windows (esp. 'today',
  // which starts at local midnight) are deterministic and never flake when the
  // suite happens to run right at a midnight boundary.
  beforeEach(() => {
    jest.useFakeTimers();
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    jest.setSystemTime(noon);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns zeros and null scores for empty inputs', () => {
    const snapshot = buildCareerProgressSnapshot([], [], [], 'week');
    expect(snapshot).toMatchObject({
      repsCompleted: 0,
      dueRepsTotal: 0,
      dueRepsCompleted: 0,
      averageScore: null,
      bestScore: null,
      weakCriteria: [],
      lessonsLearned: [],
      nextRecommended: [],
    });
  });

  it('calculates average and best scores from attempts in the selected period', () => {
    const snapshot = buildCareerProgressSnapshot(
      [
        interviewQuestion({ id: 'q1', due_at: now(), linked_skill_id: 's1' }),
        interviewQuestion({ id: 'q2', due_at: now(), linked_skill_id: null }),
      ],
      [
        { question_id: 'q1', attempted_at: now(), overall_score: 3, criterion_scores: '{"clarity":2}', lesson_learned: 'Structure first' },
        { question_id: 'q2', attempted_at: now(), overall_score: 5, criterion_scores: '{"clarity":4}', lesson_learned: 'Structure first' },
      ] as never,
      [{ id: 's1', mastery_0_to_100: 40 }] as never,
      'week',
    );

    expect(snapshot).toMatchObject({
      repsCompleted: 2,
      dueRepsTotal: 2,
      dueRepsCompleted: 2,
      averageScore: 4,
      bestScore: 5,
      lessonsLearned: ['Structure first'], // deduped
    });
    expect(snapshot.weakCriteria).toEqual([{ criterion: 'clarity', averageScore: 3 }]);
  });

  it.each<[CareerAnalyticsPeriod, number]>([
    ['today', 0],
    ['week', 3],
    ['month', 20],
    ['3m', 60],
  ])('includes attempts within the %s window and excludes older ones', (period, insideDays) => {
    // For 'today' the window starts at local midnight, so the in-window sample must
    // be "now" (computed at run time) to stay deterministic across a midnight boundary.
    const insideTs = period === 'today' ? now() : daysAgo(insideDays);
    const snapshot = buildCareerProgressSnapshot(
      [],
      [
        { question_id: 'q1', attempted_at: insideTs, overall_score: 4, criterion_scores: null, lesson_learned: null },
        { question_id: 'q2', attempted_at: daysAgo(400), overall_score: 1, criterion_scores: null, lesson_learned: null },
      ] as never,
      [],
      period,
    );
    expect(snapshot.repsCompleted).toBe(1); // only the in-window attempt counts
    expect(snapshot.averageScore).toBe(4);
    expect(snapshot.bestScore).toBe(4);
  });

  it('counts only due questions and how many were attempted', () => {
    const snapshot = buildCareerProgressSnapshot(
      [
        interviewQuestion({ id: 'q1', due_at: daysAgo(1), linked_skill_id: null }), // due
        interviewQuestion({ id: 'q2', due_at: iso(new Date(Date.now() + 86_400_000)), linked_skill_id: null }), // future → not due
        interviewQuestion({ id: 'q3', due_at: null, linked_skill_id: null }), // no due date → not due
      ],
      [{ question_id: 'q1', attempted_at: now(), overall_score: 4, criterion_scores: null, lesson_learned: null }] as never,
      [],
      'week',
    );
    expect(snapshot.dueRepsTotal).toBe(1);
    expect(snapshot.dueRepsCompleted).toBe(1);
  });

  it('ranks the three weakest criteria ascending and ignores malformed score blobs', () => {
    const snapshot = buildCareerProgressSnapshot(
      [],
      [
        { question_id: 'q1', attempted_at: now(), overall_score: 3, criterion_scores: '{"clarity":5,"depth":1,"pace":3,"tone":2}', lesson_learned: null },
        { question_id: 'q2', attempted_at: now(), overall_score: 3, criterion_scores: '{"clarity":3}', lesson_learned: null },
        // malformed / non-object / array / non-number values are all skipped safely.
        { question_id: 'q3', attempted_at: now(), overall_score: 3, criterion_scores: '{not json', lesson_learned: null },
        { question_id: 'q4', attempted_at: now(), overall_score: 3, criterion_scores: '[1,2,3]', lesson_learned: null },
        { question_id: 'q5', attempted_at: now(), overall_score: 3, criterion_scores: 'null', lesson_learned: null },
        { question_id: 'q6', attempted_at: now(), overall_score: 3, criterion_scores: '{"broken":"x"}', lesson_learned: null },
      ] as never,
      [],
      'week',
    );
    // clarity averages (5+3)/2 = 4; keep only the 3 weakest ascending.
    expect(snapshot.weakCriteria).toEqual([
      { criterion: 'depth', averageScore: 1 },
      { criterion: 'tone', averageScore: 2 },
      { criterion: 'pace', averageScore: 3 },
    ]);
    expect(snapshot.weakCriteria).toHaveLength(3);
  });

  it('prioritizes due questions linked to weak skills, capped at five', () => {
    const questions = Array.from({ length: 6 }, (_, i) =>
      interviewQuestion({
        id: `q${i}`,
        due_at: daysAgo(1),
        // i===0 has no linked skill (exercises the `?? ''` null branch in the sort).
        linked_skill_id: i === 0 ? null : i >= 4 ? 'weak' : 'strong',
      }),
    );
    const snapshot = buildCareerProgressSnapshot(
      questions as never,
      [],
      [
        { id: 'weak', mastery_0_to_100: 30 }, // < 60 → weak
        { id: 'strong', mastery_0_to_100: 90 },
      ] as never,
      'week',
    );
    expect(snapshot.nextRecommended).toHaveLength(5);
    // The two weak-skill questions must lead the recommendation list.
    expect(snapshot.nextRecommended.slice(0, 2).map(q => q.linked_skill_id)).toEqual(['weak', 'weak']);
  });

  it('treats missing mastery as weak and dedupes/caps lessons at five', () => {
    const snapshot = buildCareerProgressSnapshot(
      [],
      Array.from({ length: 7 }, (_, i) => ({
        question_id: `q${i}`,
        attempted_at: now(),
        overall_score: null, // non-number scores are excluded from averages
        criterion_scores: null,
        lesson_learned: `lesson-${i % 6}`, // 6 unique, capped to 5
      })) as never,
      [{ id: 's1', mastery_0_to_100: null }] as never,
      'week',
    );
    expect(snapshot.averageScore).toBeNull(); // no numeric scores
    expect(snapshot.bestScore).toBeNull();
    expect(snapshot.lessonsLearned).toHaveLength(5);
  });
});
