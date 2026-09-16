import { postKaizenAI } from '../api/kaizen';

export interface AssessmentTurn {
  prompt: string;
  answer: string;
  conceptBand?: string | null;
  conceptId?: string | null;
  score0to100?: number | null;
  strengths?: string[];
  gaps?: string[];
  rubric?: unknown;
}

export interface SkillAssessmentResult {
  skillId: string;
  assessedAt: string;
  questionCount: number;
  score0to100: number;
  placedBand: string;
  strengthConceptIds: string[];
  gapConceptIds: string[];
  summary: string;
}

export function computeResultFromTurns(turns: AssessmentTurn[], skillId: string): SkillAssessmentResult {
  const scored = turns.filter(
    (turn): turn is AssessmentTurn & { score0to100: number } => typeof turn.score0to100 === 'number',
  );
  const answerScores = turns.map(turn => Math.min(100, turn.answer.trim().length * 2));
  const score0to100 = Math.round(
    (scored.length ? scored.reduce((sum, turn) => sum + turn.score0to100, 0) / scored.length : answerScores.reduce((sum, score) => sum + score, 0) / Math.max(1, answerScores.length)),
  );
  const placedBand = score0to100 >= 80 ? 'advanced' : score0to100 >= 55 ? 'intermediate' : 'foundation';
  const strengthConceptIds = [...new Set(scored.filter(turn => turn.score0to100 >= 70).map(turn => turn.conceptId ?? turn.conceptBand).filter(Boolean) as string[])];
  const gapConceptIds = [...new Set(scored.filter(turn => turn.score0to100 < 55).map(turn => turn.conceptId ?? turn.conceptBand).filter(Boolean) as string[])];
  return {
    skillId, assessedAt: new Date().toISOString(), questionCount: turns.length, score0to100,
    placedBand, strengthConceptIds, gapConceptIds,
    summary: `${placedBand} placement based on ${turns.length} response${turns.length === 1 ? '' : 's'}.`,
  };
}

/** The three placement bands, in order — shared by the AI and manual paths. */
export const ASSESSMENT_BANDS = ['foundation', 'intermediate', 'advanced'] as const;
export type AssessmentBand = (typeof ASSESSMENT_BANDS)[number];

/** Mid-point mastery for a self-declared band (the manual path has no per-answer score). */
const BAND_MASTERY: Record<AssessmentBand, number> = {
  foundation: 30,
  intermediate: 65,
  advanced: 90,
};

/**
 * Build a placement result from the user's OWN declaration, for the no-AI path.
 *
 * This exists so a member without PRO or a BYOK key still gets a real, usable
 * skill placement and learning plan. It is deliberately NOT dressed up as a
 * graded assessment: nothing is scored, the summary says "self-assessed", and
 * `gapConceptIds` carries the user's typed focus areas so `buildOfflinePlan`
 * has something concrete to sequence.
 */
export function buildManualAssessmentResult(
  skillId: string,
  band: AssessmentBand,
  focusAreas: string[] = [],
): SkillAssessmentResult {
  const gaps = focusAreas.map(area => area.trim()).filter(Boolean);
  return {
    skillId,
    assessedAt: new Date().toISOString(),
    questionCount: 0,
    score0to100: BAND_MASTERY[band],
    placedBand: band,
    strengthConceptIds: [],
    gapConceptIds: gaps,
    summary: `${band} placement, self-assessed.`,
  };
}

export async function generateAssessmentQuestion(skillId: string, turns: AssessmentTurn[]) {
  return postKaizenAI('generate-assessment-question', {
    domain: skillId,
    prior_turns: turns.map(turn => ({ question: turn.prompt, answer: turn.answer, score: turn.score0to100 })),
  }) as Promise<{ prompt: string; concept_band?: string; difficulty_0_to_100?: number; rubric?: unknown }>;
}

export async function evaluateAssessmentAnswer(skillId: string, turn: AssessmentTurn) {
  return postKaizenAI('evaluate-assessment-answer', {
    domain: skillId, question: turn.prompt, answer_text: turn.answer, rubric: turn.rubric ?? [{ name: 'response quality', weight: 1 }],
  }) as Promise<{ overall_score?: number; strengths?: string[]; gaps?: string[] }>;
}

// The screen owns the turn loop: generate a question, collect an answer,
// evaluate it, append the turn, then call computeResultFromTurns on completion.
