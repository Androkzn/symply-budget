import { readUploadFileText } from './readUploadFileText';
import {
  KAIZEN_DRIVE_SCOPES,
  type KaizenDriveRememberScope,
  type KaizenUploadedFile,
} from './rememberScopes';

export type KaizenImportPurpose = 'resume' | 'questions' | 'book' | 'knowledge' | 'auto';

export type KaizenImportActions = {
  importQuestionsFromText: (documentText: string) => Promise<number>;
  analyzeResume: (resumeText: string) => Promise<{
    summary?: string;
    target_roles?: string[];
    suggested_skills?: Array<{ name: string }>;
  }>;
  saveCareerSetup: (input: {
    targetRoles: string[];
    goalTypes: string[];
    resumeSummary?: string;
    resumeSourceName?: string;
    step: string;
  }) => Promise<void>;
  addSkill: (name: string) => Promise<void>;
  addBook: (input: {
    title: string;
    author?: string;
    language: string;
    sourceType: 'toc_only' | 'pdf';
    chapters: Array<{ title: string }>;
  }) => Promise<string>;
  attachBookFile: (bookId: string, file: { uri: string; name: string }) => Promise<void>;
  addKnowledgeItem: (
    title: string,
    paraType: string,
    content?: string,
    tags?: string,
  ) => Promise<void>;
  profileCareerStep?: string | null;
};

export type KaizenImportResult = {
  purpose: KaizenImportPurpose;
  message: string;
  bookId?: string;
  questionCount?: number;
  resumeSummary?: string;
  resumeText?: string;
};

export function scopeToImportPurpose(scope: KaizenDriveRememberScope): KaizenImportPurpose {
  switch (scope) {
    case KAIZEN_DRIVE_SCOPES.books:
      return 'book';
    case KAIZEN_DRIVE_SCOPES.resume:
      return 'resume';
    case KAIZEN_DRIVE_SCOPES.questions:
      return 'questions';
    default:
      return 'auto';
  }
}

export function inferImportPurpose(file: KaizenUploadedFile, text?: string): KaizenImportPurpose {
  const lower = file.name.toLowerCase();
  const mime = file.mime?.toLowerCase() ?? '';
  if (lower.endsWith('.pdf') || mime === 'application/pdf') return 'book';
  if (/resume|cv|curriculum/.test(lower)) return 'resume';
  if (/question|interview|bank/.test(lower)) return 'questions';
  const sample = text ?? '';
  const questionMarks = (sample.match(/\?/g) ?? []).length;
  const lines = sample.split(/\n+/).filter(line => line.trim().length > 8);
  if (questionMarks >= 2 || (lines.length >= 3 && questionMarks >= 1)) return 'questions';
  if (sample.trim().length > 120) return 'resume';
  return 'knowledge';
}

export function importDestinationPath(result: KaizenImportResult): string | null {
  switch (result.purpose) {
    case 'book':
      return result.bookId ? `/kaizen/book?bookId=${result.bookId}` : '/kaizen/books';
    case 'questions':
      return '/kaizen/question-import';
    case 'resume':
      return '/kaizen/resume-review';
    case 'knowledge':
      return '/kaizen/learn';
    default:
      return null;
  }
}

function bookTitleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/i, '').trim() || 'Uploaded book';
}

export async function commitKaizenFileImport(
  purpose: KaizenImportPurpose,
  file: KaizenUploadedFile,
  actions: KaizenImportActions,
  options?: { bookId?: string; careerStep?: string },
): Promise<KaizenImportResult> {
  if (purpose === 'book' || (purpose === 'auto' && inferImportPurpose(file) === 'book')) {
    const bookId =
      options?.bookId ??
      (await actions.addBook({
        title: bookTitleFromFileName(file.name),
        language: 'en',
        sourceType: 'toc_only',
        chapters: [],
      }));
    await actions.attachBookFile(bookId, { uri: file.uri, name: file.name });
    return {
      purpose: 'book',
      message: `"${bookTitleFromFileName(file.name)}" saved with your PDF.`,
      bookId,
    };
  }

  const text = await readUploadFileText(file);
  const resolved =
    purpose === 'auto' ? inferImportPurpose(file, text) : purpose;

  if (resolved === 'book') {
    return commitKaizenFileImport('book', file, actions, options);
  }

  if (resolved === 'questions') {
    const count = await actions.importQuestionsFromText(text);
    return {
      purpose: 'questions',
      message: `${count} question${count === 1 ? '' : 's'} queued for review.`,
      questionCount: count,
    };
  }

  if (resolved === 'knowledge') {
    await actions.addKnowledgeItem(
      bookTitleFromFileName(file.name),
      'resources',
      text,
      'imported',
    );
    return {
      purpose: 'knowledge',
      message: 'Saved to your knowledge library.',
    };
  }

  const analysis = await actions.analyzeResume(text);
  const targetRoles = analysis.target_roles ?? [];
  await actions.saveCareerSetup({
    targetRoles,
    goalTypes: [],
    resumeSummary: analysis.summary,
    resumeSourceName: file.name,
    step: options?.careerStep ?? actions.profileCareerStep ?? 'resume',
  });
  for (const skill of analysis.suggested_skills ?? []) {
    if (skill.name) await actions.addSkill(skill.name);
  }
  return {
    purpose: 'resume',
    message: 'Resume analyzed and saved to your career profile.',
    resumeSummary: analysis.summary,
    resumeText: text,
  };
}
