import { postKaizenAI } from '../../api/kaizen';
import {
  ASSESSMENT_BANDS,
  buildManualAssessmentResult,
  computeResultFromTurns,
  evaluateAssessmentAnswer,
  generateAssessmentQuestion,
  type AssessmentTurn,
} from '../skillAssessment';

jest.mock('../../api/kaizen', () => ({ postKaizenAI: jest.fn() }));
const mockAI = postKaizenAI as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('computeResultFromTurns', () => {
  it('places scored turns into the correct band and aggregates concepts', () => {
    const result = computeResultFromTurns(
      [
        { prompt: 'A', answer: 'answer', score0to100: 90, conceptId: 'architecture' },
        { prompt: 'B', answer: 'answer', score0to100: 50, conceptBand: 'foundations' },
        { prompt: 'C', answer: 'answer', score0to100: 70, conceptId: 'architecture' },
      ],
      'system-design',
    );

    expect(result).toMatchObject({
      skillId: 'system-design',
      questionCount: 3,
      score0to100: 70, // (90+50+70)/3
      placedBand: 'intermediate',
      strengthConceptIds: ['architecture'], // >=70, deduped
      gapConceptIds: ['foundations'], // <55, falls back to conceptBand
    });
    expect(result.summary).toBe('intermediate placement based on 3 responses.');
    expect(result.assessedAt).toEqual(expect.any(String));
  });

  it('places a high average into the advanced band', () => {
    const result = computeResultFromTurns(
      [
        { prompt: 'A', answer: 'a', score0to100: 85, conceptId: 'x' },
        { prompt: 'B', answer: 'a', score0to100: 95, conceptId: 'y' },
      ],
      'go',
    );
    expect(result.score0to100).toBe(90);
    expect(result.placedBand).toBe('advanced');
    expect(result.strengthConceptIds).toEqual(['x', 'y']);
    expect(result.gapConceptIds).toEqual([]);
  });

  it('places a low average into the foundation band and records gaps', () => {
    const result = computeResultFromTurns(
      [
        { prompt: 'A', answer: 'a', score0to100: 20, conceptId: 'basics' },
        { prompt: 'B', answer: 'a', score0to100: 40, conceptId: 'syntax' },
      ],
      'rust',
    );
    expect(result.score0to100).toBe(30);
    expect(result.placedBand).toBe('foundation');
    expect(result.gapConceptIds).toEqual(['basics', 'syntax']);
    expect(result.strengthConceptIds).toEqual([]);
  });

  it('falls back to the concept band label when a strong turn has no concept id', () => {
    const result = computeResultFromTurns(
      [{ prompt: 'A', answer: 'a', score0to100: 90, conceptBand: 'distributed-systems' }],
      'skill',
    );
    expect(result.strengthConceptIds).toEqual(['distributed-systems']);
  });

  it('ignores scored turns that carry no concept id or band', () => {
    const result = computeResultFromTurns(
      [
        { prompt: 'A', answer: 'a', score0to100: 90 }, // strong but unlabeled
        { prompt: 'B', answer: 'a', score0to100: 10 }, // gap but unlabeled
      ],
      'skill',
    );
    expect(result.strengthConceptIds).toEqual([]);
    expect(result.gapConceptIds).toEqual([]);
  });

  it('uses answer length when turns have not yet been scored (and clamps at 100)', () => {
    const result = computeResultFromTurns([{ prompt: 'A', answer: 'x'.repeat(45) }], 'writing');
    expect(result.score0to100).toBe(90); // 45 chars * 2
    expect(result.placedBand).toBe('advanced');

    const clamped = computeResultFromTurns([{ prompt: 'A', answer: 'x'.repeat(200) }], 'writing');
    expect(clamped.score0to100).toBe(100); // min(100, 400)
  });

  it('averages answer-length scores across multiple unscored turns and trims whitespace', () => {
    const result = computeResultFromTurns(
      [
        { prompt: 'A', answer: '  ' + 'x'.repeat(10) + '  ' }, // trimmed → 10 chars → 20
        { prompt: 'B', answer: 'x'.repeat(30) }, // 60
      ],
      'writing',
    );
    expect(result.score0to100).toBe(40); // (20 + 60) / 2
    expect(result.placedBand).toBe('foundation');
  });

  it('mixes scored and unscored turns using only the scored ones for the score', () => {
    const result = computeResultFromTurns(
      [
        { prompt: 'A', answer: 'x'.repeat(100), score0to100: 60, conceptId: 'a' },
        { prompt: 'B', answer: 'x'.repeat(100) }, // unscored → ignored in score math
      ],
      'skill',
    );
    expect(result.score0to100).toBe(60); // only the scored turn
    expect(result.questionCount).toBe(2);
  });

  it('handles the empty-turn edge and singular summary wording', () => {
    const empty = computeResultFromTurns([], 'skill');
    expect(empty.score0to100).toBe(0);
    expect(empty.placedBand).toBe('foundation');
    expect(empty.summary).toBe('foundation placement based on 0 responses.');

    const single = computeResultFromTurns([{ prompt: 'A', answer: 'x'.repeat(45) }], 'writing');
    expect(single.summary).toBe('advanced placement based on 1 response.');
  });
});

describe('generateAssessmentQuestion', () => {
  it('posts the domain and prior turns to the AI endpoint', async () => {
    mockAI.mockResolvedValue({ prompt: 'Explain X', concept_band: 'core' });
    const turns: AssessmentTurn[] = [{ prompt: 'Q1', answer: 'A1', score0to100: 80 }];

    const out = await generateAssessmentQuestion('system-design', turns);

    expect(mockAI).toHaveBeenCalledWith('generate-assessment-question', {
      domain: 'system-design',
      prior_turns: [{ question: 'Q1', answer: 'A1', score: 80 }],
    });
    expect(out).toEqual({ prompt: 'Explain X', concept_band: 'core' });
  });
});

describe('evaluateAssessmentAnswer', () => {
  it('posts the question/answer with a provided rubric', async () => {
    mockAI.mockResolvedValue({ overall_score: 72 });
    await evaluateAssessmentAnswer('go', { prompt: 'Q', answer: 'A', rubric: [{ name: 'depth', weight: 2 }] });
    expect(mockAI).toHaveBeenCalledWith('evaluate-assessment-answer', {
      domain: 'go',
      question: 'Q',
      answer_text: 'A',
      rubric: [{ name: 'depth', weight: 2 }],
    });
  });

  it('falls back to a default rubric when none is supplied', async () => {
    mockAI.mockResolvedValue({ overall_score: 50 });
    await evaluateAssessmentAnswer('go', { prompt: 'Q', answer: 'A' });
    expect(mockAI).toHaveBeenCalledWith('evaluate-assessment-answer', expect.objectContaining({
      rubric: [{ name: 'response quality', weight: 1 }],
    }));
  });
});

/**
 * The no-AI placement path. A member with neither PRO nor a BYOK key must still
 * be able to place a skill and get a learning plan — these pin that the manual
 * result is a REAL result (feeds buildOfflinePlan) and that it never pretends to
 * be graded.
 */
describe('buildManualAssessmentResult', () => {
  it('spends no AI call at all', () => {
    buildManualAssessmentResult('s1', 'intermediate');
    expect(mockAI).not.toHaveBeenCalled();
  });

  it('maps each band to an ascending mastery and keeps the band verbatim', () => {
    const masteries = ASSESSMENT_BANDS.map(
      band => buildManualAssessmentResult('s1', band).score0to100,
    );
    expect(masteries).toEqual([...masteries].sort((a, b) => a - b));
    expect(new Set(masteries).size).toBe(ASSESSMENT_BANDS.length);
    for (const band of ASSESSMENT_BANDS) {
      expect(buildManualAssessmentResult('s1', band).placedBand).toBe(band);
    }
  });

  it('carries typed focus areas through as gaps so the offline plan has content', () => {
    const result = buildManualAssessmentResult('s1', 'foundation', [
      ' sharding ',
      '',
      'caching',
    ]);
    expect(result.gapConceptIds).toEqual(['sharding', 'caching']);
    expect(result.skillId).toBe('s1');
  });

  it('reports zero questions and labels itself self-assessed, not scored', () => {
    const result = buildManualAssessmentResult('s1', 'advanced');
    expect(result.questionCount).toBe(0);
    expect(result.summary).toContain('self-assessed');
    expect(result.strengthConceptIds).toEqual([]);
  });
});
