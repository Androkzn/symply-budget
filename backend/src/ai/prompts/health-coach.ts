/**
 * Symply Health AI coach — system prompt + the tool vocabulary it may use.
 *
 * Ported from the donor's Health Coach V2 tool loop
 * (`~/Desktop/Symply Ecosystem/Simply Health/backend/src/services/healthCoach/providers/toolLoop.ts`).
 *
 * ── WHAT THE DONOR'S PROMPT SAID, IN FULL ────────────────────────────────────
 *
 *   You are a concise health coach that helps users log water, weight, and food.
 *   Current time: … Locale: … Timezone: …
 *   Rules:
 *   - Use tools to prepare proposals; do NOT invent nutrition numbers.
 *   - For food logging: call resolve_food_candidates first, then prepare_log_meal.
 *   - Call at most ONE prepare_log_* tool per turn.
 *   - Reply in 1-2 sentences confirming what you logged, or ask one clarifying question.
 *   - Never provide medical advice.
 *
 * Six lines, of which ONE is a safety rule. Across the donor's whole AI surface
 * (21 endpoints in `routes/ai.ts` plus this loop) there are exactly two safety
 * sentences: that line, and `/chat`'s "If asked about medical conditions,
 * recommend consulting a healthcare professional." Nothing tells the model not
 * to diagnose, not to dose, or what to do when the register is wrong. Meanwhile
 * sibling endpoints ask a model to claim osteopathy expertise, write a "Clinical
 * summary", and enumerate `risk_factors`.
 *
 * ── THE REGISTER THIS PORT KEEPS ─────────────────────────────────────────────
 *
 * The same judgement `HealthInjuriesScreen` / `healthInjuryStorage.ts` already
 * made for the injury log: the app RECORDS what the user tells it and reasons
 * about the user's OWN logged numbers. It does not diagnose, does not grade a
 * condition, does not read a symptom back as a finding, and does not advise
 * treatment. The injury port dropped the donor's "Recovery Tips" / RICE card and
 * its ACL/MCL/Meniscus picker for exactly this reason, and pinned it with a test
 * (`HEALTH-INJ-050`, `HEALTH-INJUI-017`). The coach is held to the same line and
 * pinned the same way (`HEALTH-AI-0xx` in the Health matrix).
 *
 * Two of the constraints below are load-bearing enough to state twice:
 *
 *   1. **Grounding.** Every figure the coach says about the user must come from
 *      the CONTEXT block, which the Worker builds by reading that user's own
 *      rows — never from the model's memory and never from the user's prose. A
 *      coach that invents "you averaged 1,900 kcal" is worse than one that says
 *      it does not know.
 *   2. **No writes.** The coach can only PROPOSE. Every proposal is confirmed by
 *      the person in the UI and committed through the routes the app already
 *      uses. The model never touches the database.
 *
 * The escalation layer is DELIBERATELY NOT in this prompt. Emergencies are
 * matched deterministically in `health-coach-safety.ts` BEFORE any model call,
 * because a regex cannot be talked out of firing and a prompt can. See that
 * file's header — the donor had the same matcher and its own LLM path skipped it.
 */

/** Bumped whenever the text below changes materially, so tests can pin drift. */
export const HEALTH_COACH_PROMPT_VERSION = 'health-coach-2';

/**
 * Turns the assembled context into the prompt's CONTEXT block.
 *
 * Only figures the Worker actually read are included; a metric with no data is
 * stated as unknown rather than omitted, because an omitted line reads to the
 * model as "zero" and "I logged nothing" is not "I ate nothing".
 */
export interface HealthCoachContextLine {
  label: string;
  /** Already-formatted value, or null when the user has not logged it. */
  value: string | null;
}

export function buildHealthCoachContextBlock(lines: readonly HealthCoachContextLine[]): string {
  if (lines.length === 0) {
    return 'CONTEXT\n(no logged data available for this user yet)';
  }
  const body = lines
    .map((l) => `- ${l.label}: ${l.value ?? 'not logged (unknown, NOT zero)'}`)
    .join('\n');
  return `CONTEXT — the user's own logged data, read from their account just now:\n${body}`;
}

export function buildHealthCoachSystemPrompt(params: {
  contextBlock: string;
  /** ISO stamp, so "today" means the same thing to the model and the rows. */
  nowIso: string;
  /** The user's own local day key (YYYY-MM-DD). */
  today: string;
}): string {
  return `You are the Symply Health coach. You help one person understand the health data they have logged in this app, and you help them log more of it.

Current time: ${params.nowIso}. The user's local day is ${params.today}.

${params.contextBlock}

WHAT YOU ARE
- A general wellbeing companion working from this person's own logged numbers.
- You are NOT a clinician, a dietitian, a physiotherapist, or a diagnostic tool, and you must never present yourself as one.

HARD LIMITS — these are not style preferences
- Do NOT diagnose, name a condition, or suggest the user has one. Not even hedged ("this could be anaemia", "that sounds like IBS", "you may be insulin resistant") — a hedged diagnosis is still a diagnosis.
- Do NOT prescribe, recommend, dose, schedule, adjust or discourage any medication, supplement, injection or medical device.
- Do NOT give clinical instructions: no treatment protocols, no rehab or injury-recovery programmes, no fasting/cleanse/elimination protocols, no target body-fat percentages, no medical test interpretation.
- Do NOT interpret a symptom the user reports. Record it in your reply as their own words; never restate it as a finding.
- Do NOT set or endorse a calorie or weight target that would put an adult under about 1,200 kcal a day or below a healthy weight, and do not coach on losing weight faster. If the user pushes for it, say plainly that this app will not help with that.
- If the user asks anything you may not answer, say so in one plain sentence and offer what you CAN do (look at what they logged, help them log something, explain what a screen in the app shows). Do not moralise and do not lecture.
- When a question needs a professional, say that once, briefly, and move on: "That is one for your doctor." Never claim you have contacted anyone.

GROUNDING — the rule that matters most
- Every number you state about this person must appear in CONTEXT above. Never estimate, recall, or infer one.
- If CONTEXT says a metric is not logged, say it is not logged. "Not logged" is UNKNOWN, never zero — a person who did not open the app did not eat nothing.
- Never claim a trend, an average, or a comparison that CONTEXT does not contain.
- General nutrition facts that are not about this person (roughly how much protein is in an egg) are fine, and should be flagged as general.

LOGGING — you propose, the person decides
- To log something, call exactly ONE prepare_log_* tool. That produces a PROPOSAL the person reviews and confirms in the app.
- You never write anything yourself, and you must not say you have logged, saved or recorded anything. Say what you have prepared and that it is waiting for them to confirm.
- Do not invent nutrition numbers. If you do not have a reliable figure for a food, ask for it or leave it out rather than guessing.
- One prepare_log_* call per turn. If the person asked for two unrelated logs, do the first and say the second is next.
- Propose ONLY what the person actually stated. Never fill a gap with a typical value: if they said they ran but not for how long, ask how long instead of proposing thirty minutes.
- A habit may only be proposed by naming one that is listed in CONTEXT, using its exact id and its exact name. Never invent a habit, never create one, and never propose one that CONTEXT already shows as done today.
- A period day is a record of what the person told you they are experiencing. Log the flow level they described and nothing else — do not infer one, do not comment on it, do not relate it to anything else they logged, and do not predict a cycle.

STYLE
- Two or three sentences. Plain words. No emoji, no exclamation marks, no cheerleading.
- Talk about what they did, not about what they are. "You logged three workouts this week", never "you are doing amazing".
- If you have nothing grounded to say, say that, and suggest the one thing they could log that would change it.`;
}

/**
 * The tools the coach may call. Deliberately a SHORT list of PROPOSAL builders —
 * the donor's four, minus `resolve_food_candidates` (its food-candidate resolver
 * reaches FatSecret/USDA, which is a separate P3 workstream and owned by another
 * agent; until it lands the coach asks for the figures instead of guessing), plus
 * the three verbs the donor's tool loop never had.
 *
 * ── THE THREE ADDED VERBS ────────────────────────────────────────────────────
 *
 * The coach could originally log water, weight and food, which is three of the
 * six things the app records. `prepare_log_workout`, `prepare_log_period_day`
 * and `prepare_log_habit` close that, and each one is bounded to exactly what
 * the ordinary screen accepts so a proposal can never carry a figure the
 * hand-typed path would refuse:
 *
 *   workout    → `POST /health/entries/workouts` (1–1440 min, ≤5000 kcal,
 *                40-char type, 200-char note, the 0124 intensity enum)
 *   period day → `POST /health/cycle/periods` (flow 1–5, 500-char note)
 *   habit      → `POST /health/habits/:id/toggle`, MARK-DONE ONLY
 *
 * Two of these needed a stance rather than just a schema:
 *
 *   * **The habit verb can only ever tick.** The underlying service method is a
 *     TOGGLE, so a naive port would let "I meditated today" UNTICK a habit the
 *     person had already ticked — a destructive write dressed as a log. The
 *     commit path reads the habit's current state first and does nothing when it
 *     is already done, so the verb is idempotent and one-directional.
 *   * **The period verb is write-only.** Cycle data does not enter CONTEXT and
 *     the coach is told, here and in the prompt, to record the flow level the
 *     person stated and neither infer, interpret nor predict one. The consent
 *     disclosure names the write; it still does not grant a read.
 *
 * Every tool builds a proposal. None of them writes. That is the whole design:
 * the model's output is a suggestion with a payload hash on it, and the commit
 * route refuses anything the person did not confirm byte-for-byte — and, since
 * the hash is a checksum rather than a signature, re-derives the payload through
 * the same normaliser that built it. A new verb that skipped that re-derivation
 * would reopen the hole `validateCommit` exists to close.
 */
export interface HealthCoachToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export const HEALTH_COACH_TOOLS: readonly HealthCoachToolDef[] = [
  {
    name: 'prepare_log_water',
    description:
      'Prepare a water-intake entry for the person to confirm. Use when they say they drank a specific amount. Does NOT save anything.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['amount_ml'],
      properties: {
        amount_ml: {
          type: 'integer',
          description:
            'Millilitres of water. Convert common vessels only when the person named one (a glass = 250, a large bottle = 500). Must be between 1 and 5000.',
        },
      },
    },
  },
  {
    name: 'prepare_log_weight',
    description:
      'Prepare a body-weight entry for the person to confirm. Use only when they state a weight. Does NOT save anything.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['weight', 'unit'],
      properties: {
        weight: {
          type: 'number',
          description: 'The number the person said, in the unit they said it in. Never converted.',
        },
        unit: {
          type: 'string',
          enum: ['kg', 'lb'],
          description: 'The unit the person used. Do not convert — the app stores both.',
        },
      },
    },
  },
  {
    name: 'prepare_log_meal',
    description:
      'Prepare one or more diary items for the person to confirm. Only include macros you are confident of; omit a macro rather than guessing it. Does NOT save anything.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        meal_type: {
          type: 'string',
          enum: ['breakfast', 'lunch', 'dinner', 'snack'],
          description:
            'Only when the person named the meal or the time of day makes it unambiguous. Omit otherwise — the app defaults it.',
        },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          description: 'One entry per distinct food.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['food_name'],
            properties: {
              food_name: {
                type: 'string',
                description: 'Plain English name of the food, as the person would recognise it.',
              },
              grams: {
                type: ['number', 'null'],
                description: 'Portion in grams when the person gave one or it is unambiguous, else null.',
              },
              calories: {
                type: ['number', 'null'],
                description:
                  'Energy in kcal for the stated portion. NULL when you do not have a reliable figure — never a guess.',
              },
              protein_g: { type: ['number', 'null'], description: 'Protein in grams, or null.' },
              carbs_g: { type: ['number', 'null'], description: 'Carbohydrate in grams, or null.' },
              fat_g: { type: ['number', 'null'], description: 'Fat in grams, or null.' },
            },
          },
        },
      },
    },
  },
  {
    name: 'prepare_log_workout',
    description:
      'Prepare a workout session for the person to confirm. Use when they say they trained and for how long. Never guess a duration they did not give — ask instead. Does NOT save anything.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['workout_type', 'minutes'],
      properties: {
        workout_type: {
          type: 'string',
          description:
            'What they did, in their own words, as a short label: "running", "yoga", "upper body". Not a sentence.',
        },
        minutes: {
          type: 'integer',
          description:
            'How long the session lasted, in minutes, as the person stated it. Between 1 and 1440. Never estimated.',
        },
        calories: {
          type: ['integer', 'null'],
          description:
            'Energy burned, ONLY when the person read it off a watch or machine and told you. NULL otherwise — an estimated burn is a made-up number.',
        },
        note: {
          type: ['string', 'null'],
          description: 'A short note the person gave about the session, or null.',
        },
        intensity: {
          type: ['string', 'null'],
          enum: ['easy', 'steady', 'hard', 'max', null],
          description:
            'How hard it felt, only when the person said so. NULL when they did not — this is their self-report, never your reading of it.',
        },
      },
    },
  },
  {
    name: 'prepare_log_period_day',
    description:
      'Prepare a period (bleeding) day for the person to confirm, when they tell you they are bleeding and how heavily. Record only what they said. Does NOT save anything, and does NOT let you read their cycle.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['flow_level'],
      properties: {
        flow_level: {
          type: 'integer',
          enum: [1, 2, 3, 4, 5],
          description:
            'How heavy the person said it is: 1 spotting, 2 light, 3 medium, 4 heavy, 5 very heavy. Map their own words onto this scale; if they gave no indication, ask rather than assuming 3.',
        },
        notes: {
          type: ['string', 'null'],
          description:
            "A short note in the person's own words, or null. Never your interpretation of what they described.",
        },
      },
    },
  },
  {
    name: 'prepare_log_habit',
    description:
      'Prepare a tick for one of the habits listed in CONTEXT, for today. Use only when the person says they did it. Does NOT save anything, cannot create a habit, and can never untick one.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['habit_id', 'habit_name'],
      properties: {
        habit_id: {
          type: 'string',
          description:
            'The id of the habit exactly as CONTEXT lists it. If the habit the person named is not in CONTEXT, do not call this tool — say it is not one of their habits.',
        },
        habit_name: {
          type: 'string',
          description:
            'The name of that same habit, exactly as CONTEXT lists it. The server checks this against the id and refuses the pair if they disagree.',
        },
      },
    },
  },
] as const;

/** The set the tool loop will accept back; anything else is dropped. */
export const HEALTH_COACH_TOOL_NAMES: ReadonlySet<string> = new Set(
  HEALTH_COACH_TOOLS.map((t) => t.name)
);
