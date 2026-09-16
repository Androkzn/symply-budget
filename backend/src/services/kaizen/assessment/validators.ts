// ============================================================================
// LIFE OS — STRICT JSON PARSE + EVALUATOR SEMANTIC GUARDS
// ============================================================================
//
// Helpers shared by the Kaizen AI routes for strict JSON parsing and the
// "judge-payload semantic guard" the plan requires: criterion scores AND the
// overall score must be numbers in 0..5, and the required fields must be
// present. On any failure the route returns a clear 502 (never crashes).
// ============================================================================

/**
 * Strip a leading/trailing ```json … ``` fence if a provider wraps the JSON in
 * markdown despite `response_format: json_object`. Best-effort; returns the
 * original string when no fence is present.
 */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Strictly parse a provider JSON string into an object. Throws on malformed or
 * non-object payloads so the caller can return a 502 with a clear error.
 */
export function parseStrictJson(raw: string | undefined | null): any {
  if (!raw) {
    throw new Error('AI provider returned an empty response');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error('AI provider returned malformed JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI provider returned a non-object JSON payload');
  }
  return parsed;
}

/** True when `v` is a finite number within [0, 5]. */
function isScore0to5(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 5;
}

/**
 * Semantic guard for evaluator/judge payloads (score-interview-answer,
 * evaluate-assessment-answer). Verifies the required fields exist and that
 * every criterion score and the overall score are numbers in 0..5. Throws a
 * clear error otherwise — the route maps that to a 502 rather than crashing.
 *
 * `requireReasoning` lets the assessment evaluator (which uses `reasoning`)
 * share this guard with the interview judge.
 */
export function validateEvaluatorPayload(
  parsed: any,
  opts?: { requireReasoning?: boolean }
): void {
  const criterionScores = parsed?.criterion_scores;
  if (
    criterionScores === null ||
    typeof criterionScores !== 'object' ||
    Array.isArray(criterionScores)
  ) {
    throw new Error('judge payload missing criterion_scores object');
  }

  const scoreKeys = Object.keys(criterionScores);
  if (scoreKeys.length === 0) {
    throw new Error('judge payload has empty criterion_scores');
  }
  for (const key of scoreKeys) {
    if (!isScore0to5(criterionScores[key])) {
      throw new Error(`criterion score "${key}" is out of range (must be 0..5)`);
    }
  }

  if (!isScore0to5(parsed?.overall_score)) {
    throw new Error('overall_score is missing or out of range (must be 0..5)');
  }

  if (opts?.requireReasoning && typeof parsed?.reasoning !== 'string') {
    throw new Error('judge payload missing reasoning');
  }
}
