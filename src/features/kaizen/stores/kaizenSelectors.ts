/**
 * Pure read-path selectors for kaizenStore (Track A / A7).
 *
 * Keeps filter/sort logic out of the Zustand store so screens and tests can
 * reuse the same projections without reaching into store internals.
 */
import type {
  KaizenActionEntry,
  KaizenActionLogEntry,
  KaizenBookChapterEntry,
  KaizenBookEntry,
  KaizenBookHighlightEntry,
  KaizenBookQuestionEntry,
  KaizenGtdItemEntry,
  KaizenHabitStackStepEntry,
  KaizenInterviewAttemptEntry,
  KaizenInterviewPipelineEntry,
  KaizenInterviewQuestionEntry,
  KaizenSkillNodeEntry,
  KaizenUserMemoryEntry,
  KaizenWeeklyReviewEntry,
} from '../types';

export function selectBookChapters(
  chapters: KaizenBookChapterEntry[],
  bookId: string,
): KaizenBookChapterEntry[] {
  return chapters
    .filter(chapter => chapter.book_id === bookId && !chapter.deleted_at)
    .sort((a, b) => a.chapter_index - b.chapter_index);
}

export function selectBookQuestionsForChapter(
  questions: KaizenBookQuestionEntry[],
  chapterId: string,
): KaizenBookQuestionEntry[] {
  return questions.filter(
    question => question.chapter_id === chapterId && !question.deleted_at,
  );
}

export function selectBookHighlightsForChapter(
  highlights: KaizenBookHighlightEntry[],
  chapterId: string,
): KaizenBookHighlightEntry[] {
  return highlights.filter(
    highlight => highlight.chapter_id === chapterId && !highlight.deleted_at,
  );
}

export function selectAttemptsForQuestion(
  attempts: KaizenInterviewAttemptEntry[],
  questionId: string,
): KaizenInterviewAttemptEntry[] {
  return attempts
    .filter(attempt => attempt.question_id === questionId)
    .sort((a, b) => b.attempted_at.localeCompare(a.attempted_at));
}

export function selectActiveBooks(books: KaizenBookEntry[]): KaizenBookEntry[] {
  return books.filter(book => !book.deleted_at);
}

export function selectActiveBooksSorted(books: KaizenBookEntry[]): KaizenBookEntry[] {
  return selectActiveBooks(books).sort((a, b) => a.title.localeCompare(b.title));
}

export function selectPendingInterviewQuestions(
  questions: KaizenInterviewQuestionEntry[],
): KaizenInterviewQuestionEntry[] {
  return questions.filter(question => question.import_review_status === 'pending');
}

export function selectApprovedInterviewQuestionsOrdered(
  questions: KaizenInterviewQuestionEntry[],
  now: Date = new Date(),
): KaizenInterviewQuestionEntry[] {
  return questions
    .filter(question => question.import_review_status === 'approved')
    .sort(
      (a, b) =>
        Number(Boolean(b.due_at && new Date(b.due_at) <= now)) -
        Number(Boolean(a.due_at && new Date(a.due_at) <= now)),
    );
}

export function selectDueInterviewQuestions(
  questions: KaizenInterviewQuestionEntry[],
  now: Date = new Date(),
): KaizenInterviewQuestionEntry[] {
  return selectApprovedInterviewQuestionsOrdered(questions, now).filter(
    question => question.due_at && new Date(question.due_at) <= now,
  );
}

export function selectBookQuestionsForChapterSorted(
  questions: KaizenBookQuestionEntry[],
  chapterId: string,
): KaizenBookQuestionEntry[] {
  return selectBookQuestionsForChapter(questions, chapterId).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
}

export function selectActivePipelineItems(
  pipeline: KaizenInterviewPipelineEntry[],
): KaizenInterviewPipelineEntry[] {
  return pipeline.filter(item => !item.deleted_at);
}

export function selectActiveMemories(
  memories: KaizenUserMemoryEntry[],
): KaizenUserMemoryEntry[] {
  return memories.filter(memory => !memory.is_archived);
}

export function selectWeeklyReviewsSorted(
  reviews: KaizenWeeklyReviewEntry[],
): KaizenWeeklyReviewEntry[] {
  return reviews
    .filter(review => !review.deleted_at)
    .sort((a, b) => b.week_start.localeCompare(a.week_start));
}

export function selectActiveSkillsSorted(
  skills: KaizenSkillNodeEntry[],
): KaizenSkillNodeEntry[] {
  return skills
    .filter(skill => !skill.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function selectGtdInboxItems(
  gtd: KaizenGtdItemEntry[],
): KaizenGtdItemEntry[] {
  return gtd.filter(item => !item.deleted_at && item.status === 'inbox');
}

export function selectCompletedTodayActionLogs(
  logs: KaizenActionLogEntry[],
): KaizenActionLogEntry[] {
  return logs.filter(
    log => !log.skipped && log.completed_at && log.action_id !== '__wake_confirm__',
  );
}

export function selectAssessedSkills(
  skills: KaizenSkillNodeEntry[],
): KaizenSkillNodeEntry[] {
  return skills.filter(skill => !skill.deleted_at && skill.mastery_0_to_100 !== null);
}

export function selectHabitStackStepsForStack(
  steps: KaizenHabitStackStepEntry[],
  stackId: string,
): KaizenHabitStackStepEntry[] {
  return steps
    .filter(step => step.stack_id === stackId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function selectHabitStackActionIdsForStack(
  steps: KaizenHabitStackStepEntry[],
  stackId: string,
): string[] {
  return selectHabitStackStepsForStack(steps, stackId)
    .filter(step => step.action_id)
    .map(step => step.action_id as string);
}

export function selectIsInterviewQuestionDue(
  question: KaizenInterviewQuestionEntry,
  now: Date = new Date(),
): boolean {
  return Boolean(question.due_at && new Date(question.due_at) <= now);
}

export function selectAttemptsSince(
  attempts: KaizenInterviewAttemptEntry[],
  since: Date,
): KaizenInterviewAttemptEntry[] {
  return attempts.filter(attempt => new Date(attempt.attempted_at) >= since);
}

export function selectWeakerSkillIds(
  skills: KaizenSkillNodeEntry[],
  threshold = 60,
): Set<string> {
  return new Set(
    skills
      .filter(skill => !skill.deleted_at && (skill.mastery_0_to_100 ?? 0) < threshold)
      .map(skill => skill.id),
  );
}

export function selectSkillById(
  skills: KaizenSkillNodeEntry[],
  skillId: string,
): KaizenSkillNodeEntry | undefined {
  return skills.find(skill => skill.id === skillId && !skill.deleted_at);
}

export function selectBookById(
  books: KaizenBookEntry[],
  bookId: string,
): KaizenBookEntry | undefined {
  return books.find(book => book.id === bookId && !book.deleted_at);
}

export function selectQuestionById(
  questions: KaizenInterviewQuestionEntry[],
  questionId: string,
): KaizenInterviewQuestionEntry | undefined {
  return questions.find(question => question.id === questionId);
}

export function selectAssessableSkills(
  skills: KaizenSkillNodeEntry[],
): KaizenSkillNodeEntry[] {
  return skills.filter(skill => !skill.deleted_at && Boolean(skill.is_assessable));
}

export function selectPrioritySkills(
  skills: KaizenSkillNodeEntry[],
): KaizenSkillNodeEntry[] {
  return skills.filter(skill => !skill.deleted_at && Boolean(skill.is_priority));
}

export function selectAverageAssessableMastery(
  skills: KaizenSkillNodeEntry[],
): number {
  const assessable = selectAssessableSkills(skills);
  if (assessable.length === 0) return 0;
  return (
    assessable.reduce((sum, skill) => sum + (skill.mastery_0_to_100 ?? 0), 0) /
    assessable.length
  );
}

export function selectCareerHubStats(input: {
  skills: KaizenSkillNodeEntry[];
  questions: KaizenInterviewQuestionEntry[];
  pipeline: KaizenInterviewPipelineEntry[];
}): { skills: number; questions: number; opportunities: number } {
  return {
    skills: selectActiveSkillsSorted(input.skills).length,
    questions: selectActiveInterviewQuestions(input.questions).length,
    opportunities: selectActivePipelineItems(input.pipeline).length,
  };
}

export function selectActiveInterviewQuestions(
  questions: KaizenInterviewQuestionEntry[],
): KaizenInterviewQuestionEntry[] {
  return questions.filter(question => !question.deleted_at);
}

export function selectDailyCoreForSystem(
  actions: KaizenActionEntry[],
  system: string,
): KaizenActionEntry[] {
  return actions.filter(action => action.system === system);
}

export function selectPracticeSessionQuestion(
  questions: KaizenInterviewQuestionEntry[],
  questionId?: string,
  now: Date = new Date(),
): KaizenInterviewQuestionEntry | undefined {
  const active = selectActiveInterviewQuestions(questions);
  const matched = questionId ? active.find(item => item.id === questionId) : undefined;
  return (
    matched ??
    active.find(item => selectIsInterviewQuestionDue(item, now)) ??
    active[0]
  );
}

export function selectAverageAssessedMastery(skills: KaizenSkillNodeEntry[]): number {
  const assessed = selectAssessedSkills(skills);
  if (assessed.length === 0) return 0;
  return Math.round(
    assessed.reduce((sum, skill) => sum + (skill.mastery_0_to_100 ?? 0), 0) /
      assessed.length,
  );
}

export function selectBookQuestionCountForChapter(
  questions: KaizenBookQuestionEntry[],
  chapterId: string,
): number {
  return selectBookQuestionsForChapter(questions, chapterId).length;
}
