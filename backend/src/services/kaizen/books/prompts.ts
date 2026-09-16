/**
 * Book Comprehension — Gemini prompt builders + zod output schemas.
 *
 * Two AI operations in Phase 2 (both stateless; the FE stores results locally
 * and syncs them):
 *   1. generate-questions — MCQ + open + spoken comprehension questions for a
 *      chapter, grounded in the chapter text when available, else in the model's
 *      knowledge of the named book (with a low_confidence flag + no-fabrication
 *      rule for the ToC-only path).
 *   2. grade-answer — TWO-LAYER grading of an open/spoken answer:
 *        Layer 1 (content_score) = meaning/logic — did they understand it?
 *        Layer 2 (mistakes[])     = grammatical/form errors to work on.
 */

import { z } from 'zod';

export type BookQuestionType = 'mcq' | 'open' | 'spoken';

// ---------------------------------------------------------------------------
// generate-questions
// ---------------------------------------------------------------------------

export const bookQuestionSchema = z.object({
  type: z.enum(['mcq', 'open', 'spoken']),
  prompt: z.string().min(1),
  options: z.array(z.string()).optional(), // MCQ: 3-4 options
  answer_index: z.number().int().optional(), // MCQ: index of the correct option
  ideal_answer: z.string().optional(), // open/spoken reference answer
  rubric: z.array(z.string()).optional(), // open/spoken: 3-5 scoring criteria
  difficulty_0_to_100: z.number().optional(),
  low_confidence: z.boolean().optional(), // ToC-only: model unsure of chapter content
});

export const bookQuestionsSchema = z.object({
  questions: z.array(bookQuestionSchema),
});

export type BookGeneratedQuestion = z.infer<typeof bookQuestionSchema>;

export interface BuildQuestionsInput {
  bookTitle: string;
  author?: string | null;
  chapterTitle: string;
  /** Extracted chapter text (PDF path). Absent for the ToC-only path. */
  chapterText?: string | null;
  /** Optional surrounding ToC context to help the model place the chapter. */
  tocContext?: string | null;
  types: BookQuestionType[];
  count: number;
  language: string;
  /** Optional highlighted excerpts to prioritise ("quiz me on my highlights"). */
  highlights?: string[];
}

export function buildBookQuestionsPrompt(input: BuildQuestionsInput): string {
  const {
    bookTitle,
    author,
    chapterTitle,
    chapterText,
    tocContext,
    types,
    count,
    language,
    highlights,
  } = input;

  const typeList = types.join(', ');
  const grounding = chapterText
    ? `Base every question ONLY on the chapter text provided below. Do not use outside knowledge.\n\n--- CHAPTER TEXT START ---\n${chapterText}\n--- CHAPTER TEXT END ---`
    : `No chapter text is available. Use your own knowledge of the book "${bookTitle}"${
        author ? ` by ${author}` : ''
      } to write questions about the chapter titled "${chapterTitle}". If you are NOT confident about the specific content of this chapter, set "low_confidence": true on each question and write broader questions about the topic the chapter title implies. NEVER invent specific facts, quotes, page numbers, or data you are unsure of.`;

  const highlightBlock =
    highlights && highlights.length
      ? `\n\nThe learner highlighted these passages — prioritise questions that check understanding of them:\n${highlights
          .map((h, i) => `${i + 1}. ${h}`)
          .join('\n')}`
      : '';

  const tocBlock = tocContext ? `\n\nTable of contents context:\n${tocContext}` : '';

  return [
    `You are a study coach that verifies whether a reader truly understood a chapter of a book.`,
    `Book: "${bookTitle}"${author ? ` by ${author}` : ''}. Chapter: "${chapterTitle}".`,
    grounding,
    tocBlock,
    highlightBlock,
    ``,
    `Write exactly ${count} comprehension questions, mixing these types: ${typeList}.`,
    `Rules per type:`,
    `- "mcq": provide "options" (exactly 4 plausible options, one clearly correct) and "answer_index" (0-based index of the correct option). No "ideal_answer"/"rubric".`,
    `- "open": a question the reader answers in writing. Provide a concise "ideal_answer" and a "rubric" of 3-5 short scoring criteria. No "options".`,
    `- "spoken": a question the reader answers by speaking aloud (explain a concept). Provide "ideal_answer" and a 3-5 item "rubric". No "options".`,
    `Set "difficulty_0_to_100" for each question. Vary difficulty.`,
    `Write ALL prompts, options, ideal answers and rubric text in this language: ${language}.`,
    ``,
    `Return ONLY a JSON object of the exact shape:`,
    `{"questions":[{"type":"mcq","prompt":"...","options":["...","...","...","..."],"answer_index":0,"difficulty_0_to_100":40,"low_confidence":false}, {"type":"open","prompt":"...","ideal_answer":"...","rubric":["...","..."],"difficulty_0_to_100":60}]}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// grade-answer (two-layer)
// ---------------------------------------------------------------------------

export const bookMistakeSchema = z.object({
  type: z.string(), // grammar | vocabulary | fluency | ...
  severity: z.string().optional(), // low | medium | high | critical
  text: z.string(), // the exact erroneous fragment
  correction: z.string().optional(),
  explanation: z.string().optional(),
  practice_prompt: z.string().optional(),
});

export const bookGradingSchema = z.object({
  content_score: z.number(), // Layer 1 — meaning (may arrive 0..1 / 0..10 / 0..100)
  overall_score: z.number(),
  feedback: z.string(),
  mistakes: z.array(bookMistakeSchema).default([]),
  stronger_answer: z.string().optional(),
});

export type BookGradingResult = z.infer<typeof bookGradingSchema>;

export interface BuildGradingInput {
  prompt: string;
  idealAnswer?: string | null;
  rubric?: string[] | null;
  answerText: string;
  language: string;
  /** When true, this was a spoken answer (transcribed) — used in Phase 5. */
  spoken?: boolean;
}

export function buildBookGradingPrompt(input: BuildGradingInput): string {
  const { prompt, idealAnswer, rubric, answerText, language, spoken } = input;
  const rubricBlock = rubric && rubric.length ? `\nScoring rubric:\n- ${rubric.join('\n- ')}` : '';
  const idealBlock = idealAnswer ? `\nReference (ideal) answer:\n${idealAnswer}` : '';

  return [
    `You are grading a reader's answer to a book-comprehension question on TWO independent layers.`,
    ``,
    `Question:\n${prompt}`,
    idealBlock,
    rubricBlock,
    ``,
    `The reader's ${spoken ? 'spoken (transcribed) ' : ''}answer:\n${answerText}`,
    ``,
    `Layer 1 — MEANING ("content_score", 0.0-1.0): did the reader correctly understand and explain the concept? Judge only understanding/correctness against the ideal answer and rubric. Do NOT lower this for grammar or wording problems.`,
    `Layer 2 — FORM ("mistakes"): list concrete grammar / vocabulary / phrasing mistakes in the answer. For each: "text" (the exact wrong fragment), "correction", a short "explanation", a one-line "practice_prompt", "type" (grammar|vocabulary|fluency), and "severity" (low|medium|high). If the form is clean, return an empty array.`,
    `"overall_score" (0.0-1.0): weight meaning ~70%, form ~30%.`,
    `Write "feedback" (2-3 sentences) and an optional improved "stronger_answer" in this language: ${language}.`,
    ``,
    `Return ONLY a JSON object of the shape:`,
    `{"content_score":0.0,"overall_score":0.0,"feedback":"...","mistakes":[{"type":"grammar","severity":"low","text":"...","correction":"...","explanation":"...","practice_prompt":"..."}],"stronger_answer":"..."}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// extract-toc  (Phase 3: auto-populate chapters from an uploaded PDF)
// ---------------------------------------------------------------------------

export const bookTocChapterSchema = z.object({
  title: z.string(),
  start_page: z.number().optional(),
  end_page: z.number().optional(),
});

export const bookTocSchema = z.object({
  page_count: z.number().optional(),
  chapters: z.array(bookTocChapterSchema),
});

export function buildTocPrompt(): string {
  return [
    `You are given a book as a PDF. Extract its table of contents.`,
    `Return the real chapter/section titles in reading order, each with its starting page`,
    `number (as printed) and, when determinable, its ending page. Skip front matter`,
    `(copyright, dedication) and back matter (index) unless they are substantive chapters.`,
    `Return ONLY JSON of the shape:`,
    `{"page_count": 320, "chapters": [{"title":"1. Introduction","start_page":1,"end_page":18}]}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// extract-chapter  (Phase 3: read ONLY the upcoming chapter's text)
// ---------------------------------------------------------------------------

export const bookChapterTextSchema = z.object({
  text: z.string(),
});

export interface BuildChapterExtractInput {
  chapterTitle: string;
  startPage?: number | null;
  endPage?: number | null;
}

export function buildChapterExtractPrompt(input: BuildChapterExtractInput): string {
  const { chapterTitle, startPage, endPage } = input;
  const pageHint =
    typeof startPage === 'number'
      ? ` (approximately pages ${startPage}${typeof endPage === 'number' ? `–${endPage}` : ' onward'})`
      : '';
  return [
    `You are given a book as a PDF. Extract the complete readable prose of ONLY the chapter`,
    `titled "${chapterTitle}"${pageHint}.`,
    `Preserve paragraph structure (separate paragraphs with a blank line). Omit running`,
    `headers, footers, page numbers, and figure/table captions that are not part of the prose.`,
    `Do NOT summarise, translate, or add commentary — return the chapter's actual text.`,
    `Return ONLY JSON of the shape: {"text": "..."}`,
  ].join('\n');
}

/**
 * Normalise a model score that may arrive on a 0-1, 0-10 or 0-100 scale to 0-1.
 * (Mirrors `normalizeScore` in the language app's analysis.ts.)
 */
export function normalizeScore(raw: number | null | undefined): number {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return 0;
  let v = raw;
  if (v > 1.0001 && v <= 10) v = v / 10;
  else if (v > 10) v = v / 100;
  if (v < 0) v = 0;
  if (v > 1) v = 1;
  return v;
}

// ---------------------------------------------------------------------------
// grade-spoken  (Phase 5: two-layer grading of a SPOKEN answer, from audio)
// ---------------------------------------------------------------------------

/** One word as heard in the recording, with an acoustic pronunciation grade. */
export const spokenWordSchema = z.object({
  word: z.string(),
  score: z.number().default(0), // 0.0 (unintelligible) – 1.0 (native-like)
  is_problem: z.boolean().optional(), // flag red when score < 0.6
  tip: z.string().optional(), // short, concrete coaching tip
});

/**
 * Output of the spoken grader. Deliberately tolerant (optional/default
 * everywhere) so real model output validates without a repair round-trip:
 *   transcription  — what Gemini heard (verbatim)
 *   content_score  — Layer 1: meaning/understanding (may arrive 0..1/0..10/0..100)
 *   mistakes[]     — Layer 2: grammar/vocabulary/phrasing errors (form)
 *   pronunciation  — acoustic per-word grades + optional breakdown
 *   delivery       — filler count, pace, fluency
 */
export const spokenGradingSchema = z.object({
  transcription: z.string().default(''),
  content_score: z.number().default(0),
  overall_score: z.number().default(0),
  feedback: z.string().default(''),
  mistakes: z.array(bookMistakeSchema).default([]),
  pronunciation: z
    .object({
      overall_score: z.number().default(0),
      words: z.array(spokenWordSchema).default([]),
      breakdown: z.record(z.any()).optional(), // phoneme / word_stress / intonation
    })
    .default({}),
  delivery: z
    .object({
      filler_count: z.number().optional(),
      pace: z.string().optional(), // slow | steady | fast
      fluency_score: z.number().optional(),
    })
    .default({}),
});

export type SpokenGradingResult = z.infer<typeof spokenGradingSchema>;

export interface BuildSpokenGradingInput {
  prompt: string;
  idealAnswer?: string | null;
  rubric?: string[] | null;
  language: string;
}

export function buildSpokenGradingPrompt(input: BuildSpokenGradingInput): string {
  const { prompt, idealAnswer, rubric, language } = input;
  const rubricBlock = rubric && rubric.length ? `\nScoring rubric:\n- ${rubric.join('\n- ')}` : '';
  const idealBlock = idealAnswer ? `\nReference (ideal) answer:\n${idealAnswer}` : '';

  return [
    `You are grading a reader's SPOKEN answer to a book-comprehension question. An audio`,
    `recording of the reader speaking is attached. Work in these stages:`,
    ``,
    `(0) TRANSCRIBE the attached audio verbatim into "transcription".`,
    ``,
    `Question:\n${prompt}`,
    idealBlock,
    rubricBlock,
    ``,
    `(1) LAYER 1 — MEANING ("content_score", 0.0-1.0): did the reader correctly understand`,
    `and explain the concept? Judge understanding/correctness against the ideal answer and`,
    `rubric ONLY. Do NOT penalise accent, grammar, or word choice here.`,
    ``,
    `(2) LAYER 2 — FORM ("mistakes"): list concrete grammar / vocabulary / phrasing errors in`,
    `what was said. For each: "text" (the exact wrong fragment), "correction", a short`,
    `"explanation", a one-line "practice_prompt", "type" (grammar|vocabulary|fluency), and`,
    `"severity" (low|medium|high). Return an empty array if the form is clean.`,
    ``,
    `(3) PRONUNCIATION ("pronunciation"): grade ACOUSTICS from the audio itself.`,
    `- "words": every content word in order, each { "word", "score" 0.0-1.0, "is_problem"`,
    `  (true when score < 0.6), "tip" (one short, concrete instruction; "" when fine) }.`,
    `- "overall_score" 0.0-1.0 for overall intelligibility.`,
    `- optional "breakdown" with keys like "phoneme", "word_stress", "intonation".`,
    ``,
    `(4) DELIVERY ("delivery"): "filler_count" (um/uh/like…), "pace" (slow|steady|fast),`,
    `and "fluency_score" 0.0-1.0.`,
    ``,
    `"overall_score" (0.0-1.0): weight meaning ~0.6, form ~0.2, pronunciation/delivery ~0.2.`,
    `Write "feedback" (2-3 sentences) in this language: ${language}.`,
    ``,
    `Return ONLY a JSON object of the exact shape:`,
    `{"transcription":"...","content_score":0.0,"overall_score":0.0,"feedback":"...","mistakes":[{"type":"grammar","severity":"low","text":"...","correction":"...","explanation":"...","practice_prompt":"..."}],"pronunciation":{"overall_score":0.0,"words":[{"word":"...","score":0.0,"is_problem":false,"tip":""}],"breakdown":{"phoneme":0.0,"word_stress":0.0,"intonation":0.0}},"delivery":{"filler_count":0,"pace":"steady","fluency_score":0.0}}`,
  ].join('\n');
}
