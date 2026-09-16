import { fixture, fixtureText } from '../../../../test-utils/fixtures';
import {
  commitKaizenFileImport,
  inferImportPurpose,
  scopeToImportPurpose,
} from '../importHandlers';
import { KAIZEN_DRIVE_SCOPES } from '../rememberScopes';

// The upload text reader is mocked; tests drive REAL fixture text through it.
const mockReadUploadFileText = jest.fn();
jest.mock('../readUploadFileText', () => ({
  readUploadFileText: (...args: unknown[]) => mockReadUploadFileText(...args),
}));

// Real documents from resourses/testing (see e2e/fixtures/manifest.json).
const RESUME = fixture('kaizen-resume'); // resume.pdf
const BOOK = fixture('kaizen-book'); // book.pdf
const TECH_QUESTIONS_TEXT = fixtureText('kaizen-questions-technical');
const TRANSCRIPT_TEXT = fixtureText('kaizen-transcript');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('scopeToImportPurpose', () => {
  it('maps drive scopes to import purposes', () => {
    expect(scopeToImportPurpose(KAIZEN_DRIVE_SCOPES.books)).toBe('book');
    expect(scopeToImportPurpose(KAIZEN_DRIVE_SCOPES.resume)).toBe('resume');
    expect(scopeToImportPurpose(KAIZEN_DRIVE_SCOPES.questions)).toBe('questions');
    expect(scopeToImportPurpose(KAIZEN_DRIVE_SCOPES.general)).toBe('auto');
  });
});

describe('inferImportPurpose', () => {
  it('detects the real resume PDF as a book (pdf branch)', () => {
    // resume.pdf → the pdf/mime branch wins before the name heuristic.
    expect(inferImportPurpose({ uri: RESUME.uri, name: RESUME.name })).toBe('book');
    expect(inferImportPurpose({ uri: BOOK.uri, name: BOOK.name })).toBe('book');
  });

  it('detects question-like text from the real technical-questions transcript', () => {
    // A neutral filename forces the text heuristic (not the name match) to decide;
    // the real interview questions carry several "?" so it routes to questions.
    expect(inferImportPurpose({ uri: 'file://notes.txt', name: 'notes.txt' }, TECH_QUESTIONS_TEXT)).toBe(
      'questions',
    );
  });
});

describe('commitKaizenFileImport', () => {
  it('creates a book and attaches the real resume/book pdf', async () => {
    const addBook = jest.fn().mockResolvedValue('book-1');
    const attachBookFile = jest.fn().mockResolvedValue(undefined);
    const result = await commitKaizenFileImport(
      'book',
      { uri: BOOK.uri, name: BOOK.name },
      {
        addBook,
        attachBookFile,
        importQuestionsFromText: jest.fn(),
        analyzeResume: jest.fn(),
        saveCareerSetup: jest.fn(),
        addSkill: jest.fn(),
        addKnowledgeItem: jest.fn(),
      },
    );
    expect(addBook).toHaveBeenCalled();
    expect(attachBookFile).toHaveBeenCalledWith('book-1', {
      uri: BOOK.uri,
      name: BOOK.name, // real filename: book.pdf
    });
    expect(result.bookId).toBe('book-1');
  });

  it('imports questions from the real technical-questions text file', async () => {
    mockReadUploadFileText.mockResolvedValue(TECH_QUESTIONS_TEXT);
    const importQuestionsFromText = jest.fn().mockResolvedValue(4);
    const result = await commitKaizenFileImport(
      'questions',
      { uri: fixture('kaizen-questions-technical').uri, name: 'technical-questions.txt' },
      {
        importQuestionsFromText,
        analyzeResume: jest.fn(),
        saveCareerSetup: jest.fn(),
        addSkill: jest.fn(),
        addBook: jest.fn(),
        attachBookFile: jest.fn(),
        addKnowledgeItem: jest.fn(),
      },
    );
    // The real document text is what reaches the store.
    expect(importQuestionsFromText).toHaveBeenCalledWith(TECH_QUESTIONS_TEXT);
    expect(TECH_QUESTIONS_TEXT).toContain('Technical Questions');
    expect(result.questionCount).toBe(4);
  });

  it('files a neutral transcript into the knowledge library', async () => {
    // transcript.txt is a meeting transcript (few "?"), so an auto import that is
    // not a pdf/resume/questions lands in the knowledge branch.
    mockReadUploadFileText.mockResolvedValue(TRANSCRIPT_TEXT);
    const addKnowledgeItem = jest.fn().mockResolvedValue(undefined);
    const result = await commitKaizenFileImport(
      'knowledge',
      { uri: fixture('kaizen-transcript').uri, name: 'transcript.txt' },
      {
        importQuestionsFromText: jest.fn(),
        analyzeResume: jest.fn(),
        saveCareerSetup: jest.fn(),
        addSkill: jest.fn(),
        addBook: jest.fn(),
        attachBookFile: jest.fn(),
        addKnowledgeItem,
      },
    );
    expect(addKnowledgeItem).toHaveBeenCalledWith('transcript', 'resources', TRANSCRIPT_TEXT, 'imported');
    expect(result.purpose).toBe('knowledge');
  });
});
