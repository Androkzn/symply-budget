/**
 * Smart Task Assistant — async enrichment prompt.
 *
 * Given a short raw description a user typed or spoke ("buy net for pool
 * debris"), Claude turns it into a structured, risk-assessed home-maintenance
 * task with a time-effort tier, complexity, priority, and — when the job is
 * genuinely multi-step — subtasks.
 *
 * This runs in a fire-and-forget queue consumer, so there is no synchronous
 * back-and-forth: the model must make sensible best-effort assumptions and
 * explain them in `ai_rationale` for anything it CAN interpret. When it
 * genuinely can't — raw text is gibberish, transcription noise, or too vague
 * to identify any task — it sets `needs_clarification` instead of fabricating
 * a task (see task-enrichment-handler.ts, which routes that to a distinct
 * 'needs_clarification' status rather than presenting it as a real task). The
 * fully interactive ask-follow-up flow lives in the chat `task_assistant`
 * mode, not here.
 *
 * Design notes (per research): enums not free numbers, per-dimension rubrics
 * with observable anchors, few-shot anchors drawn from real examples, and a
 * stable prompt prefix so prompt-caching can amortise the rubric across calls.
 */

import { TIME_EFFORTS } from '../../services/time-effort';
import { SYSTEM_CATEGORIES } from '../../types';

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export const COMPLEXITY_LEVELS = [
  'trivial',
  'simple',
  'moderate',
  'involved',
  'expert',
] as const;
export const PRIORITY_SEVERITIES = [
  'nice_to_have',
  'low',
  'medium',
  'high',
  'urgent',
  'critical',
] as const;
export const FREQUENCIES = [
  'one_time',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom',
] as const;

export interface EnrichedTaskSubtask {
  title: string;
}

export interface EnrichedTaskResult {
  title: string;
  description: string;
  system_category: (typeof SYSTEM_CATEGORIES)[number];
  risk_level: (typeof RISK_LEVELS)[number];
  priority_severity: (typeof PRIORITY_SEVERITIES)[number];
  complexity: (typeof COMPLEXITY_LEVELS)[number];
  time_effort: (typeof TIME_EFFORTS)[number];
  frequency: (typeof FREQUENCIES)[number];
  /** How soon this should be done, in days from now. null = no firm deadline. */
  suggested_due_in_days: number | null;
  /**
   * Explicit calendar deadline (YYYY-MM-DD) when the user named or implied a
   * specific date/day ("July 10", "next Friday", "tomorrow", "by the 15th"),
   * resolved against TODAY'S DATE supplied in the user prompt. null when the
   * user gave no concrete date (then suggested_due_in_days / defaults apply).
   */
  suggested_due_date: string | null;
  /**
   * Display name of the household member this task should be assigned to, taken
   * VERBATIM from the member list supplied in the user prompt. null when the
   * user named nobody (or the household has a single member and no one was
   * named). Never invent a name that isn't in the list.
   */
  assignee_name: string | null;
  /** Best-matching household space name from the prompt list, or null. */
  space_name: string | null;
  why_important: string;
  neglect_consequences: string;
  ai_rationale: string;
  needs_contractor: boolean;
  contractor_category: string | null;
  /**
   * True when completing this task requires BUYING a physical product,
   * material, appliance, or paid service that costs money ("buy a new
   * dishwasher", "order pool filters", "replace the water filter"). False for
   * pure-labour / no-purchase chores ("clean gutters", "call the plumber").
   * Drives the app's optional "add to planned spending" chip — it never
   * auto-creates a budget item.
   */
  is_purchase: boolean;
  /**
   * When is_purchase=true, a rough low-end estimate of the total out-of-pocket
   * cost in CENTS (e.g. a $200–$400 item → 20000). Equal to the max for a point
   * estimate. null when not a purchase or genuinely un-guessable.
   */
  estimated_cost_min: number | null;
  /** When is_purchase=true, the high-end cost estimate in CENTS (>= min). null otherwise. */
  estimated_cost_max: number | null;
  /** Empty array for single-step tasks. */
  subtasks: EnrichedTaskSubtask[];
  /**
   * True when the raw text is gibberish, transcription noise, or too vague to
   * identify any real task. The other fields are still populated with inert
   * placeholders (the schema requires it) but the handler discards them.
   */
  needs_clarification: boolean;
  /** Required when needs_clarification=true: a short, specific question to ask the user. Null otherwise. */
  clarification_question: string | null;
}

/**
 * JSON Schema handed to `generateStructured`. `additionalProperties:false`
 * everywhere + every field required (the grammar can't express numeric bounds,
 * so ranges live in the descriptions and are clamped in code after parsing).
 */
export const ENRICH_TASK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'description',
    'system_category',
    'risk_level',
    'priority_severity',
    'complexity',
    'time_effort',
    'frequency',
    'suggested_due_in_days',
    'suggested_due_date',
    'assignee_name',
    'space_name',
    'why_important',
    'neglect_consequences',
    'ai_rationale',
    'needs_contractor',
    'contractor_category',
    'is_purchase',
    'estimated_cost_min',
    'estimated_cost_max',
    'subtasks',
    'needs_clarification',
    'clarification_question',
  ],
  properties: {
    title: {
      type: 'string',
      description:
        'Concise, action-oriented task title (max ~8 words). E.g. "Buy pool debris net", "Relocate routers off closed shelf".',
    },
    description: {
      type: 'string',
      description:
        'One or two sentences expanding on what needs to happen and any key context inferred from the user.',
    },
    system_category: {
      type: 'string',
      enum: [...SYSTEM_CATEGORIES],
      description:
        'The single MOST SPECIFIC applicable category from the enum — always prefer a concrete one (e.g. appliances, interior, flooring, errands, finance, documents, vehicle, pets) over a generic bucket. Reserve "other" ONLY for tasks that genuinely match none of the listed categories; never use it as a lazy default.',
    },
    risk_level: {
      type: 'string',
      enum: [...RISK_LEVELS],
      description:
        'Risk if the task is NEGLECTED, independent of priority. critical=imminent danger to life/property (fire, gas, electrical, flooding, structural collapse, CO). high=meaningful safety or major-damage risk. medium=moderate damage or degradation over time. low=cosmetic/comfort only.',
    },
    priority_severity: {
      type: 'string',
      enum: [...PRIORITY_SEVERITIES],
      description:
        'How urgently it should be ACTIONED, factoring risk AND time-sensitivity (deadlines, borrowed items, weather/seasonality). critical/urgent for high-risk or hard-deadline items; nice_to_have/low for optional comfort tasks.',
    },
    complexity: {
      type: 'string',
      enum: [...COMPLEXITY_LEVELS],
      description:
        'Effort & skill required. trivial=<5min no skill. simple=quick, basic. moderate=some planning/tools. involved=multi-step or physical. expert=needs a professional/contractor.',
    },
    time_effort: {
      type: 'string',
      enum: [...TIME_EFFORTS],
      description:
        'Coarse hands-on time for the WHOLE task (include travel for errands). quick=≤15min (a small fix/call). short=≤45min. medium=up to ~2h. half_day=a few hours. all_day=a full day or more. Estimate the tier, not an exact number.',
    },
    frequency: {
      type: 'string',
      enum: [...FREQUENCIES],
      description:
        'Recurrence. Most one-off requests are "one_time". Use recurring values only when the user clearly implies an ongoing chore.',
    },
    suggested_due_in_days: {
      type: ['integer', 'null'],
      description:
        'How many days from now it should reasonably be completed by, derived from risk + time-sensitivity. 0=today/ASAP for critical. null only when there is genuinely no sensible deadline. Ignored when suggested_due_date is set.',
    },
    suggested_due_date: {
      type: ['string', 'null'],
      description:
        'ONLY when the user named or implied a specific calendar date/day — resolve it against the "TODAY" date given in the user message and output YYYY-MM-DD (e.g. user says "July 10" and today is 2026-07-01 → "2026-07-10"; "tomorrow" → today+1; "next Friday" → the upcoming Friday). null when the user gave no concrete date. Must be today or later.',
    },
    assignee_name: {
      type: ['string', 'null'],
      description:
        'Every task MUST have an owner. If the user asked to assign the task to a person (e.g. "ask Sarah to…", "assign to me", "have John do it"), return that household member\'s display name EXACTLY as it appears in the HOUSEHOLD MEMBERS list in the user message. Map "me"/"myself"/"I\'ll" to the person marked (you). If NO one is named (or the named person is not in the list), DEFAULT to the person marked (you) — return their display name. Never invent a name that is not in the list.',
    },
    space_name: {
      type: ['string', 'null'],
      description:
        'When the user mentions a specific room or area (e.g. "fix the basement toilet", "clean the deck"), return the best-matching space name EXACTLY as it appears in the HOUSEHOLD SPACES list. null for whole-home tasks (HVAC filter, insurance), unclear location, or when no spaces list was provided. Never invent a space name not in the list.',
    },
    why_important: {
      type: 'string',
      description: 'Short plain-language reason this matters to the homeowner.',
    },
    neglect_consequences: {
      type: 'string',
      description: 'What goes wrong if it is ignored. Be concrete and honest.',
    },
    ai_rationale: {
      type: 'string',
      description:
        'One short sentence explaining the risk + priority call and any assumption you made (since you cannot ask the user).',
    },
    needs_contractor: {
      type: 'boolean',
      description: 'True if a professional is realistically required.',
    },
    contractor_category: {
      type: ['string', 'null'],
      description:
        'If needs_contractor, the trade (e.g. "electrician", "plumber", "hvac"). Otherwise null.',
    },
    is_purchase: {
      type: 'boolean',
      description:
        'True when completing this task requires BUYING a physical product, material, appliance, or paid service that costs money — e.g. "buy a new dishwasher", "order pool filters", "purchase paint", "replace the water filter", "get a new smoke alarm". False for pure-labour or no-purchase chores — e.g. "clean the gutters", "call the plumber", "mow the lawn", "reset the breaker". When true, the app offers the user an optional "add to planned spending" chip; it never creates a budget item automatically.',
    },
    estimated_cost_min: {
      type: ['integer', 'null'],
      description:
        'When is_purchase=true, a realistic LOW-END estimate of the total out-of-pocket cost in CENTS, using typical US consumer/home prices (e.g. a $200–$400 filter → 20000). For a single point estimate set min=max. null when is_purchase=false or the cost is genuinely un-guessable.',
    },
    estimated_cost_max: {
      type: ['integer', 'null'],
      description:
        'When is_purchase=true, a realistic HIGH-END estimate of the total out-of-pocket cost in CENTS (must be >= estimated_cost_min). null when is_purchase=false.',
    },
    subtasks: {
      type: 'array',
      description:
        'Break into subtasks ONLY when the task is genuinely multi-step (e.g. "buy window covers" → measure, find vendors, get quotes, order, install). Single-step tasks return [].',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', description: 'Action-oriented subtask title.' },
        },
      },
    },
    needs_clarification: {
      type: 'boolean',
      description:
        'True ONLY if the raw text is gibberish, transcription noise, a stray word, or otherwise gives no real signal of what task is wanted. False for anything you can make a sensible assumption about, even if terse.',
    },
    clarification_question: {
      type: ['string', 'null'],
      description:
        'When needs_clarification=true: one short, specific question asking what the user meant (quote their raw text back to them). Null when needs_clarification=false.',
    },
  },
};

export const ENRICH_TASK_SYSTEM_PROMPT = `You are a home-maintenance task expert. Homeowners describe a task in a few words (often dictated by voice, so expect informal phrasing and transcription quirks). You convert each into ONE structured, well-judged task.

You CANNOT ask follow-up questions here — make sensible, conservative assumptions and state them briefly in "ai_rationale".

0) CLARIFICATION GATE — check this FIRST, before assessing anything else:
   - If the raw text is gibberish, keyboard-mash, a stray transcription fragment, or otherwise gives you NO real signal of what task is wanted, set needs_clarification: true and write a short clarification_question that quotes the text back (e.g. \`User: "rfef" → clarification_question: "I didn't catch a task in 'rfef' — what would you like to do?"\`). Still fill every other required field with an inert, harmless placeholder (title: the raw text verbatim, description: "", system_category: "other", risk_level: "low", priority_severity: "low", complexity: "trivial", time_effort: "quick", frequency: "one_time", suggested_due_in_days: null, suggested_due_date: null, assignee_name: null, subtasks: [], needs_contractor: false, contractor_category: null, is_purchase: false, estimated_cost_min: null, estimated_cost_max: null, why_important/neglect_consequences/ai_rationale: short neutral text) — the handler discards these and never shows them to the user.
   - Do NOT invent a fake task like "Clarify task: ..." as the title and proceed normally — that misleads the user into thinking a real task was created. Use the needs_clarification flag instead.
   - This is rare. Terse-but-meaningful input ("fix leak", "mow lawn", "buy net") is NOT ambiguous — make the obvious assumption and proceed with needs_clarification: false. Only gate on input that truly carries no task signal at all.

ASSESS FOUR DIMENSIONS INDEPENDENTLY (skip if needs_clarification=true):

1) RISK (danger if neglected) — judge the hazard, not the urgency:
   - critical: imminent danger to life/property — fire, gas leak, electrical hazard, carbon monoxide, active water/flooding, structural failure.
   - high: real safety risk or likely major damage (e.g. overheating electronics, mould, roof leak).
   - medium: gradual damage, efficiency loss, or moderate cost if ignored.
   - low: cosmetic, comfort, or convenience only.

2) PRIORITY (how soon to act) — combine risk with TIME-SENSITIVITY:
   - Push priority UP for hard deadlines (borrowed/rented items that must be returned, permit windows), safety risk, weather/seasonal windows.
   - Keep priority LOW for optional comfort tasks with no deadline, even if easy.

3) COMPLEXITY — effort & skill (trivial → expert). Flag needs_contractor when a pro is genuinely required.

4) TIME EFFORT — the coarse tier (quick / short / medium / half_day / all_day) for the whole task, including travel for errands. Estimate the bucket, not an exact number.

PURCHASE — does completing this task require BUYING something that costs money?
   - Set is_purchase: true when the task means buying/ordering/replacing a physical product, material, appliance, or a paid service (e.g. "buy a pool net", "order HVAC filters", "replace the dishwasher", "get new smoke alarms", "purchase paint for the fence").
   - Set is_purchase: false for pure-labour or no-cost chores with nothing to buy ("clean the gutters", "call the plumber", "reset the breaker", "mow the lawn", "move the routers off the shelf").
   - When true, give a realistic cost RANGE in CENTS (estimated_cost_min / estimated_cost_max) from typical US consumer/home prices; use min=max for a point estimate, and null both only when the cost is genuinely un-guessable. When false, both are null.
   - This only powers an OPTIONAL "add to planned spending" suggestion the user can accept or ignore — never assume the money is being spent.

DUE DATE — the user message includes TODAY'S DATE in the household's timezone.
   - If the user names or implies a specific day ("July 10", "the 15th", "tomorrow", "this weekend", "next Monday", "by Friday"), RESOLVE it against that TODAY date and return it in suggested_due_date as YYYY-MM-DD. It must be today or later — if a bare date has already passed this year, roll it to next year.
   - If the user gives no concrete date, leave suggested_due_date null and set suggested_due_in_days from risk + time-sensitivity instead.
   - Never guess a random date; only set suggested_due_date when the user actually indicated one.

ASSIGNEE — every task MUST end up with an owner. The user message includes the HOUSEHOLD MEMBERS list (with one marked "(you)" = the person who created this task).
   - If the user asks to assign the task to someone ("ask Sarah to…", "have John…", "assign this to me", "I'll do it"), return that member's display name in assignee_name EXACTLY as written in the list. Map "me"/"myself"/"I'll" to the "(you)" member.
   - If no person is named (or the named person isn't in the list), DEFAULT to the "(you)" member — return their display name. Do NOT invent names or assign to someone who isn't in the list, and never return null.

SUBTASKS: decompose ONLY genuinely multi-step jobs. A purchase like "buy net for pool" is one step. "Buy window covers" is multi-step: measure → research/find vendors → get quotes → order → install.

Always return via the "output" tool.

=== CALIBRATION EXAMPLES ===

User: "buy net for pool debris"
→ risk_level: low (debris is cosmetic), priority_severity: low, complexity: simple, time_effort: short (errand), frequency: one_time, system_category: pool_spa, subtasks: [], needs_contractor: false, is_purchase: true, estimated_cost_min: 1500, estimated_cost_max: 4000. ai_rationale: "Cosmetic upkeep, no deadline — low risk and priority; short errand to buy a ~$15–40 net."

User: "move from closed shelf all routers and devices that may overheat during summer and lead to fire"
→ risk_level: high (fire/overheating electronics), priority_severity: urgent, complexity: simple, time_effort: quick, frequency: one_time, system_category: smart_home, suggested_due_in_days: 1, subtasks: [], needs_contractor: false, is_purchase: false, estimated_cost_min: null, estimated_cost_max: null. ai_rationale: "Overheating electronics are a fire hazard, so high risk and urgent despite being a quick fix; nothing to buy."

User: "replace the broken dishwasher"
→ risk_level: low, priority_severity: medium, complexity: involved, time_effort: medium, frequency: one_time, system_category: appliances, subtasks: [research/compare models, order, schedule install/haul-away], needs_contractor: false, is_purchase: true, estimated_cost_min: 45000, estimated_cost_max: 90000. ai_rationale: "Buying a replacement appliance — mid-range $450–$900; multi-step so decomposed."

User: "enable monitoring for radon detector that I borrowed — have to return it to a friend"
→ risk_level: medium (radon is a health hazard but monitoring is precautionary), priority_severity: high (borrowed item with a return deadline), complexity: simple, time_effort: quick, frequency: one_time, system_category: safety, suggested_due_in_days: 2, subtasks: [], needs_contractor: false. ai_rationale: "Health-related but precautionary (medium risk); the borrowed-item return deadline drives high priority."

User (TODAY is 2026-07-01; members: "Pedram (you)", "Sarah"): "ask Sarah to service the AC before July 10"
→ system_category: hvac, priority_severity: high (hard deadline), risk_level: medium, complexity: moderate, time_effort: medium, frequency: one_time, suggested_due_date: "2026-07-10", suggested_due_in_days: null, assignee_name: "Sarah", subtasks: []. ai_rationale: "Explicit July 10 deadline (9 days out) sets high priority; assigned to Sarah as requested."

User: "rfef"
→ needs_clarification: true, clarification_question: "I didn't catch a task in \\"rfef\\" — could you describe what you'd like done?", title: "rfef", risk_level: low, priority_severity: low, complexity: trivial, time_effort: quick, system_category: other, frequency: one_time, suggested_due_in_days: null, subtasks: [], needs_contractor: false. ai_rationale: "No interpretable task signal in the input."`;

/** A household member the model may assign the task to. */
export interface EnrichTaskMember {
  /** Display name shown to the model + matched back to a user id in code. */
  name: string;
  /** True for the person who created this task (resolves "me"/"myself"). */
  isCreator: boolean;
}

/** A household space the model may assign the task to. */
export interface EnrichTaskSpace {
  id: string;
  name: string;
}

export interface EnrichTaskContext {
  /** Today's date in the household's timezone, e.g. "2026-07-01". */
  todayIso: string;
  /** Human label, e.g. "Wednesday, July 1, 2026". */
  todayHuman: string;
  /** IANA zone the dates are expressed in, e.g. "America/Los_Angeles". */
  timezone: string;
  /** Household members the task can be assigned to. */
  members: EnrichTaskMember[];
  /** Household spaces the task can be assigned to. */
  spaces: EnrichTaskSpace[];
}

/**
 * Build the per-task user prompt. The stable rubric lives in the cached system
 * prefix; this message carries the volatile context (today's date + household
 * members) the model needs to resolve deadlines and assignees, then the raw
 * capture text.
 */
export function buildEnrichTaskUserPrompt(rawText: string, ctx?: EnrichTaskContext): string {
  const lines: string[] = [];
  if (ctx) {
    lines.push(
      `TODAY: ${ctx.todayHuman} (${ctx.todayIso}) — household timezone ${ctx.timezone}.`,
      'Resolve any spoken date/day against TODAY. Only set suggested_due_date when the user actually indicated a day.'
    );
    if (ctx.members.length) {
      const list = ctx.members
        .map((m) => (m.isCreator ? `${m.name} (you)` : m.name))
        .join(', ');
      lines.push(
        `HOUSEHOLD MEMBERS (assign only to one of these, by exact name, or null): ${list}.`
      );
    } else {
      lines.push('HOUSEHOLD MEMBERS: none available — always return assignee_name: null.');
    }
    if (ctx.spaces.length) {
      const spaceList = ctx.spaces.map((s) => s.name).join(', ');
      lines.push(
        `HOUSEHOLD SPACES (pick best match by exact name, or null): ${spaceList}.`
      );
    } else {
      lines.push('HOUSEHOLD SPACES: none available — always return space_name: null.');
    }
    lines.push('');
  }
  lines.push(`Convert this into one structured task:\n\n"""${rawText.trim()}"""`);
  return lines.join('\n');
}
