// ============================================================================
// LIFE OS — ASSESSMENT DOMAIN PROFILES
// ============================================================================
//
// Server-side registry of assessment domain profiles for the Kaizen Master
// Assessment Motor. The MODEL, PERSONA, RUBRIC, and EVALUATION STYLE for every
// assessment are chosen here on the backend — the iOS client only sends a
// `domain`/`persona` hint and never picks its own scoring rubric.
//
// Seeded content here defines COVERAGE and CALIBRATION (difficulty bands,
// concept areas, rubric anchors), never a fixed pile of question text or
// "correct answers". The motor generates/selects the next prompt from the
// domain profile + context + prior turns. See the plan's "Kaizen Master
// Assessment Motor" section.
// ============================================================================

import type { PersonaId } from './personas';

export type AssessmentDomainId =
  | 'technicalCareer'
  | 'softwareArchitecture'
  | 'iosSwiftUI'
  | 'reactFrontend'
  | 'algorithms'
  | 'behavioralInterview'
  | 'englishCommunication'
  | 'learningFoundations';

/**
 * One assessment domain profile. Mirrors the Swift `AssessmentDomainProfile`
 * shape (id, persona, rubric policy, evaluation style, difficulty bands).
 */
export interface AssessmentDomainProfile {
  id: AssessmentDomainId;
  displayName: string;
  /** Persona that evaluates answers in this domain (server-selected). */
  personaId: PersonaId;
  /** What "good" means in this domain — drives generation + scoring focus. */
  evaluationStyle: string;
  /** The concept areas that define coverage (not fixed question text). */
  conceptAreas: string[];
  /** Named difficulty bands, ascending. Used to anchor difficulty_0_to_100. */
  difficultyBands: string[];
}

const DOMAIN_PROFILES: Record<AssessmentDomainId, AssessmentDomainProfile> = {
  technicalCareer: {
    id: 'technicalCareer',
    displayName: 'Technical Career',
    personaId: 'seniorSoftwareEngineer',
    evaluationStyle:
      'Correctness, depth, trade-offs, debugging instinct, and clarity of technical communication.',
    conceptAreas: [
      'language fundamentals',
      'data structures',
      'concurrency',
      'debugging',
      'testing',
      'trade-off reasoning',
    ],
    difficultyBands: ['intro', 'junior', 'mid', 'senior', 'staff'],
  },
  softwareArchitecture: {
    id: 'softwareArchitecture',
    displayName: 'Software Architecture',
    personaId: 'softwareArchitect',
    evaluationStyle:
      'Requirements clarification, API/data modeling, scaling, reliability, observability, and explicit trade-offs.',
    conceptAreas: [
      'requirements gathering',
      'API design',
      'data modeling',
      'scaling',
      'reliability',
      'observability',
      'trade-offs',
    ],
    difficultyBands: ['junior', 'mid', 'senior', 'staff', 'principal'],
  },
  iosSwiftUI: {
    id: 'iosSwiftUI',
    displayName: 'iOS / SwiftUI',
    personaId: 'seniorSoftwareEngineer',
    evaluationStyle:
      'Swift language depth, SwiftUI mental model, Swift concurrency, app architecture, and testing.',
    conceptAreas: [
      'Swift language',
      'SwiftUI rendering model',
      'state management',
      'Swift concurrency',
      'app architecture',
      'testing',
    ],
    difficultyBands: ['intro', 'junior', 'mid', 'senior'],
  },
  reactFrontend: {
    id: 'reactFrontend',
    displayName: 'React / Frontend',
    personaId: 'seniorSoftwareEngineer',
    evaluationStyle:
      'Components/state/hooks/rendering model, performance, accessibility, and frontend architecture.',
    conceptAreas: [
      'components and props',
      'state and hooks',
      'rendering and reconciliation',
      'performance',
      'accessibility',
      'frontend architecture',
    ],
    difficultyBands: ['intro', 'junior', 'mid', 'senior'],
  },
  algorithms: {
    id: 'algorithms',
    displayName: 'Algorithms & Data Structures',
    personaId: 'codingInterviewer',
    evaluationStyle:
      'Problem decomposition, complexity analysis, edge-case handling, and clear explanation of approach.',
    conceptAreas: [
      'problem decomposition',
      'time/space complexity',
      'data structure selection',
      'edge cases',
      'explanation clarity',
    ],
    difficultyBands: ['easy', 'medium', 'hard', 'expert'],
  },
  behavioralInterview: {
    id: 'behavioralInterview',
    displayName: 'Behavioral Interview',
    personaId: 'hiringManager',
    evaluationStyle:
      'STAR structure, ownership, quantified impact, clarity, and authenticity of the narrative.',
    conceptAreas: [
      'situation framing',
      'ownership',
      'action specificity',
      'quantified impact',
      'reflection and learning',
    ],
    difficultyBands: ['warmup', 'standard', 'leadership', 'executive'],
  },
  englishCommunication: {
    id: 'englishCommunication',
    displayName: 'English Communication',
    personaId: 'englishTeacher',
    evaluationStyle:
      'Grammar, vocabulary range, fluency, speaking/pronunciation habits, and overall clarity.',
    conceptAreas: [
      'grammar',
      'vocabulary',
      'fluency',
      'pronunciation habits',
      'clarity',
    ],
    difficultyBands: ['A2', 'B1', 'B2', 'C1', 'C2'],
  },
  learningFoundations: {
    id: 'learningFoundations',
    displayName: 'Learning Foundations',
    personaId: 'careerCoach',
    evaluationStyle:
      'Building concepts from zero with simple mental models, plain vocabulary, and patient calibration.',
    conceptAreas: [
      'core vocabulary',
      'mental models',
      'first principles',
      'simple examples',
    ],
    difficultyBands: ['zero', 'foundational', 'applied'],
  },
};

const DEFAULT_DOMAIN_ID: AssessmentDomainId = 'technicalCareer';

/**
 * Resolve a domain profile by id (server-side selection). Falls back to
 * `technicalCareer` for any unknown / missing domain so the route never
 * crashes on a bad client hint.
 */
export function resolveDomainProfile(
  domainId: string | undefined | null
): AssessmentDomainProfile {
  const key = (domainId || '').trim() as AssessmentDomainId;
  return DOMAIN_PROFILES[key] || DOMAIN_PROFILES[DEFAULT_DOMAIN_ID];
}
