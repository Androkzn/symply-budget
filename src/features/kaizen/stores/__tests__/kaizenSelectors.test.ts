import type {
  KaizenActionLogEntry,
  KaizenBookChapterEntry,
  KaizenBookEntry,
  KaizenBookHighlightEntry,
  KaizenBookQuestionEntry,
  KaizenGtdItemEntry,
  KaizenInterviewAttemptEntry,
  KaizenInterviewPipelineEntry,
  KaizenInterviewQuestionEntry,
  KaizenSkillNodeEntry,
  KaizenUserMemoryEntry,
  KaizenWeeklyReviewEntry,
} from '../../types';
import {
  selectActiveBooks,
  selectActiveBooksSorted,
  selectActiveInterviewQuestions,
  selectActiveMemories,
  selectActivePipelineItems,
  selectApprovedInterviewQuestionsOrdered,
  selectAssessedSkills,
  selectAttemptsForQuestion,
  selectAttemptsSince,
  selectActiveSkillsSorted,
  selectAverageAssessedMastery,
  selectBookById,
  selectBookChapters,
  selectBookHighlightsForChapter,
  selectBookQuestionCountForChapter,
  selectBookQuestionsForChapter,
  selectBookQuestionsForChapterSorted,
  selectCareerHubStats,
  selectCompletedTodayActionLogs,
  selectDailyCoreForSystem,
  selectDueInterviewQuestions,
  selectGtdInboxItems,
  selectHabitStackActionIdsForStack,
  selectHabitStackStepsForStack,
  selectIsInterviewQuestionDue,
  selectPendingInterviewQuestions,
  selectAssessableSkills,
  selectAverageAssessableMastery,
  selectPracticeSessionQuestion,
  selectSkillById,
  selectWeakerSkillIds,
  selectWeeklyReviewsSorted,
} from '../kaizenSelectors';

describe('kaizenSelectors', () => {
  const chapters: KaizenBookChapterEntry[] = [
    {
      id: 'c2',
      book_id: 'b1',
      chapter_index: 2,
      title: 'Second',
      deleted_at: null,
    } as KaizenBookChapterEntry,
    {
      id: 'c1',
      book_id: 'b1',
      chapter_index: 1,
      title: 'First',
      deleted_at: null,
    } as KaizenBookChapterEntry,
    {
      id: 'c-deleted',
      book_id: 'b1',
      chapter_index: 0,
      title: 'Deleted',
      deleted_at: '2026-01-01T00:00:00.000Z',
    } as KaizenBookChapterEntry,
    {
      id: 'c-other',
      book_id: 'b2',
      chapter_index: 1,
      title: 'Other book',
      deleted_at: null,
    } as KaizenBookChapterEntry,
  ];

  it('selectBookChapters filters deleted rows and sorts by index', () => {
    expect(selectBookChapters(chapters, 'b1').map(chapter => chapter.id)).toEqual([
      'c1',
      'c2',
    ]);
  });

  it('selectBookQuestionsForChapter keeps active chapter rows only', () => {
    const questions: KaizenBookQuestionEntry[] = [
      { id: 'q1', chapter_id: 'c1', deleted_at: null } as KaizenBookQuestionEntry,
      { id: 'q2', chapter_id: 'c2', deleted_at: null } as KaizenBookQuestionEntry,
      { id: 'q3', chapter_id: 'c1', deleted_at: '2026-01-01T00:00:00.000Z' } as KaizenBookQuestionEntry,
    ];
    expect(selectBookQuestionsForChapter(questions, 'c1').map(q => q.id)).toEqual(['q1']);
  });

  it('selectBookHighlightsForChapter keeps active chapter rows only', () => {
    const highlights: KaizenBookHighlightEntry[] = [
      { id: 'h1', chapter_id: 'c1', deleted_at: null } as KaizenBookHighlightEntry,
      { id: 'h2', chapter_id: 'c2', deleted_at: null } as KaizenBookHighlightEntry,
    ];
    expect(selectBookHighlightsForChapter(highlights, 'c1').map(h => h.id)).toEqual(['h1']);
  });

  it('selectAttemptsForQuestion sorts newest first', () => {
    const attempts: KaizenInterviewAttemptEntry[] = [
      {
        id: 'a1',
        question_id: 'q1',
        attempted_at: '2026-01-01T00:00:00.000Z',
      } as KaizenInterviewAttemptEntry,
      {
        id: 'a2',
        question_id: 'q1',
        attempted_at: '2026-02-01T00:00:00.000Z',
      } as KaizenInterviewAttemptEntry,
      {
        id: 'a3',
        question_id: 'q2',
        attempted_at: '2026-03-01T00:00:00.000Z',
      } as KaizenInterviewAttemptEntry,
    ];
    expect(selectAttemptsForQuestion(attempts, 'q1').map(a => a.id)).toEqual(['a2', 'a1']);
  });

  it('selectActiveBooks omits soft-deleted rows', () => {
    const books: KaizenBookEntry[] = [
      { id: 'b1', deleted_at: null } as KaizenBookEntry,
      { id: 'b2', deleted_at: '2026-01-01T00:00:00.000Z' } as KaizenBookEntry,
    ];
    expect(selectActiveBooks(books).map(book => book.id)).toEqual(['b1']);
  });

  it('selectBookQuestionsForChapterSorted sorts by created_at', () => {
    const questions: KaizenBookQuestionEntry[] = [
      { id: 'q2', chapter_id: 'c1', created_at: '2026-02-01', deleted_at: null } as KaizenBookQuestionEntry,
      { id: 'q1', chapter_id: 'c1', created_at: '2026-01-01', deleted_at: null } as KaizenBookQuestionEntry,
    ];
    expect(selectBookQuestionsForChapterSorted(questions, 'c1').map(q => q.id)).toEqual([
      'q1',
      'q2',
    ]);
  });

  it('selectActivePipelineItems and selectActiveMemories filter archived/deleted', () => {
    const pipeline: KaizenInterviewPipelineEntry[] = [
      { id: 'p1', deleted_at: null } as KaizenInterviewPipelineEntry,
      { id: 'p2', deleted_at: '2026-01-01T00:00:00.000Z' } as KaizenInterviewPipelineEntry,
    ];
    expect(selectActivePipelineItems(pipeline).map(item => item.id)).toEqual(['p1']);

    const memories: KaizenUserMemoryEntry[] = [
      { id: 'm1', is_archived: 0 } as KaizenUserMemoryEntry,
      { id: 'm2', is_archived: 1 } as KaizenUserMemoryEntry,
    ];
    expect(selectActiveMemories(memories).map(item => item.id)).toEqual(['m1']);
  });

  it('selectWeeklyReviewsSorted drops deleted rows and sorts newest week first', () => {
    const reviews: KaizenWeeklyReviewEntry[] = [
      { id: 'r1', week_start: '2026-01-05', deleted_at: null } as KaizenWeeklyReviewEntry,
      { id: 'r2', week_start: '2026-02-02', deleted_at: null } as KaizenWeeklyReviewEntry,
      { id: 'r3', week_start: '2026-03-02', deleted_at: '2026-03-02T00:00:00.000Z' } as KaizenWeeklyReviewEntry,
    ];
    expect(selectWeeklyReviewsSorted(reviews).map(review => review.id)).toEqual(['r2', 'r1']);
  });

  it('selectActiveBooksSorted sorts by title', () => {
    const books: KaizenBookEntry[] = [
      { id: 'b2', title: 'Zeta', deleted_at: null } as KaizenBookEntry,
      { id: 'b1', title: 'Alpha', deleted_at: null } as KaizenBookEntry,
    ];
    expect(selectActiveBooksSorted(books).map(book => book.id)).toEqual(['b1', 'b2']);
  });

  it('selectApprovedInterviewQuestionsOrdered prioritizes due rows', () => {
    const now = new Date('2026-03-01T12:00:00.000Z');
    const questions: KaizenInterviewQuestionEntry[] = [
      {
        id: 'q1',
        import_review_status: 'approved',
        due_at: '2026-04-01T00:00:00.000Z',
      } as KaizenInterviewQuestionEntry,
      {
        id: 'q2',
        import_review_status: 'approved',
        due_at: '2026-02-01T00:00:00.000Z',
      } as KaizenInterviewQuestionEntry,
      {
        id: 'q3',
        import_review_status: 'pending',
        due_at: '2026-01-01T00:00:00.000Z',
      } as KaizenInterviewQuestionEntry,
    ];
    expect(selectPendingInterviewQuestions(questions).map(q => q.id)).toEqual(['q3']);
    expect(
      selectApprovedInterviewQuestionsOrdered(questions, now).map(q => q.id),
    ).toEqual(['q2', 'q1']);
    expect(selectDueInterviewQuestions(questions, now).map(q => q.id)).toEqual(['q2']);
  });

  it('selectActiveSkillsSorted, selectGtdInboxItems, selectCompletedTodayActionLogs, selectAssessedSkills', () => {
    const skills: KaizenSkillNodeEntry[] = [
      { id: 's2', name: 'Zeta', deleted_at: null, mastery_0_to_100: 40 } as KaizenSkillNodeEntry,
      { id: 's1', name: 'Alpha', deleted_at: null, mastery_0_to_100: null } as KaizenSkillNodeEntry,
      { id: 's3', name: 'Removed', deleted_at: '2026-01-01', mastery_0_to_100: 90 } as KaizenSkillNodeEntry,
    ];
    expect(selectActiveSkillsSorted(skills).map(skill => skill.id)).toEqual(['s1', 's2']);
    expect(selectAssessedSkills(skills).map(skill => skill.id)).toEqual(['s2']);

    const gtd: KaizenGtdItemEntry[] = [
      { id: 'g1', status: 'inbox', deleted_at: null } as KaizenGtdItemEntry,
      { id: 'g2', status: 'done', deleted_at: null } as KaizenGtdItemEntry,
      { id: 'g3', status: 'inbox', deleted_at: '2026-01-01' } as KaizenGtdItemEntry,
    ];
    expect(selectGtdInboxItems(gtd).map(item => item.id)).toEqual(['g1']);

    const logs: KaizenActionLogEntry[] = [
      { action_id: 'a1', skipped: 0, completed_at: '2026-01-01' } as KaizenActionLogEntry,
      { action_id: '__wake_confirm__', skipped: 0, completed_at: '2026-01-01' } as KaizenActionLogEntry,
      { action_id: 'a2', skipped: 1, completed_at: '2026-01-01' } as KaizenActionLogEntry,
    ];
    expect(selectCompletedTodayActionLogs(logs).map(log => log.action_id)).toEqual(['a1']);
  });

  it('selectHabitStackStepsForStack, selectIsInterviewQuestionDue, selectAttemptsSince, selectWeakerSkillIds', () => {
    const steps = [
      { user_id: 'user-1', created_at: '2026-07-01', updated_at: '2026-07-01', deleted_at: null, id: 'st2', stack_id: 's1', action_id: 'a2', sort_order: 2 } as const,
      { user_id: 'user-1', created_at: '2026-07-01', updated_at: '2026-07-01', deleted_at: null, id: 'st1', stack_id: 's1', action_id: 'a1', sort_order: 1 } as const,
      { user_id: 'user-1', created_at: '2026-07-01', updated_at: '2026-07-01', deleted_at: null, id: 'st3', stack_id: 's2', action_id: 'a3', sort_order: 1 } as const,
    ];
    expect(selectHabitStackStepsForStack(steps, 's1').map(step => step.id)).toEqual(['st1', 'st2']);
    expect(selectHabitStackActionIdsForStack(steps, 's1')).toEqual(['a1', 'a2']);

    const now = new Date('2026-04-01T12:00:00Z');
    expect(
      selectIsInterviewQuestionDue(
        { due_at: '2026-03-01T00:00:00Z' } as import('../../types').KaizenInterviewQuestionEntry,
        now,
      ),
    ).toBe(true);
    expect(
      selectIsInterviewQuestionDue(
        { due_at: '2026-05-01T00:00:00Z' } as import('../../types').KaizenInterviewQuestionEntry,
        now,
      ),
    ).toBe(false);

    const attempts: KaizenInterviewAttemptEntry[] = [
      { id: 'a-old', attempted_at: '2026-01-01T00:00:00Z' } as KaizenInterviewAttemptEntry,
      { id: 'a-new', attempted_at: '2026-03-15T00:00:00Z' } as KaizenInterviewAttemptEntry,
    ];
    expect(
      selectAttemptsSince(attempts, new Date('2026-03-01T00:00:00Z')).map(attempt => attempt.id),
    ).toEqual(['a-new']);

    const skills: KaizenSkillNodeEntry[] = [
      { id: 'weak', deleted_at: null, mastery_0_to_100: 40 } as KaizenSkillNodeEntry,
      { id: 'strong', deleted_at: null, mastery_0_to_100: 80 } as KaizenSkillNodeEntry,
      { id: 'gone', deleted_at: '2026-01-01', mastery_0_to_100: 10 } as KaizenSkillNodeEntry,
    ];
    expect(selectWeakerSkillIds(skills)).toEqual(new Set(['weak']));
  });

  it('selectSkillById, selectAssessableSkills, selectCareerHubStats', () => {
    const skills: KaizenSkillNodeEntry[] = [
      { id: 's1', name: 'Alpha', deleted_at: null, is_assessable: 1, is_priority: 0 } as KaizenSkillNodeEntry,
      { id: 's2', name: 'Beta', deleted_at: '2026-01-01', is_assessable: 1, is_priority: 1 } as KaizenSkillNodeEntry,
    ];
    expect(selectSkillById(skills, 's1')?.id).toBe('s1');
    expect(selectAssessableSkills(skills).map(skill => skill.id)).toEqual(['s1']);
    expect(selectAverageAssessableMastery(skills)).toBe(0);
    expect(
      selectCareerHubStats({
        skills,
        questions: [{ id: 'q1', deleted_at: null } as KaizenInterviewQuestionEntry],
        pipeline: [{ id: 'p1', deleted_at: null } as KaizenInterviewPipelineEntry],
      }),
    ).toEqual({ skills: 1, questions: 1, opportunities: 1 });
  });

  it('selectDailyCoreForSystem, selectPracticeSessionQuestion, selectAverageAssessedMastery', () => {
    const actions = [
      { id: 'a1', system: 'career', title: 'Apply' },
      { id: 'a2', system: 'health', title: 'Walk' },
    ] as import('../../types').KaizenActionEntry[];
    expect(selectDailyCoreForSystem(actions, 'career').map(action => action.id)).toEqual(['a1']);

    const now = new Date('2026-04-01T12:00:00Z');
    const questions: KaizenInterviewQuestionEntry[] = [
      {
        id: 'q-due',
        deleted_at: null,
        due_at: '2026-03-01T00:00:00Z',
      } as KaizenInterviewQuestionEntry,
      {
        id: 'q-later',
        deleted_at: null,
        due_at: '2026-05-01T00:00:00Z',
      } as KaizenInterviewQuestionEntry,
    ];
    expect(selectPracticeSessionQuestion(questions, 'q-later', now)?.id).toBe('q-later');
    expect(selectPracticeSessionQuestion(questions, 'missing', now)?.id).toBe('q-due');
    expect(selectPracticeSessionQuestion(questions, undefined, now)?.id).toBe('q-due');

    const skills: KaizenSkillNodeEntry[] = [
      { id: 's1', deleted_at: null, mastery_0_to_100: 40 } as KaizenSkillNodeEntry,
      { id: 's2', deleted_at: null, mastery_0_to_100: 80 } as KaizenSkillNodeEntry,
    ];
    expect(selectAverageAssessedMastery(skills)).toBe(60);
  });

  it('selectActiveInterviewQuestions, selectBookById, selectBookQuestionCountForChapter', () => {
    const questions: KaizenInterviewQuestionEntry[] = [
      { id: 'q1', deleted_at: null } as KaizenInterviewQuestionEntry,
      { id: 'q2', deleted_at: '2026-01-01' } as KaizenInterviewQuestionEntry,
    ];
    expect(selectActiveInterviewQuestions(questions).map(question => question.id)).toEqual(['q1']);

    const books: KaizenBookEntry[] = [
      { id: 'b1', deleted_at: null } as KaizenBookEntry,
      { id: 'b2', deleted_at: '2026-01-01' } as KaizenBookEntry,
    ];
    expect(selectBookById(books, 'b1')?.id).toBe('b1');

    const bookQuestions: KaizenBookQuestionEntry[] = [
      { id: 'q1', chapter_id: 'c1', deleted_at: null } as KaizenBookQuestionEntry,
      { id: 'q2', chapter_id: 'c1', deleted_at: '2026-01-01' } as KaizenBookQuestionEntry,
      { id: 'q3', chapter_id: 'c2', deleted_at: null } as KaizenBookQuestionEntry,
    ];
    expect(selectBookQuestionCountForChapter(bookQuestions, 'c1')).toBe(1);
  });
});
