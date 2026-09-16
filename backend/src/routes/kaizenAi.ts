/**
 * Kaizen AI routes (Kaizen-only) — ported 1:1 from the donor `kaizen/backend`
 * `src/routes/ai.ts` (the 8 Kaizen / career endpoints only; the donor's
 * nutrition/health AI endpoints are intentionally NOT ported).
 *
 * Mounted at `/api/v1/ai` and brand-gated to `symply-kaizen` in src/index.ts.
 *
 * Provider: OpenAI chat-completions (matches the donor). Requires
 * `OPENAI_API_KEY` on the worker. Each endpoint:
 *  - pass through `system_fingerprint` when the provider returns it
 *  - use temperature 0 for evaluators (score-interview-answer,
 *    evaluate-assessment-answer) and temperature 0.2 for generators
 */

import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import { rateLimitDO } from '../middleware/rate-limit';
import { requireAIEntitlement } from '../middleware/require-ai-entitlement';
import {
  resolveProviderApiKey,
  resolveSelectedModelForProvider,
} from '../services/ai-credential-resolver';
import { kaizenCostGuard } from '../services/kaizen/ai/costGuards';
import {
  LIFEOS_EXTRACTION_MODEL,
  LIFEOS_IDEAL_ANSWER_MODEL,
  LIFEOS_JUDGE_MODEL,
  LIFEOS_RESUME_MODEL,
  LIFEOS_ASSESSMENT_QUESTION_MODEL,
  LIFEOS_ASSESSMENT_EVAL_MODEL,
  LIFEOS_LEARNING_PLAN_MODEL,
  buildResumeAnalysisSystemPrompt,
  buildResumeAnalysisUserPrompt,
  buildExtractQuestionsSystemPrompt,
  buildExtractQuestionsUserPrompt,
  buildCategorizeQuestionSystemPrompt,
  buildCategorizeQuestionUserPrompt,
  buildIdealAnswerSystemPrompt,
  buildIdealAnswerUserPrompt,
  buildScoreInterviewSystemPrompt,
  buildScoreInterviewUserPrompt,
  buildAssessmentQuestionSystemPrompt,
  buildAssessmentQuestionUserPrompt,
  buildEvaluateAssessmentSystemPrompt,
  buildEvaluateAssessmentUserPrompt,
  buildLearningPlanSystemPrompt,
  buildLearningPlanUserPrompt,
  resolveDomainProfile,
  resolvePersona,
} from '../services/kaizen/ai/prompts';
import { parseStrictJson, validateEvaluatorPayload } from '../services/kaizen/assessment/validators';
import type { Env } from '../types';

const ai = new Hono<{ Bindings: Env }>();

// All AI routes require authentication (target platform JWT).
ai.use('*', authMiddleware());

// Every endpoint in this router spends a model call, so entitlement is router-
// wide: the caller must either hold a PRO subscription (managed key) or have
// connected their own provider key (BYOK). Without one, a free user's request
// would otherwise fall through `resolveProviderApiKey` to the platform-managed
// OPENAI_API_KEY and bill us. Kaizen's manual paths (self-assessment, manual
// question entry, offline learning plan) stay open — see the FE gates.
ai.use('*', requireAIEntitlement());

// Rate limit for AI operations (100 requests per hour per user — see RATE_LIMITS).
const aiRateLimit = rateLimitDO('kaizen:ai');

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * POST /api/v1/ai/analyze-career-resume
 * Input: { resumeText } → suggested skills (with evidence/confidence), goals,
 * target roles, summary.
 */
ai.post('/analyze-career-resume', aiRateLimit, async (c) => {
  const body = await c.req.json().catch(() => null) as any;

  const resumeText = body?.resumeText ?? body?.resume_text;
  if (typeof resumeText !== 'string' || resumeText.trim().length === 0) {
    return c.json({ error: 'resumeText is required' }, 400);
  }

  const userId = c.get('user').sub;
  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'openai');
  if (!apiKey) {
    return c.json({ error: 'AI service not configured' }, 503);
  }
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'openai')) ?? LIFEOS_RESUME_MODEL;

  const guard = await kaizenCostGuard(c, userId, 'resumeAnalysis');
  if (!guard.allowed) {
    return c.json({ error: 'Daily resume-analysis quota exceeded', degraded: true }, 429);
  }

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildResumeAnalysisSystemPrompt() },
          { role: 'user', content: buildResumeAnalysisUserPrompt(resumeText) },
        ],
        max_tokens: 1500,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI API failed');
    }

    const result: any = await response.json();
    let parsed: any;
    try {
      parsed = parseStrictJson(result.choices?.[0]?.message?.content);
    } catch (pe) {
      console.error('[analyze-career-resume] parse error:', pe);
      return c.json({ error: 'AI returned an invalid response', details: String(pe) }, 502);
    }

    if (result.system_fingerprint) parsed.system_fingerprint = result.system_fingerprint;
    parsed.model = model;
    return c.json(parsed);
  } catch (e) {
    console.error('Career resume analysis error:', e);
    return c.json({ error: 'Career resume analysis failed', details: String(e) }, 500);
  }
});

/**
 * POST /api/v1/ai/extract-kaizen-questions
 * Input: { documentText, questionBank? } → { questions: [...] }.
 */
ai.post('/extract-kaizen-questions', aiRateLimit, async (c) => {
  const body = await c.req.json().catch(() => null) as any;

  const documentText = body?.documentText ?? body?.rawText ?? body?.document_text;
  const questionBankHint = body?.questionBank ?? body?.question_bank ?? null;
  if (typeof documentText !== 'string' || documentText.trim().length === 0) {
    return c.json({ error: 'documentText is required' }, 400);
  }

  const userId = c.get('user').sub;
  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'openai');
  if (!apiKey) {
    return c.json({ error: 'AI service not configured' }, 503);
  }
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'openai')) ?? LIFEOS_EXTRACTION_MODEL;

  const guard = await kaizenCostGuard(c, userId, 'importExtraction');
  if (!guard.allowed) {
    return c.json({ error: 'Daily question-import quota exceeded', degraded: true }, 429);
  }

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildExtractQuestionsSystemPrompt() },
          { role: 'user', content: buildExtractQuestionsUserPrompt(documentText, questionBankHint) },
        ],
        max_tokens: 2000,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI API failed');
    }

    const result: any = await response.json();
    let parsed: any;
    try {
      parsed = parseStrictJson(result.choices?.[0]?.message?.content);
    } catch (pe) {
      console.error('[extract-kaizen-questions] parse error:', pe);
      return c.json({ error: 'AI returned an invalid response', details: String(pe) }, 502);
    }

    if (!Array.isArray(parsed.questions)) parsed.questions = [];
    if (result.system_fingerprint) parsed.system_fingerprint = result.system_fingerprint;
    parsed.model = model;
    return c.json(parsed);
  } catch (e) {
    console.error('Question extraction error:', e);
    return c.json({ error: 'Question extraction failed', details: String(e) }, 500);
  }
});

/**
 * POST /api/v1/ai/categorize-kaizen-question
 * Input: { prompt } → question_bank, kind, linked_skill_hint, concept_band, topic_tags.
 */
ai.post('/categorize-kaizen-question', aiRateLimit, async (c) => {
  const body = await c.req.json().catch(() => null) as any;

  const prompt = body?.prompt;
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  const userId = c.get('user').sub;
  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'openai');
  if (!apiKey) {
    return c.json({ error: 'AI service not configured' }, 503);
  }
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'openai')) ?? LIFEOS_EXTRACTION_MODEL;

  const guard = await kaizenCostGuard(c, userId, 'classification');
  if (!guard.allowed) {
    return c.json({ error: 'Daily categorization quota exceeded', degraded: true }, 429);
  }

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildCategorizeQuestionSystemPrompt() },
          { role: 'user', content: buildCategorizeQuestionUserPrompt(prompt) },
        ],
        max_tokens: 400,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI API failed');
    }

    const result: any = await response.json();
    let parsed: any;
    try {
      parsed = parseStrictJson(result.choices?.[0]?.message?.content);
    } catch (pe) {
      console.error('[categorize-kaizen-question] parse error:', pe);
      return c.json({ error: 'AI returned an invalid response', details: String(pe) }, 502);
    }

    if (result.system_fingerprint) parsed.system_fingerprint = result.system_fingerprint;
    parsed.model = model;
    return c.json(parsed);
  } catch (e) {
    console.error('Question categorization error:', e);
    return c.json({ error: 'Question categorization failed', details: String(e) }, 500);
  }
});

/**
 * POST /api/v1/ai/generate-ideal-answer
 * Input: { prompt, question_bank, kind, target_level, rubric? } →
 * { ideal_answer, rubric: [{name, weight, level_anchors[6]}] }.
 * Uses a senior-engineer / interviewer persona server-side.
 */
ai.post('/generate-ideal-answer', aiRateLimit, async (c) => {
  const body = await c.req.json().catch(() => null) as any;

  const prompt = body?.prompt;
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return c.json({ error: 'prompt is required' }, 400);
  }
  const questionBank = body?.question_bank ?? body?.questionBank ?? null;
  const kind = body?.kind ?? null;
  const targetLevel = body?.target_level ?? body?.targetLevel ?? null;
  const existingRubric = body?.rubric ?? null;

  const userId = c.get('user').sub;
  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'openai');
  if (!apiKey) {
    return c.json({ error: 'AI service not configured' }, 503);
  }
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'openai')) ?? LIFEOS_IDEAL_ANSWER_MODEL;

  const guard = await kaizenCostGuard(c, userId, 'idealGeneration');
  if (!guard.allowed) {
    return c.json({ error: 'Daily ideal-answer quota exceeded', degraded: true }, 429);
  }

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildIdealAnswerSystemPrompt() },
          {
            role: 'user',
            content: buildIdealAnswerUserPrompt({
              prompt,
              questionBank,
              kind,
              targetLevel,
              rubric: existingRubric,
            }),
          },
        ],
        max_tokens: 1800,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI API failed');
    }

    const result: any = await response.json();
    let parsed: any;
    try {
      parsed = parseStrictJson(result.choices?.[0]?.message?.content);
      if (typeof parsed.ideal_answer !== 'string' || !Array.isArray(parsed.rubric)) {
        throw new Error('missing ideal_answer or rubric');
      }
    } catch (pe) {
      console.error('[generate-ideal-answer] parse error:', pe);
      return c.json({ error: 'AI returned an invalid response', details: String(pe) }, 502);
    }

    if (result.system_fingerprint) parsed.system_fingerprint = result.system_fingerprint;
    parsed.model = model;
    return c.json(parsed);
  } catch (e) {
    console.error('Ideal answer generation error:', e);
    return c.json({ error: 'Ideal answer generation failed', details: String(e) }, 500);
  }
});

/**
 * POST /api/v1/ai/score-interview-answer
 * LLM-as-judge: reference-guided, chain-of-thought before score, strict JSON,
 * temperature 0. Input: { prompt, ideal_answer, rubric, answer_text, question_bank, kind }.
 */
ai.post('/score-interview-answer', aiRateLimit, async (c) => {
  const body = await c.req.json().catch(() => null) as any;

  const prompt = body?.prompt;
  const idealAnswer = body?.ideal_answer ?? body?.idealAnswer;
  const rubric = body?.rubric;
  const answerText = body?.answer_text ?? body?.answerText;
  const questionBank = body?.question_bank ?? body?.questionBank ?? null;
  const kind = body?.kind ?? null;

  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return c.json({ error: 'prompt is required' }, 400);
  }
  if (typeof idealAnswer !== 'string' || idealAnswer.trim().length === 0) {
    return c.json({ error: 'ideal_answer is required' }, 400);
  }
  if (typeof answerText !== 'string' || answerText.trim().length === 0) {
    return c.json({ error: 'answer_text is required' }, 400);
  }
  if (!rubric) {
    return c.json({ error: 'rubric is required' }, 400);
  }

  const userId = c.get('user').sub;
  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'openai');
  if (!apiKey) {
    return c.json({ error: 'AI service not configured' }, 503);
  }
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'openai')) ?? LIFEOS_JUDGE_MODEL;

  const guard = await kaizenCostGuard(c, userId, 'scoring');
  if (!guard.allowed) {
    return c.json({ error: 'Daily scoring quota exceeded', degraded: true }, 429);
  }

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: buildScoreInterviewSystemPrompt({ questionBank, kind, idealAnswer, rubric }),
          },
          { role: 'user', content: buildScoreInterviewUserPrompt({ prompt, answerText }) },
        ],
        max_tokens: 1500,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI API failed');
    }

    const result: any = await response.json();
    let parsed: any;
    try {
      parsed = parseStrictJson(result.choices?.[0]?.message?.content);
      validateEvaluatorPayload(parsed, { requireReasoning: true });
    } catch (pe) {
      console.error('[score-interview-answer] parse/validation error:', pe);
      return c.json({ error: 'Judge returned an invalid response', details: String(pe) }, 502);
    }

    if (result.system_fingerprint) parsed.system_fingerprint = result.system_fingerprint;
    parsed.model = model;
    return c.json(parsed);
  } catch (e) {
    console.error('Interview answer scoring error:', e);
    return c.json({ error: 'Interview answer scoring failed', details: String(e) }, 500);
  }
});

/**
 * POST /api/v1/ai/generate-assessment-question
 * Input: { domain, persona, concept_band, prior_turns } →
 * { prompt, concept_band, difficulty_0_to_100, topic_tags, kind }.
 * Persona/prompt selected server-side from the domain profile.
 */
ai.post('/generate-assessment-question', aiRateLimit, async (c) => {
  const body = await c.req.json().catch(() => null) as any;

  const domainId = body?.domain ?? body?.domainId ?? body?.domain_id;
  const conceptBand = body?.concept_band ?? body?.conceptBand ?? null;
  const priorTurns = body?.prior_turns ?? body?.priorTurns ?? null;

  if (typeof domainId !== 'string' || domainId.trim().length === 0) {
    return c.json({ error: 'domain is required' }, 400);
  }

  const userId = c.get('user').sub;
  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'openai');
  if (!apiKey) {
    return c.json({ error: 'AI service not configured' }, 503);
  }
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'openai')) ?? LIFEOS_ASSESSMENT_QUESTION_MODEL;

  const guard = await kaizenCostGuard(c, userId, 'assessmentTurn');
  if (!guard.allowed) {
    return c.json({ error: 'Daily assessment quota exceeded', degraded: true }, 429);
  }

  // Persona is resolved from the domain profile server-side; a client-sent
  // `persona` only overrides when explicitly provided.
  const profile = resolveDomainProfile(domainId);
  const persona = resolvePersona(body?.persona ?? profile.personaId);

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildAssessmentQuestionSystemPrompt(profile, persona) },
          {
            role: 'user',
            content: buildAssessmentQuestionUserPrompt({ profile, conceptBand, priorTurns }),
          },
        ],
        max_tokens: 800,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI API failed');
    }

    const result: any = await response.json();
    let parsed: any;
    try {
      parsed = parseStrictJson(result.choices?.[0]?.message?.content);
      if (typeof parsed.prompt !== 'string' || parsed.prompt.trim().length === 0) {
        throw new Error('missing prompt');
      }
    } catch (pe) {
      console.error('[generate-assessment-question] parse error:', pe);
      return c.json({ error: 'AI returned an invalid response', details: String(pe) }, 502);
    }

    if (result.system_fingerprint) parsed.system_fingerprint = result.system_fingerprint;
    parsed.model = model;
    parsed.domain = profile.id;
    parsed.persona = persona.id;
    return c.json(parsed);
  } catch (e) {
    console.error('Assessment question generation error:', e);
    return c.json({ error: 'Assessment question generation failed', details: String(e) }, 500);
  }
});

/**
 * POST /api/v1/ai/evaluate-assessment-answer
 * Input: { domain, persona, rubric, question, answer_text } →
 * { criterion_scores, overall_score, band_signal, strengths, gaps, reasoning }.
 * Domain-specific evaluator, temperature 0.
 */
ai.post('/evaluate-assessment-answer', aiRateLimit, async (c) => {
  const body = await c.req.json().catch(() => null) as any;

  const domainId = body?.domain ?? body?.domainId ?? body?.domain_id;
  const rubric = body?.rubric;
  const question = body?.question;
  const answerText = body?.answer_text ?? body?.answerText;

  if (typeof domainId !== 'string' || domainId.trim().length === 0) {
    return c.json({ error: 'domain is required' }, 400);
  }
  if (typeof question !== 'string' || question.trim().length === 0) {
    return c.json({ error: 'question is required' }, 400);
  }
  if (typeof answerText !== 'string' || answerText.trim().length === 0) {
    return c.json({ error: 'answer_text is required' }, 400);
  }
  if (!rubric) {
    return c.json({ error: 'rubric is required' }, 400);
  }

  const userId = c.get('user').sub;
  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'openai');
  if (!apiKey) {
    return c.json({ error: 'AI service not configured' }, 503);
  }
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'openai')) ?? LIFEOS_ASSESSMENT_EVAL_MODEL;

  const guard = await kaizenCostGuard(c, userId, 'assessmentTurn');
  if (!guard.allowed) {
    return c.json({ error: 'Daily assessment quota exceeded', degraded: true }, 429);
  }

  const profile = resolveDomainProfile(domainId);
  const persona = resolvePersona(body?.persona ?? profile.personaId);

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildEvaluateAssessmentSystemPrompt(profile, persona, rubric) },
          { role: 'user', content: buildEvaluateAssessmentUserPrompt({ question, answerText }) },
        ],
        max_tokens: 1200,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI API failed');
    }

    const result: any = await response.json();
    let parsed: any;
    try {
      parsed = parseStrictJson(result.choices?.[0]?.message?.content);
      validateEvaluatorPayload(parsed, { requireReasoning: true });
    } catch (pe) {
      console.error('[evaluate-assessment-answer] parse/validation error:', pe);
      return c.json({ error: 'Evaluator returned an invalid response', details: String(pe) }, 502);
    }

    if (result.system_fingerprint) parsed.system_fingerprint = result.system_fingerprint;
    parsed.model = model;
    parsed.domain = profile.id;
    parsed.persona = persona.id;
    return c.json(parsed);
  } catch (e) {
    console.error('Assessment answer evaluation error:', e);
    return c.json({ error: 'Assessment answer evaluation failed', details: String(e) }, 500);
  }
});

/**
 * POST /api/v1/ai/build-skill-learning-plan
 * Input: { skill, placement_band, mastery_0_to_100, gaps, strengths } →
 * { concept_sequence, practice_queue, review_focus, reassessment_in_days }.
 * Constrained by the deterministic assessment result (does not re-score).
 */
ai.post('/build-skill-learning-plan', aiRateLimit, async (c) => {
  const body = await c.req.json().catch(() => null) as any;

  const skill = body?.skill;
  if (typeof skill !== 'string' || skill.trim().length === 0) {
    return c.json({ error: 'skill is required' }, 400);
  }
  const placementBand = body?.placement_band ?? body?.placementBand ?? null;
  const mastery0to100 = body?.mastery_0_to_100 ?? body?.mastery0to100 ?? null;
  const gaps = body?.gaps ?? null;
  const strengths = body?.strengths ?? null;

  const userId = c.get('user').sub;
  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'openai');
  if (!apiKey) {
    return c.json({ error: 'AI service not configured' }, 503);
  }
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'openai')) ?? LIFEOS_LEARNING_PLAN_MODEL;

  const guard = await kaizenCostGuard(c, userId, 'learningPlan');
  if (!guard.allowed) {
    return c.json({ error: 'Daily learning-plan quota exceeded', degraded: true }, 429);
  }

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildLearningPlanSystemPrompt() },
          {
            role: 'user',
            content: buildLearningPlanUserPrompt({
              skill,
              placementBand,
              mastery0to100,
              gaps,
              strengths,
            }),
          },
        ],
        max_tokens: 1500,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI API failed');
    }

    const result: any = await response.json();
    let parsed: any;
    try {
      parsed = parseStrictJson(result.choices?.[0]?.message?.content);
    } catch (pe) {
      console.error('[build-skill-learning-plan] parse error:', pe);
      return c.json({ error: 'AI returned an invalid response', details: String(pe) }, 502);
    }

    if (!Array.isArray(parsed.concept_sequence)) parsed.concept_sequence = [];
    if (!Array.isArray(parsed.practice_queue)) parsed.practice_queue = [];
    if (!Array.isArray(parsed.review_focus)) parsed.review_focus = [];
    if (result.system_fingerprint) parsed.system_fingerprint = result.system_fingerprint;
    parsed.model = model;
    return c.json(parsed);
  } catch (e) {
    console.error('Skill learning plan error:', e);
    return c.json({ error: 'Skill learning plan failed', details: String(e) }, 500);
  }
});

export default ai;
