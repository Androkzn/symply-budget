// ============================================================================
// LIFE OS — AI PROMPT / PERSONA / RUBRIC BUILDERS
// ============================================================================
//
// All Kaizen AI prompts, personas, and rubrics are chosen HERE on the backend.
// The iOS client sends only the raw inputs (resume text, a question prompt, an
// answer) and never picks the model, temperature, system prompt, or rubric.
//
// Model pinning (server-side, per the plan's "Judge model pin"):
//   The model is pinned in one place so a provider change is a one-line edit and
//   the resolved id is returned to the client to persist on each attempt (scores
//   stay comparable). These mirror the model strings the rest of `ai.ts` already
//   calls successfully against `OPENAI_API_KEY` (the `gpt-4o` family); bump them
//   here when re-baselining and bump `idealAnswerVersion` on the client.
//
// Self-preference avoidance: the candidate answer is the *user's*, so the bias
// path that matters is ideal-answer generator vs judge. Where the provider mix
// allows we keep them on distinct snapshots so the judge is not grading text its
// own snapshot wrote.
// ============================================================================

import { resolveDomainProfile, type AssessmentDomainProfile } from '../assessment/domains';
import { resolvePersona, type AssessorPersona } from '../assessment/personas';

// ---------------------------------------------------------------------------
// Pinned model policy (server-side)
// ---------------------------------------------------------------------------

/** Cheap structured-extraction / classification model (import, categorize). */
export const LIFEOS_EXTRACTION_MODEL = 'gpt-4o-mini';
/** Ideal-answer generator (kept distinct from the judge to avoid self-preference). */
export const LIFEOS_IDEAL_ANSWER_MODEL = 'gpt-4o-mini';
/** Pinned judge model for reference-guided interview scoring. */
export const LIFEOS_JUDGE_MODEL = 'gpt-4o';
/** Career resume analysis. */
export const LIFEOS_RESUME_MODEL = 'gpt-4o-mini';
/** Domain assessment question generation. */
export const LIFEOS_ASSESSMENT_QUESTION_MODEL = 'gpt-4o-mini';
/** Domain assessment answer evaluation (judge). */
export const LIFEOS_ASSESSMENT_EVAL_MODEL = 'gpt-4o';
/** Learning-plan generation. */
export const LIFEOS_LEARNING_PLAN_MODEL = 'gpt-4o-mini';

// ---------------------------------------------------------------------------
// Career resume analysis
// ---------------------------------------------------------------------------

export function buildResumeAnalysisSystemPrompt(): string {
  return 'You are a senior technical recruiter and career coach. You read resumes and extract grounded, evidence-backed skills, target roles, and goals. Return valid JSON only, no markdown.';
}

export function buildResumeAnalysisUserPrompt(resumeText: string): string {
  return `Analyze this resume text and extract a structured career profile.

RESUME:
${resumeText}

RULES:
1. Return valid JSON only.
2. Only list a skill if there is concrete evidence for it in the text; quote or paraphrase that evidence.
3. confidence is 0.0–1.0 for how strongly the resume supports the skill.
4. suggested_goals are concrete, near-term, and grounded in the gaps/strengths you see.
5. target_roles are realistic given the evidence.

Response format:
{
  "suggested_skills": [
    { "name": "Swift Concurrency", "evidence": "Built async image pipeline using actors", "confidence": 0.8 }
  ],
  "suggested_goals": ["Goal 1", "Goal 2"],
  "target_roles": ["Senior iOS Engineer"],
  "summary": "2-3 sentence positioning summary"
}`;
}

// ---------------------------------------------------------------------------
// Question import extraction
// ---------------------------------------------------------------------------

export function buildExtractQuestionsSystemPrompt(): string {
  return 'You extract interview/assessment questions from documents. Return valid JSON only, no markdown.';
}

export function buildExtractQuestionsUserPrompt(
  documentText: string,
  questionBankHint?: string | null
): string {
  const hint = (questionBankHint || '').trim();
  return `Extract distinct interview/assessment questions from this document.
${hint ? `The user expects these to be mostly "${hint}" questions; use that as a prior, not a hard rule.` : ''}

DOCUMENT:
${documentText}

RULES:
1. Return valid JSON only.
2. One entry per distinct question; do not merge or split.
3. question_bank is "technical" or "behavioral".
4. kind is "technical", "behavioral", or "systemDesign".
5. concept_band is a short difficulty label (e.g. "junior", "mid", "senior").
6. topic_tags is a short array of lowercase tags.
7. difficulty_0_to_100 is an integer estimate.

Response format:
{
  "questions": [
    {
      "prompt": "Explain how Swift actors prevent data races.",
      "question_bank": "technical",
      "kind": "technical",
      "concept_band": "mid",
      "topic_tags": ["swift", "concurrency"],
      "difficulty_0_to_100": 55
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Question categorization
// ---------------------------------------------------------------------------

export function buildCategorizeQuestionSystemPrompt(): string {
  return 'You classify a single interview/assessment question. Return valid JSON only, no markdown.';
}

export function buildCategorizeQuestionUserPrompt(prompt: string): string {
  return `Classify this interview/assessment question.

QUESTION:
${prompt}

RULES:
1. Return valid JSON only.
2. question_bank is "technical" or "behavioral".
3. kind is "technical", "behavioral", or "systemDesign".
4. linked_skill_hint is a short skill name this question best assesses (or null).
5. concept_band is a short difficulty label.
6. topic_tags is a short array of lowercase tags.

Response format:
{
  "question_bank": "technical",
  "kind": "technical",
  "linked_skill_hint": "Swift Concurrency",
  "concept_band": "mid",
  "topic_tags": ["swift", "concurrency"]
}`;
}

// ---------------------------------------------------------------------------
// Ideal answer + rubric generation (senior-engineer / interviewer persona)
// ---------------------------------------------------------------------------

export function buildIdealAnswerSystemPrompt(): string {
  return 'You are a senior engineer and experienced interviewer. You write a model "ideal answer" for an interview question and a grading rubric with BARS-style level anchors. The ideal answer is the reference a separate judge will grade real answers against, so it must be correct, complete, and well structured. Return valid JSON only, no markdown.';
}

export function buildIdealAnswerUserPrompt(input: {
  prompt: string;
  questionBank?: string | null;
  kind?: string | null;
  targetLevel?: string | null;
  rubric?: unknown;
}): string {
  const { prompt, questionBank, kind, targetLevel, rubric } = input;
  return `Write an ideal answer and a grading rubric for this interview question.

QUESTION: ${prompt}
QUESTION BANK: ${questionBank || 'unspecified'}
KIND: ${kind || 'unspecified'}
TARGET LEVEL: ${targetLevel || 'mid'}
${rubric ? `EXISTING RUBRIC TO REFINE (optional):\n${JSON.stringify(rubric, null, 2)}` : ''}

RULES:
1. Return valid JSON only.
2. ideal_answer is a complete, correct model answer at the TARGET LEVEL.
3. rubric is an array of criteria. Each criterion has:
   - name (short)
   - weight (0.0–1.0; the weights should sum to ~1.0)
   - level_anchors: EXACTLY 6 short strings describing performance for scores 0,1,2,3,4,5 in order (BARS anchors).
4. For technical questions favor Correctness/Accuracy, Completeness, Depth & Trade-offs (plus Communication/Clarity).
5. For behavioral questions favor STAR Completeness, Action Ownership, Quantified Impact (plus Communication/Clarity).

Response format:
{
  "ideal_answer": "…",
  "rubric": [
    {
      "name": "Correctness",
      "weight": 0.5,
      "level_anchors": ["no understanding", "major errors", "partly correct", "mostly correct", "correct", "correct + nuanced"]
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Interview answer scoring (LLM-as-judge, reference-guided, CoT-before-score)
// ---------------------------------------------------------------------------

/**
 * Judge system prompt. Embeds the reference (ideal answer + rubric) so scoring
 * is reference-guided, instructs chain-of-thought BEFORE the score, and pins a
 * strict JSON contract. Used at temperature 0.
 */
export function buildScoreInterviewSystemPrompt(input: {
  questionBank?: string | null;
  kind?: string | null;
  idealAnswer: string;
  rubric: unknown;
}): string {
  const { questionBank, kind, idealAnswer, rubric } = input;
  return `You are a strict, fair interview judge (${kind || 'technical'} / ${questionBank || 'technical'} bank). You grade a candidate's answer AGAINST a provided reference ideal answer and rubric — this is reference-guided LLM-as-judge scoring.

REFERENCE IDEAL ANSWER:
${idealAnswer}

RUBRIC (each criterion has BARS level anchors for scores 0..5):
${JSON.stringify(rubric, null, 2)}

JUDGING PROTOCOL:
1. First reason step-by-step (chain-of-thought) about how the candidate answer compares to the reference for each rubric criterion. Put this reasoning in the "reasoning" field — do NOT decide a score before reasoning.
2. Score each rubric criterion on its 0..5 BARS anchors. Use the criterion NAME as the key in criterion_scores.
3. overall_score is the weighted average of the criterion scores, on the same 0..5 scale.
4. Grade the candidate's answer only — never the question or the ideal answer. The candidate is a learner; be specific and constructive.
5. Map overall quality to an FSRS rating: "again" (failed), "hard" (struggled), "good" (solid), "easy" (excellent).
6. Return valid JSON only, no markdown. Every criterion score and overall_score MUST be a number in 0..5.

Response format:
{
  "criterion_scores": { "Correctness": 4, "Communication": 3 },
  "overall_score": 3.6,
  "correction_suggestions": ["…", "…"],
  "lesson_learned": "One-sentence takeaway for the candidate.",
  "gap_vs_ideal": "What the answer is missing relative to the ideal.",
  "fsrs_rating": "good",
  "reasoning": "Step-by-step comparison against the reference."
}`;
}

export function buildScoreInterviewUserPrompt(input: {
  prompt: string;
  answerText: string;
}): string {
  return `QUESTION:
${input.prompt}

CANDIDATE ANSWER:
${input.answerText}

Judge the candidate answer per the protocol. Return the strict JSON object.`;
}

// ---------------------------------------------------------------------------
// Domain assessment — question generation
// ---------------------------------------------------------------------------

export function buildAssessmentQuestionSystemPrompt(
  profile: AssessmentDomainProfile,
  persona: AssessorPersona
): string {
  return `You are a ${persona.title}. ${persona.description}
You are running an adaptive closed-book assessment in the "${profile.displayName}" domain. Evaluation focus: ${profile.evaluationStyle}
Generate the NEXT single question that probes the candidate at an appropriate difficulty, given prior turns and the target band. Do not reuse a question already covered by prior turns. Return valid JSON only, no markdown.`;
}

export function buildAssessmentQuestionUserPrompt(input: {
  profile: AssessmentDomainProfile;
  conceptBand?: string | null;
  priorTurns?: unknown;
}): string {
  const { profile, conceptBand, priorTurns } = input;
  return `DOMAIN: ${profile.displayName}
CONCEPT AREAS (coverage scaffold, not a fixed question list): ${profile.conceptAreas.join(', ')}
DIFFICULTY BANDS: ${profile.difficultyBands.join(' < ')}
TARGET CONCEPT BAND: ${conceptBand || 'auto'}
PRIOR TURNS:
${priorTurns ? JSON.stringify(priorTurns, null, 2) : 'none yet (this is the first question)'}

RULES:
1. Return valid JSON only.
2. prompt is the next question text.
3. concept_band is the chosen difficulty label.
4. difficulty_0_to_100 is an integer.
5. topic_tags is a short array of lowercase tags.
6. kind is "technical", "behavioral", or "systemDesign".

Response format:
{
  "prompt": "…",
  "concept_band": "mid",
  "difficulty_0_to_100": 55,
  "topic_tags": ["…"],
  "kind": "technical"
}`;
}

// ---------------------------------------------------------------------------
// Domain assessment — answer evaluation (judge, temperature 0)
// ---------------------------------------------------------------------------

export function buildEvaluateAssessmentSystemPrompt(
  profile: AssessmentDomainProfile,
  persona: AssessorPersona,
  rubric: unknown
): string {
  return `You are a ${persona.title}. ${persona.description}
You are evaluating one answer in an adaptive assessment for the "${profile.displayName}" domain. Evaluation focus: ${profile.evaluationStyle}

RUBRIC:
${JSON.stringify(rubric, null, 2)}

PROTOCOL:
1. Reason step-by-step in "reasoning" BEFORE assigning scores.
2. Score each rubric criterion on a 0..5 scale; use the criterion NAME as the key in criterion_scores.
3. overall_score is the weighted 0..5 result.
4. band_signal is your read of the candidate's current level ("below", "at", or "above" the target band).
5. Return valid JSON only, no markdown. Every score MUST be a number in 0..5.

Response format:
{
  "criterion_scores": { "Correctness": 4 },
  "overall_score": 3.6,
  "band_signal": "at",
  "strengths": ["…"],
  "gaps": ["…"],
  "reasoning": "Step-by-step evaluation."
}`;
}

export function buildEvaluateAssessmentUserPrompt(input: {
  question: string;
  answerText: string;
}): string {
  return `QUESTION:
${input.question}

CANDIDATE ANSWER:
${input.answerText}

Evaluate per the protocol and return the strict JSON object.`;
}

// ---------------------------------------------------------------------------
// Skill learning plan
// ---------------------------------------------------------------------------

export function buildLearningPlanSystemPrompt(): string {
  return 'You are a learning-design coach. From a deterministic assessment result (placement band, mastery, strengths, gaps) you produce a concrete, ordered learning plan. The placement is fixed input — do not re-score the learner. Return valid JSON only, no markdown.';
}

export function buildLearningPlanUserPrompt(input: {
  skill: string;
  placementBand?: string | null;
  mastery0to100?: number | null;
  gaps?: unknown;
  strengths?: unknown;
}): string {
  const { skill, placementBand, mastery0to100, gaps, strengths } = input;
  return `Build a learning plan for this skill.

SKILL: ${skill}
PLACEMENT BAND: ${placementBand || 'unspecified'}
MASTERY (0-100): ${typeof mastery0to100 === 'number' ? mastery0to100 : 'unspecified'}
STRENGTHS: ${strengths ? JSON.stringify(strengths) : 'none provided'}
GAPS: ${gaps ? JSON.stringify(gaps) : 'none provided'}

RULES:
1. Return valid JSON only.
2. concept_sequence is an ordered list of concepts to learn; each has title, band, and a one-line "why".
3. practice_queue is a short list of practice prompts/exercises.
4. review_focus is a short list of areas to spaced-review.
5. reassessment_in_days is an integer (when to re-assess this skill).
6. Anchor the plan to the GAPS — start where the learner is weak, not from zero if they already have mastery.

Response format:
{
  "concept_sequence": [
    { "title": "Actors and isolation", "band": "mid", "why": "Closes the data-race gap from the assessment." }
  ],
  "practice_queue": ["…"],
  "review_focus": ["…"],
  "reassessment_in_days": 14
}`;
}

// Re-export resolvers so route handlers import everything from one place.
export { resolveDomainProfile, resolvePersona };
export type { AssessmentDomainProfile, AssessorPersona };
