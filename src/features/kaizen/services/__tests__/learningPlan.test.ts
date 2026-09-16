import { postKaizenAI } from '../../api/kaizen';
import {
  buildOfflinePlan,
  buildSkillLearningPlan,
  getCompletedLearningTaskIds,
  getCompletedLearningTaskKeys,
  isLearningTaskComplete,
  learningTaskKey,
  setCompletedLearningTaskIds,
  setCompletedLearningTaskKeys,
  toggleLearningTaskComplete,
} from '../learningPlan';
import type { SkillAssessmentResult } from '../skillAssessment';


const store: Record<string, string> = {};
jest.mock('../storage', () => ({
  storageHelpers: {
    getString: jest.fn((k: string) => store[k] ?? null),
    setString: jest.fn((k: string, v: string) => {
      store[k] = v;
    }),
    remove: jest.fn((k: string) => {
      delete store[k];
    }),
  },
}));

jest.mock('../../api/kaizen', () => ({ postKaizenAI: jest.fn() }));

const mockAI = postKaizenAI as jest.Mock;

function result(over: Partial<SkillAssessmentResult> = {}): SkillAssessmentResult {
  return {
    skillId: 'react',
    assessedAt: '2026-07-10T00:00:00.000Z',
    questionCount: 3,
    score0to100: 65,
    placedBand: 'intermediate',
    strengthConceptIds: ['hooks'],
    gapConceptIds: ['concurrency'],
    summary: 'intermediate placement based on 3 responses.',
    ...over,
  };
}

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  jest.clearAllMocks();
});

describe('learningTaskKey + completion toggling', () => {
  it('builds a stable kind::title key', () => {
    expect(learningTaskKey('concept', 'Closures')).toBe('concept::Closures');
  });

  it('toggles a task complete then incomplete and persists keys', () => {
    expect(isLearningTaskComplete('react', 'practice', 'Recursion')).toBe(false);

    expect(toggleLearningTaskComplete('react', 'practice', 'Recursion')).toBe(true);
    expect(isLearningTaskComplete('react', 'practice', 'Recursion')).toBe(true);
    expect(getCompletedLearningTaskKeys('react')).toEqual(['practice::Recursion']);

    expect(toggleLearningTaskComplete('react', 'practice', 'Recursion')).toBe(false);
    expect(isLearningTaskComplete('react', 'practice', 'Recursion')).toBe(false);
  });

  it('scopes completed keys per skill', () => {
    setCompletedLearningTaskKeys('react', ['concept::A']);
    setCompletedLearningTaskKeys('go', ['concept::B']);
    expect(getCompletedLearningTaskKeys('react')).toEqual(['concept::A']);
    expect(getCompletedLearningTaskKeys('go')).toEqual(['concept::B']);
  });

  it('returns an empty list for corrupt storage', () => {
    store['kaizen.learningplan.completed.react'] = '{not an array';
    expect(getCompletedLearningTaskKeys('react')).toEqual([]);
  });

  it('returns an empty list when storage holds a non-array JSON value', () => {
    store['kaizen.learningplan.completed.react'] = '{"a":1}';
    expect(getCompletedLearningTaskKeys('react')).toEqual([]);
  });

  it('exposes deprecated id aliases that delegate to the key store', () => {
    setCompletedLearningTaskIds('react', ['concept::Legacy']);
    expect(getCompletedLearningTaskIds('react')).toEqual(['concept::Legacy']);
    expect(getCompletedLearningTaskKeys('react')).toEqual(['concept::Legacy']);
  });
});

describe('buildOfflinePlan', () => {
  it('sequences gaps first, then strengths, with a shorter reassessment when weak', () => {
    const plan = buildOfflinePlan(result({ score0to100: 50 }));
    expect(plan.concept_sequence).toEqual(['concurrency', 'hooks']);
    expect(plan.practice_queue).toEqual(['Practice concurrency']);
    expect(plan.review_focus).toEqual(['hooks']);
    expect(plan.reassessment_in_days).toBe(14);
  });

  it('uses generic fallbacks when there are no gaps/strengths and a longer window when strong', () => {
    const plan = buildOfflinePlan(result({ score0to100: 85, gapConceptIds: [], strengthConceptIds: [] }));
    expect(plan.concept_sequence).toEqual(['core concepts', 'applied practice']);
    expect(plan.review_focus).toEqual(['Explain your approach out loud']);
    expect(plan.reassessment_in_days).toBe(21);
  });
});

describe('buildSkillLearningPlan', () => {
  it('returns the AI plan on success', async () => {
    const aiPlan = { concept_sequence: ['a'], practice_queue: ['b'], review_focus: ['c'], reassessment_in_days: 30 };
    mockAI.mockResolvedValue(aiPlan);

    const plan = await buildSkillLearningPlan('react', result());
    expect(mockAI).toHaveBeenCalledWith('build-skill-learning-plan', expect.objectContaining({
      skill: 'react',
      placement_band: 'intermediate',
      mastery_0_to_100: 65,
    }));
    expect(plan).toBe(aiPlan);
  });

  it('falls back to the offline plan when the AI call fails', async () => {
    mockAI.mockRejectedValue(new Error('ai down'));
    const plan = await buildSkillLearningPlan('react', result());
    expect(plan).toEqual(buildOfflinePlan(result()));
  });
});
