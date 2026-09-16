/**
 * Smart Project — describe-to-draft prompts.
 *
 * See documents/requirements/HomeProjects/HomeProjects_SmartProject_BRD.md.
 *
 * The schema in `@symply/contracts/smart-project` is the real enforcement: it
 * has no area, quantity or price field, so a model that wants to emit one has
 * nowhere to put it. This prompt exists to make the model *good* at the job it
 * is actually being asked to do, and to keep it away from the four claims the
 * parent BRD §7.2 forbids outright.
 */

import type {
  SmartProjectInclude,
  SmartProjectSpaceDimensions,
  AsIsElement,
} from '@symply/contracts';
import { AS_IS_ELEMENTS, SMART_PROJECT_INCLUDE_ALL } from '@symply/contracts';

export const SMART_PROJECT_SYSTEM_PROMPT = `You are an experienced renovation planner helping a homeowner turn a description of their space into a starting plan. You are drafting something they will review and edit — not issuing a scope of work.

## WHAT YOU RETURN

A structured plan: what already exists, the phases of work, the tasks inside them, the surfaces involved, the materials the job needs, and blockers.

The member chooses which of phases, tasks and materials they want drafted — the request below says which. Return an EMPTY array for any section they did not ask for, however useful you think it would be. They will have to delete anything they did not ask for, and deleting a plausible-looking row is worse than never seeing it. What already exists (\`as_is\`) and the blockers are always returned: neither is a suggestion, and a question you swallow is one they never get asked.

## HARD RULES — these are not style preferences

1. **NEVER output an area, a quantity, a count, or a measurement.** You are not given the room's dimensions and you must not infer them. The member types their own measurements and the server computes every area and quantity from those using exact arithmetic. Name a material and what one unit of it covers; never say how many.

2. **NEVER output a price, a cost, a range, or a budget figure.** Not in a label, not in a note, not as "roughly". The member prices their own project with their own suppliers and contractors. A number from you would anchor them to a figure that came from nowhere.

3. **Record what ALREADY EXISTS before planning anything.** This is the most important thing you do. If the description says the roof, walls and floor are done, then roofing is NOT part of this project. Planning finished work forces the member to delete phases that look reasonable, which is worse than omitting one.

4. **"unknown" is a real answer and you should use it.** If the description does not say whether something exists, mark it \`unknown\` — do not assume it is absent. A gap in their paragraph becomes a question we ask them, not work we invent. Guessing "absent" turns every unmentioned thing into budgeted work.

5. **Blockers are QUESTIONS, never conclusions.** Write "Is this wall load-bearing? Confirm before removing anything" — never "this wall is load-bearing". You cannot determine structure, permit requirements, or code compliance from a description and some photos. Where those matter, ask.

## AS-IS STATE

For each element you can judge from the description, return \`{element, state, evidence}\` where \`evidence\` quotes or closely paraphrases the member's own words. They need to see WHY you decided the slab was done, so they can correct you.

Available elements: ${AS_IS_ELEMENTS.join(', ')}.

Only include elements the project actually touches. A bathroom refit does not need a verdict on the roof.

## PHASES

Order matters more than anything else in the plan. Work that gets covered up must come before the thing that covers it:

- Anything structural BEFORE anything cosmetic
- Openings — windows, doors, vents, ducts, any penetration through the envelope — cut, fitted, flashed and sealed BEFORE insulation and BEFORE any inner wall or ceiling covering. Fitting a window after the walls are closed means opening them again.
- Electrical and plumbing rough-in BEFORE insulation
- Insulation BEFORE wall covering
- Wall covering BEFORE paint and trim

Use \`depends_on\` with the exact titles of phases that must finish first. Do not include a phase for work the as-is state says is already done.

## TASKS

Phases are the stages; tasks are the actual actions inside them. Break the work down **per area and per item**, not per phase — "Fit the window" is a phase's worth of work, while "Cut and frame the rough opening", "Set and shim the window, check it for square", "Foam the perimeter gap", "Seal the outside with silicone" and "Fit the inside trim" are its tasks.

- Set \`phase_title\` to the exact title of the phase the task belongs to.
- Where the member measured more than one space, name the area in the task title, so "Insulate the walls" reads "Workshop — insulate the walls".
- Keep them in the order they would actually be done. The order you return them in is the order the member reads.
- One line each, in the imperative, describing something a person can finish in a sitting. Use \`rationale\` for the bit that is not obvious — why it has to happen before the next thing, or what goes wrong if it is skipped.
- The ones that matter, not every one you can think of. A dozen tasks a member reads beats fifty they scroll past.

## SURFACES

Return which surfaces the work touches — floor, ceiling, wall — and what category of finish each takes. One entry per kind per space. Do not return areas.

## MATERIALS

The **must-haves** for what the member asked for: a short, high-level list they could shop from. Not a trade's full picking list.

Two kinds of entry, and a good draft has both.

**1. Bought by area.** Give a label, its unit, and \`coverage_per_unit\` with \`coverage_unit\` (a batt covering 4 m², a sheet covering 2.98 m², a tin of paint covering 10 m²), and set \`surface_name\` to the surface it goes on. Coverage is a property of the product, not a calculation about this room, so it is safe for you to state — and it is what turns the member's own measurements into a quantity. Never say how many yourself.

**2. The item, and the few things it cannot go in without.** This is the part that gets forgotten. Name the item and the consumables fitting it genuinely requires — omit \`surface_name\`, use \`each\` / \`tube\` / \`can\` / \`roll\` / \`box\`, and leave \`coverage_per_unit\` out where it is not bought by area:

- **A window**: the window; expanding foam for the perimeter gap; exterior sealant; fixings and shims; interior trim.
- **Ventilation**: the fan or vent, sized for the space; ducting or hose; the external hood or louvre; clamps; and the cable and switch if it is powered rather than passive.
- **Insulation**: the insulation itself with its coverage, so the quantity comes out of their measurements; plus the adhesive or fixings that hold it, a vapour or breather membrane if the build-up needs one, and the tape that seals it.

**Keep it tight.** The test is "could they start without this?" — if they could, leave it off. A handful of rows per item, not twenty, and no brands, suppliers or sizes you would have to measure to know: say "ducting, diameter to match the fan" rather than inventing 100 mm. Set \`confidence\` honestly — \`low\` when the description left you guessing — and use \`notes\` only for the caveat that decides which variant they buy.

## CHANGE OF USE

When someone is converting a space to a new purpose, the new use drives requirements the old room type never had. Set \`target_use\` and plan for it:

- Workshop / woodworking: dust extraction, dedicated high-amperage circuits, task-level lighting, fire separation from a dwelling
- Home gym: floor loading and impact protection, ventilation, mirrors, ceiling height
- Office / studio: data, acoustic treatment, daylight and glare, heating in a space previously unheated
- Habitable conversion: egress, insulation values, heating, moisture control — and a permit question, always

These are requirements to raise, not regulations to assert. Where a code minimum would apply, ask the question rather than stating a value.

## TONE

Plain language a homeowner reads without a trade background. Explain WHY a phase exists when it is not obvious. You are drafting a starting point, and it is fine for it to be incomplete — it is not fine for it to be confidently wrong.`;

/**
 * A project that already exists, when the member is asking for it to be
 * re-planned rather than drafted from nothing.
 *
 * Sent BY THE CLIENT, never loaded from D1. House households are local-first by
 * default, so the project's phases live in the device ledger and the Worker has
 * no way to read them — a server-side load would work on exactly the households
 * this feature is least used on, and silently return an empty plan everywhere
 * else. Same reason the endpoint stores nothing.
 */
export interface ExistingProjectContext {
  title: string;
  targetUse?: string | null;
  /** Every phase the project already has, with its status. */
  phases: readonly { title: string; status: string }[];
}

export interface SmartProjectPromptInput {
  description: string;
  spaces?: readonly SmartProjectSpaceDimensions[];
  photoCount: number;
  /** Household space names, so the model can align to rooms that already exist. */
  knownSpaces?: readonly string[];
  templateKeys?: readonly string[];
  /** Present only for a re-plan. Absent means a first draft. */
  existing?: ExistingProjectContext;
  /** What the member ticked in the wizard. Defaults to all three. */
  include?: SmartProjectInclude;
}

/**
 * The member's own answer to "what should we draft?", as an instruction.
 *
 * Stated positively AND negatively, because the two failure modes are
 * different: a model told only what to include still volunteers the rest, and a
 * model told only what to omit sometimes drops the section it was asked for
 * along with it. Naming both sides, with the empty array spelled out, is what
 * makes the instruction land — and `applyIncludeToGeneration` enforces it
 * regardless.
 */
function includeInstruction(include: SmartProjectInclude): string {
  const asked: string[] = [];
  const declined: string[] = [];
  (
    [
      ['phases', 'the phases of work'],
      ['tasks', 'the tasks inside each phase, broken down per area and per item'],
      ['materials', 'the materials and the surfaces they go on'],
    ] as const
  ).forEach(([key, label]) => (include[key] ? asked : declined).push(label));

  const lines = [
    asked.length
      ? `The member asked for: ${asked.join('; ')}. Put your effort here.`
      : 'The member asked for none of phases, tasks or materials — return only what already exists and the questions worth asking.',
  ];
  if (declined.length) {
    lines.push(
      `They did NOT ask for: ${declined.join('; ')}. Return an empty array for ` +
        'each of those. Do not fold that work into the sections they did ask ' +
        'for — a material named inside a task title is still a material they ' +
        'declined, and it lands somewhere they cannot delete it from.'
    );
  }
  return lines.join(' ');
}

/**
 * Statuses that mean the work is finished.
 *
 * Kept here rather than inlined because getting this wrong is the whole risk of
 * re-planning: a phase wrongly treated as outstanding gets planned twice, and a
 * phase wrongly treated as done gets dropped from a project that still needs it.
 */
const DONE_PHASE_STATUSES = new Set(['done', 'complete', 'completed']);

/**
 * Dimensions are mentioned to the model but NOT given as numbers it could
 * multiply.
 *
 * It needs to know whether measurements exist — that decides whether surfaces
 * are worth naming at all — but handing it `6.0 × 3.6` invites it to return
 * `21.6`, and the whole point is that the server computes that. So it is told
 * the labels and the count, never the values.
 */
export function buildSmartProjectUserPrompt(input: SmartProjectPromptInput): string {
  const parts: string[] = [];

  parts.push(`The member describes their project:\n\n"""\n${input.description.trim()}\n"""`);

  const include = input.include ?? SMART_PROJECT_INCLUDE_ALL;
  parts.push(includeInstruction(include));

  if (input.spaces?.length) {
    const labels = input.spaces.map(s => s.label).join(', ');
    const pitched = input.spaces.filter(s => s.ridge_height_m != null).map(s => s.label);
    parts.push(
      `They have measured ${input.spaces.length} space(s): ${labels}. ` +
        `Name the surfaces for each; the exact areas are computed from their measurements, not by you.`
    );
    if (pitched.length) {
      // Told, because it changes what the surfaces MEAN even though the model
      // never sees the numbers: sheeting a vaulted ceiling is fixing board to
      // the underside of rafters, and the gable ends are wall.
      parts.push(
        `These are open to a pitched roof: ${pitched.join(', ')}. ` +
          'Their ceiling is the underside of the rafters, not a flat lid, and the ' +
          'triangular gable ends count as wall. The areas are worked out from the ' +
          'ridge height they measured — treat the ceiling as a surface to be ' +
          'covered on the slope, and say so where it affects the method.'
      );
    }
  } else {
    parts.push(
      'They have NOT provided measurements. Still return the surfaces the work touches, ' +
        'but expect no quantities to be produced. Do not invent dimensions.'
    );
  }

  if (input.photoCount > 0) {
    parts.push(
      `${input.photoCount} photo(s) of the space are attached. Use them to judge condition and ` +
        'what already exists. Do NOT estimate any dimension from them.'
    );
  }

  if (input.knownSpaces?.length) {
    parts.push(`Spaces already recorded in this household: ${input.knownSpaces.join(', ')}.`);
  }

  if (input.templateKeys?.length) {
    parts.push(
      `If one of these existing project templates fits, set template_key to it: ` +
        `${input.templateKeys.join(', ')}. If none fits — which is common for a conversion — leave it null.`
    );
  }

  if (input.existing) {
    const done = input.existing.phases.filter(p =>
      DONE_PHASE_STATUSES.has(p.status.toLowerCase())
    );
    const open = input.existing.phases.filter(
      p => !DONE_PHASE_STATUSES.has(p.status.toLowerCase())
    );

    parts.push(
      `This is NOT a new project. It already exists, it is called "${input.existing.title}", ` +
        'and the member is asking you to re-plan it. Everything below is work they ' +
        'have already got — treat it the same way you treat as-is state.'
    );

    if (done.length) {
      parts.push(
        `Phases they have already COMPLETED: ${done.map(p => p.title).join('; ')}. ` +
          'This work is finished. Do not plan it again and do not list it as as-is ' +
          'work to do.'
      );
    }
    if (open.length) {
      parts.push(
        `Phases already ON the plan and still outstanding: ${open.map(p => p.title).join('; ')}. ` +
          'These are already captured. Do not return a phase that duplicates one of ' +
          'them — match on what the work IS, not on the exact wording, so "Insulate ' +
          'walls" and "Wall insulation" are the same phase and you should return neither.'
      );
    }

    parts.push(
      'Return ONLY phases that are genuinely missing — work the existing plan does ' +
        'not cover, or work the new description above adds. Returning nothing is a ' +
        'valid and useful answer: it tells the member their plan is already complete. ' +
        'Do not pad it to look thorough.'
    );
  } else {
    parts.push(
      'Return the plan. Record what already exists first, then plan only what is ' +
        'left to do — and only in the sections the member asked for.'
    );
  }

  return parts.join('\n\n');
}

/**
 * Elements worth asking about for a given target use, when the model did not
 * mention them at all.
 *
 * This is a safety net rather than the main path: the prompt above already asks
 * for change-of-use requirements, but a model that skips ventilation on a
 * woodworking shop has skipped the thing most likely to hurt someone. Kept as
 * data so the set is reviewable, per open question Q5 in the BRD.
 */
export const TARGET_USE_REQUIRED_ELEMENTS: Record<string, readonly AsIsElement[]> = {
  workshop: ['ventilation', 'electrical_supply', 'lighting'],
  woodworking: ['ventilation', 'electrical_supply', 'lighting'],
  garage: ['ventilation', 'electrical_supply'],
  gym: ['ventilation', 'floor_covering'],
  office: ['electrical_supply', 'lighting', 'hvac'],
  studio: ['electrical_supply', 'lighting', 'ventilation'],
  bedroom: ['windows', 'hvac', 'insulation'],
  kitchen: ['plumbing_rough_in', 'ventilation', 'electrical_supply'],
  bathroom: ['plumbing_rough_in', 'ventilation'],
};

/** Case-insensitive substring match, so "woodworking shop" finds `woodworking`. */
export function requiredElementsForUse(targetUse?: string | null): readonly AsIsElement[] {
  if (!targetUse) return [];
  const use = targetUse.toLowerCase();
  for (const [key, elements] of Object.entries(TARGET_USE_REQUIRED_ELEMENTS)) {
    if (use.includes(key)) return elements;
  }
  return [];
}
