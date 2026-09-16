/**
 * Medical-escalation matcher for the Symply Health coach.
 *
 * Ported from the donor's
 * `~/Desktop/Symply Ecosystem/Simply Health/backend/src/services/healthCoach/safety/escalation.ts`.
 *
 * ── WHY THIS IS A REGEX AND NOT A PROMPT ─────────────────────────────────────
 *
 * This is the entire clinical-safety layer, and it is deliberately DETERMINISTIC.
 * A prompt instruction can be argued with, out-competed by a later instruction,
 * or simply not followed on a bad sample; a regex cannot. The donor reached the
 * same conclusion and shipped the same design.
 *
 * ── THE DONOR BUG THIS PORT FIXES ────────────────────────────────────────────
 *
 * In the donor, `matchEscalation()` runs inside `turnProcessor.ts` — the
 * DETERMINISTIC fallback path. The LLM tool-loop path (`toolLoop.ts`) is tried
 * FIRST and, when a provider key is configured, returns without ever calling the
 * matcher. So on every account that actually has AI working, the donor's
 * emergency layer never runs: "I'm having chest pain and I can't breathe" goes
 * straight to a model whose only guardrail is the prompt line
 * `- Never provide medical advice.`
 *
 * Here the matcher runs FIRST, on every turn, before entitlement is even
 * resolved and before any token leaves the Worker. A matched turn costs nothing,
 * calls no model, and returns the escalation text. `HEALTH-AI-014` pins that no
 * provider call is made on a matched turn.
 *
 * ── WHAT THE MESSAGES MAY AND MAY NOT SAY ────────────────────────────────────
 *
 * Every message carries `claims_help_contacted: false` and says so out loud
 * ("I cannot reach them for you"). That sentence is not padding: an app that
 * leaves a person believing help is on the way is more dangerous than one that
 * says nothing. The donor got this right and the wording is kept close to its
 * original. Nothing here diagnoses — "chest pain can be serious" is a reason to
 * seek care, not a finding.
 *
 * ── DELIBERATE DIFFERENCES FROM THE DONOR ────────────────────────────────────
 *
 *   * **English only.** The donor's patterns and copy are bilingual EN/RU. This
 *     app ships English copy — the same call `0123_health_exercise_library.sql`
 *     made when it dropped `name_ru`. Adding a language here means adding both
 *     its patterns AND its copy in one commit; a translated message behind an
 *     English-only pattern would be worse than not shipping it.
 *   * **Word-boundary anchors everywhere.** Several donor patterns are bare
 *     substrings, so "I want to die down the stairs less often" and a food
 *     called "overdose" both trip them. Anchoring costs nothing and a false
 *     positive here is a real cost: it replaces the person's answer with an
 *     emergency notice.
 *   * **`assertAdultOnly` is not ported.** The donor refuses a turn when age is
 *     unknown or under 18. This platform stores no date of birth, so porting it
 *     would refuse every turn for every user — a gate that always fires is not
 *     a gate. Recorded as an open item rather than faked.
 */

/** The donor's eleven categories, verbatim. */
export type EscalationCategory =
  | 'immediate_danger'
  | 'suicide_self_harm'
  | 'chest_pain'
  | 'stroke_signs'
  | 'breathing_difficulty'
  | 'anaphylaxis'
  | 'severe_bleeding'
  | 'poisoning_overdose'
  | 'severe_glucose'
  | 'pregnancy_red_flag'
  | 'medication_overdose';

export interface EscalationMatch {
  category: EscalationCategory;
  message: string;
  /**
   * ALWAYS false, and stated in the copy too. The app has not called anyone and
   * must never imply that it has.
   */
  claims_help_contacted: false;
  /** ALWAYS false — this surface does not ask for or transmit a location. */
  collect_location: false;
}

interface Rule {
  category: EscalationCategory;
  pattern: RegExp;
  message: string;
}

/**
 * Order matters: the first match wins, so the most acute categories are listed
 * first. "I took all my pills and I want to die" must escalate as self-harm, not
 * as a medication question.
 */
const RULES: readonly Rule[] = [
  {
    category: 'suicide_self_harm',
    pattern:
      /\b(kill myself|killing myself|end my life|ending my life|take my own life|suicide|suicidal|want to die|wanna die|self[- ]harm|self harming|cut myself|cutting myself|hurt myself)\b/i,
    message:
      'Your safety matters. Please contact your local emergency services or a crisis line now. I cannot reach them for you.',
  },
  {
    category: 'immediate_danger',
    pattern:
      /\b(i(?:'m| am) in danger|someone is (?:hurting|attacking|threatening) me|being attacked|call (?:911|999|112|emergency))\b/i,
    message:
      'If you are in danger, contact your local emergency services now. I cannot contact them for you.',
  },
  {
    category: 'chest_pain',
    pattern:
      /\b(chest pain|pain in my chest|chest tightness|tightness in my chest|crushing chest|heart attack|cardiac arrest)\b/i,
    message:
      'Chest pain can be serious. Please seek emergency medical care now. I have not contacted anyone on your behalf.',
  },
  {
    category: 'stroke_signs',
    pattern:
      /\b(stroke|face (?:is )?drooping|slurred speech|can'?t speak properly|sudden numbness|numb on one side|weakness on one side|one side of my (?:face|body) )\b/i,
    message:
      'Those can be signs of a stroke, which needs emergency care immediately. Please call emergency services. I cannot call them for you.',
  },
  {
    category: 'breathing_difficulty',
    pattern:
      /\b(can'?t breathe|cannot breathe|trouble breathing|difficulty breathing|struggling to breathe|gasping for air|choking|suffocating)\b/i,
    message:
      'Trouble breathing needs emergency care now. Please call emergency services. I cannot call them for you.',
  },
  {
    category: 'anaphylaxis',
    pattern:
      /\b(anaphylaxis|anaphylactic|throat (?:is )?closing|tongue (?:is )?swelling|severe allergic reaction|epipen|epi[- ]pen)\b/i,
    message:
      'That may be a severe allergic reaction. Use your emergency medication if you have been prescribed one and call emergency services now. I cannot contact them for you.',
  },
  {
    category: 'severe_bleeding',
    pattern:
      /\b(bleeding heavily|heavy bleeding|won'?t stop bleeding|will not stop bleeding|bleeding a lot|severe bleeding|haemorrhag\w*|hemorrhag\w*)\b/i,
    message:
      'Bleeding that will not stop needs emergency care now. Please call emergency services. I cannot call them for you.',
  },
  {
    category: 'poisoning_overdose',
    pattern:
      /\b(poisoned|poisoning|swallowed (?:bleach|poison|chemicals)|drank (?:bleach|poison)|carbon monoxide)\b/i,
    message:
      'Suspected poisoning needs urgent help. Please contact emergency services or a poison control line now. I cannot contact them for you.',
  },
  {
    category: 'medication_overdose',
    pattern:
      /\b(overdose|overdosed|took too (?:many|much) (?:pills|tablets|medication)|too many pills)\b/i,
    message:
      'Taking too much of a medication can be dangerous. Please contact emergency services or a poison control line now. I cannot contact them for you.',
  },
  {
    category: 'severe_glucose',
    pattern:
      /\b(hypoglycemi\w*|hypoglycaemi\w*|hyperglycemi\w*|hyperglycaemi\w*|diabetic ketoacidosis|\bdka\b|blood sugar (?:is )?(?:crashing|dangerously|way too))\b/i,
    message:
      'A blood-sugar emergency needs urgent medical care. Please follow the plan your care team gave you and contact emergency services. I cannot contact them for you.',
  },
  {
    category: 'pregnancy_red_flag',
    pattern:
      /\b(pregnant and (?:bleeding|cramping|in pain)|bleeding while pregnant|contractions|water broke|waters broke|preeclampsia|pre[- ]eclampsia)\b/i,
    message:
      'Please contact your maternity service or emergency services about that now. I cannot contact them for you.',
  },
] as const;

/**
 * The FIRST rule whose pattern appears in `text`, or null.
 *
 * Pure and I/O-free, so it is fully unit-testable without any AI call — the same
 * property `ai/media-type.ts` was built for.
 */
export function matchEscalation(text: string | null | undefined): EscalationMatch | null {
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return {
        category: rule.category,
        message: rule.message,
        claims_help_contacted: false,
        collect_location: false,
      };
    }
  }
  return null;
}

/** Exposed so a test can prove every category is reachable and none is orphaned. */
export const ESCALATION_CATEGORIES: readonly EscalationCategory[] = RULES.map((r) => r.category);
