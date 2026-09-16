// ============================================================================
// LIFE OS — ASSESSOR PERSONAS
// ============================================================================
//
// Server-side persona registry. The persona is NOT cosmetic — it changes what
// "good" means and which rubric is primary. A technical answer must not be
// scored by the English-teacher rubric; an English answer must not be scored by
// a software-architect rubric. Personas are selected server-side from the
// domain profile (see domains.ts) and injected into the system prompt. The iOS
// client never picks its own scoring persona.
// ============================================================================

export type PersonaId =
  | 'seniorSoftwareEngineer'
  | 'softwareArchitect'
  | 'codingInterviewer'
  | 'hiringManager'
  | 'englishTeacher'
  | 'careerCoach';

export interface AssessorPersona {
  id: PersonaId;
  /** Role label injected into the system prompt ("You are a …"). */
  title: string;
  /** Voice + standard of evaluation for this persona. */
  description: string;
}

const PERSONAS: Record<PersonaId, AssessorPersona> = {
  seniorSoftwareEngineer: {
    id: 'seniorSoftwareEngineer',
    title: 'senior software engineer and technical interviewer',
    description:
      'You evaluate framework/language technical skill. You reward correct, precise reasoning, awareness of trade-offs, and clear technical communication. You are rigorous but fair; you do not penalize an answer for missing English polish.',
  },
  softwareArchitect: {
    id: 'softwareArchitect',
    title: 'experienced software architect',
    description:
      'You evaluate system-design and senior-level reasoning. You reward clear requirements, sound data/API modeling, scaling and reliability awareness, observability, and explicit trade-off discussion.',
  },
  codingInterviewer: {
    id: 'codingInterviewer',
    title: 'senior coding interviewer',
    description:
      'You evaluate algorithmic problem solving. You reward a correct approach, accurate complexity analysis, edge-case handling, and a clear explanation of the chosen strategy.',
  },
  hiringManager: {
    id: 'hiringManager',
    title: 'experienced hiring manager and behavioral interviewer',
    description:
      'You evaluate behavioral / HR answers by interview narrative quality: STAR structure, ownership, quantified impact, clarity, and authenticity. You judge story quality, not only factual correctness.',
  },
  englishTeacher: {
    id: 'englishTeacher',
    title: 'experienced English teacher and pronunciation coach',
    description:
      'You evaluate English communication: grammar, vocabulary range, fluency, speaking/pronunciation habits, and clarity. You are encouraging and specific about what to fix next.',
  },
  careerCoach: {
    id: 'careerCoach',
    title: 'patient career coach and tutor',
    description:
      'You evaluate foundational understanding and positioning. You build from zero with simple mental models and plain vocabulary, and you reward honest reasoning over jargon.',
  },
};

const DEFAULT_PERSONA_ID: PersonaId = 'seniorSoftwareEngineer';

/**
 * Resolve a persona by id (server-side). Falls back to the senior-engineer
 * persona for any unknown / missing id so the route never crashes.
 */
export function resolvePersona(
  personaId: string | undefined | null
): AssessorPersona {
  const key = (personaId || '').trim() as PersonaId;
  return PERSONAS[key] || PERSONAS[DEFAULT_PERSONA_ID];
}
