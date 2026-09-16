/**
 * What the assistant is told a project — or one material in it — actually IS.
 *
 * ## Why this is written on the client
 *
 * The assistant runs in the Worker. The project usually does not: a House V2
 * home project is Tier A, so for a local-first household it exists only in the
 * on-device encrypted ledger and D1 has never seen a row of it. Chat is Tier B
 * and server-authoritative. There is no query the Worker can run to find out
 * what "Kitchen Reno" costs.
 *
 * The screen, meanwhile, is rendering exactly that. So the brief is assembled
 * here — from the same hub payload the hub itself draws — and handed to the room
 * when it opens. This is the ONLY route by which project chat can be grounded in
 * real numbers, and it works identically whichever backend answered.
 *
 * ## Why it is prose and not JSON
 *
 * The consumer is a language model, and the difference between grounded and
 * ungrounded output is whether the numbers are legible in context, not whether
 * they parse. `"target_budget_cents": 4200000` invites a model to re-derive
 * $42,000 and occasionally to get it wrong; "Target budget: $42,000" does not.
 * Every figure is formatted the same way the member sees it on screen, so when
 * the assistant quotes one back it matches the card they are looking at.
 *
 * ## What is deliberately left out
 *
 * Ids, timestamps, sort orders, version counters, provenance flags. None of it
 * changes an answer, and all of it competes for the model's attention with the
 * four or five facts that do. The brief is capped because a project with sixty
 * materials would otherwise push the actual question out of the useful window —
 * the cap keeps the priced, decided and blocked items and says how many it
 * dropped, rather than truncating mid-list and reading as complete.
 */
import type {
  HomeProject,
  HomeProjectBlocker,
  HomeProjectHub,
  HomeProjectOptionGroup,
  HomeProjectPhase,
  HomeProjectSelection,
} from '@api/home-projects';
import { parseSpecs } from '@api/home-projects';
import { formatMoney } from '@utils/money';

/** How many materials a project brief lists before it starts summarising. */
const MAX_MATERIALS = 18;
/** How many phases / blockers / spec rows to carry. */
const MAX_PHASES = 12;
const MAX_BLOCKERS = 8;
const MAX_SPECS = 12;

/** Format cents in the project's OWN currency, not the viewer's preference. */
function money(cents: number | null | undefined, currency: string): string | null {
  if (cents == null) return null;
  return formatMoney(cents, { code: currency });
}

/** `sqft` → `sq ft`; anything else passes through. Display only. */
function unitLabel(unit: string | null | undefined): string {
  if (!unit) return '';
  return unit === 'sqft' ? 'sq ft' : unit === 'm2' ? 'm²' : unit;
}

/** A non-empty, trimmed line, or null. Keeps the assembly below free of `if`s. */
function line(label: string, value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? `${label}: ${text}` : null;
}

/**
 * How many characters of a row id the brief exposes as an addressable handle.
 * Must match `REF_LEN` in `backend/src/services/chat/house-assistant-actions.ts`.
 */
const REF_LEN = 6;

/**
 * The handle the assistant uses to point back at one row.
 *
 * Everything else about the brief is written for a reader — prose, formatted
 * money, no ids (see the module header). This is the one concession to the
 * assistant being able to ACT on what it reads: `update_material` needs to name
 * a material, and a name alone is ambiguous the moment a project has "Oak
 * flooring" and "Oak trim".
 *
 * A deterministic prefix of the real id rather than a positional token (`m1`,
 * `m2`): the ref has to survive the list being re-sorted, another member adding
 * a row, and the brief being rebuilt on the next open — a positional one would
 * silently start pointing at a different material. The client resolves it back
 * by prefix against the hub it is rendering (`homeProjectActionRunner`).
 *
 * Six characters is enough to be unique within one project's few dozen rows and
 * short enough not to cost the model attention. It is a fragment of an id the
 * device already holds, sent to a Worker that stores it next to the material's
 * full name and price — no meaningful widening of what a subject room already
 * discloses.
 */
function ref(id: string): string {
  return `ref ${id.slice(0, REF_LEN)}`;
}

/**
 * One material as a single dense line — name, brand, what it costs, and what it
 * covers. The cost-per-area is spelled out because it is the number that decides
 * a renovation and the one a member is most likely to be asking about.
 */
function materialLine(
  selection: HomeProjectSelection,
  currency: string,
  group?: HomeProjectOptionGroup
): string {
  const parts: string[] = [selection.name];
  if (selection.brand) parts.push(`by ${selection.brand}`);
  if (selection.vendor) parts.push(`from ${selection.vendor}`);

  const price = money(selection.unit_price_cents, currency);
  if (price) {
    const per = selection.unit ? ` per ${selection.unit}` : '';
    parts.push(`${price}${per}`);
  } else {
    parts.push('no price yet');
  }

  if (selection.coverage_per_unit && selection.unit_price_cents) {
    const perArea = selection.unit_price_cents / selection.coverage_per_unit;
    parts.push(
      `covers ${selection.coverage_per_unit} ${unitLabel(selection.coverage_unit)} per unit ` +
        `(≈${money(Math.round(perArea), currency)}/${unitLabel(selection.coverage_unit)})`
    );
  }

  if (selection.qty && selection.qty !== 1) parts.push(`qty ${selection.qty}`);
  if (selection.status) parts.push(selection.status);
  if (group?.preferred_selection_id === selection.id) parts.push('PREFERRED');
  if (selection.notes) parts.push(`note: ${selection.notes}`);
  parts.push(ref(selection.id));

  return `- ${parts.join(' · ')}`;
}

/** A surface being decided, with the area it has to cover. */
function groupHeading(group: HomeProjectOptionGroup): string {
  const area =
    group.area_value != null
      ? ` — ${group.area_value} ${unitLabel(group.area_unit)} to cover, +${group.waste_factor_pct}% waste`
      : '';
  return `${group.name} (${group.category})${area}`;
}

function phaseLine(phase: HomeProjectPhase): string {
  const dates = [phase.starts_on, phase.ends_on].filter(Boolean).join(' → ');
  return `- ${phase.title} · ${phase.status}${dates ? ` · ${dates}` : ''}`;
}

function blockerLine(blocker: HomeProjectBlocker): string {
  const note = blocker.notes ? ` — ${blocker.notes}` : '';
  return `- [${blocker.severity}] ${blocker.title} · ${blocker.status}${note} · ${ref(blocker.id)}`;
}

/** The header every brief opens with: what this project is and where it stands. */
function projectHeader(project: HomeProject, hub: HomeProjectHub): string[] {
  const currency = project.currency || 'USD';
  const { rollups } = hub;
  return [
    `Project: ${project.title}`,
    line('Type', project.type),
    line('Status', project.status),
    line('Summary', project.summary),
    line('Goals', project.goals),
    line('Constraints', project.constraints),
    line('Target budget', money(rollups.target_budget_cents, currency)),
    line('Estimated so far', money(rollups.estimate_total, currency)),
    line('Actually spent', money(rollups.actual_total, currency)),
    line(
      'Contingency',
      rollups.contingency_cents
        ? `${money(rollups.contingency_cents, currency)} (${project.contingency_pct}%)`
        : null
    ),
    line('Budget health', rollups.budget_health),
    line(
      'Target dates',
      [project.target_start_at, project.target_end_at].filter(Boolean).join(' → ') || null
    ),
  ].filter((l): l is string => l !== null);
}

/**
 * The brief for a project's GENERAL chat — the whole plan, compressed.
 *
 * Returns null when there is nothing worth saying, so the room is opened with no
 * context rather than with a heading and no facts under it. An empty brief is
 * worse than none: it reads to the model as "here is what is known", and what
 * follows is an invitation to fill the silence.
 */
export function buildProjectChatContext(hub: HomeProjectHub | null | undefined): string | null {
  if (!hub?.project) return null;
  const { project } = hub;
  const currency = project.currency || 'USD';
  const sections: string[] = [projectHeader(project, hub).join('\n')];

  // Materials, grouped by the surface they are competing for — the shape the
  // member sees in Surface Studio, so "the two floor options" means the same
  // thing to both of them.
  const groups = hub.option_groups ?? [];
  const selections = hub.selections ?? [];
  if (selections.length > 0) {
    const shown = selections.slice(0, MAX_MATERIALS);
    const byGroup = new Map<string, HomeProjectSelection[]>();
    const standalone: HomeProjectSelection[] = [];
    for (const selection of shown) {
      if (!selection.option_group_id) {
        standalone.push(selection);
        continue;
      }
      const list = byGroup.get(selection.option_group_id) ?? [];
      list.push(selection);
      byGroup.set(selection.option_group_id, list);
    }

    const blocks: string[] = ['MATERIALS'];
    for (const group of groups) {
      const members = byGroup.get(group.id);
      if (!members?.length) continue;
      blocks.push(
        `${groupHeading(group)}\n${members
          .map((s) => materialLine(s, currency, group))
          .join('\n')}`
      );
    }
    if (standalone.length > 0) {
      blocks.push(
        `Other materials\n${standalone.map((s) => materialLine(s, currency)).join('\n')}`
      );
    }
    if (selections.length > shown.length) {
      // Say what was dropped. A silently truncated list reads as the whole list,
      // and the assistant would then answer "that is all of them" and be wrong.
      blocks.push(`(${selections.length - shown.length} more materials not listed here.)`);
    }
    sections.push(blocks.join('\n\n'));
  }

  const phases = hub.phases ?? [];
  if (phases.length > 0) {
    const shown = phases.slice(0, MAX_PHASES);
    sections.push(
      `TIMELINE\n${shown.map(phaseLine).join('\n')}${
        phases.length > shown.length ? `\n(${phases.length - shown.length} more phases.)` : ''
      }`
    );
  }

  const openBlockers = (hub.blockers ?? []).filter((b) => b.status !== 'resolved');
  if (openBlockers.length > 0) {
    const shown = openBlockers.slice(0, MAX_BLOCKERS);
    sections.push(
      `OPEN BLOCKERS\n${shown.map(blockerLine).join('\n')}${
        openBlockers.length > shown.length
          ? `\n(${openBlockers.length - shown.length} more open blockers.)`
          : ''
      }`
    );
  }

  const budgetLines = hub.budget_lines ?? [];
  if (budgetLines.length > 0) {
    const rows = budgetLines
      .slice(0, MAX_MATERIALS)
      .map(
        (b) =>
          `- ${b.label} (${b.category}) · est ${money(b.estimate_cents, currency)} · actual ${money(
            b.actual_cents,
            currency
          )} · ${ref(b.id)}`
      );
    sections.push(`BUDGET LINES\n${rows.join('\n')}`);
  }

  // The assistant can change these rows, and every one above carries the handle
  // it needs to say WHICH. Spelled out rather than left to be inferred: a model
  // that treats `ref a1b2c3` as decoration will paraphrase the name instead,
  // and a name is ambiguous exactly when it matters.
  sections.push(
    'Rows above ending in "ref xxxxxx" can be changed. When you use a tool to update or ' +
      'remove one, pass that ref exactly as written.'
  );

  return sections.join('\n\n');
}

/**
 * The brief for ONE material's chat.
 *
 * Narrower on purpose: this conversation is "should we use this, and how much of
 * it do we need", so it leads with the product's own facts and the surface it is
 * competing for, then gives just enough of the project for budget questions to
 * land ("does this blow the kitchen budget?") without turning into the project
 * brief again.
 */
export function buildMaterialChatContext(
  hub: HomeProjectHub | null | undefined,
  selectionId: string
): string | null {
  const selection = hub?.selections?.find((s) => s.id === selectionId);
  if (!hub?.project || !selection) return null;

  const project = hub.project;
  const currency = project.currency || 'USD';
  const group = selection.option_group_id
    ? hub.option_groups?.find((g) => g.id === selection.option_group_id)
    : undefined;

  const facts: (string | null)[] = [
    `Material: ${selection.name}`,
    line('Category', selection.category),
    line('Status', selection.status),
    line('Brand', selection.brand),
    line('SKU', selection.sku),
    line('Retailer', selection.vendor),
    line('Product page', selection.product_url),
    line('Price', money(selection.unit_price_cents, currency)),
    line('Priced per', selection.unit),
    line('Quantity on the plan', selection.qty),
    line(
      'One unit covers',
      selection.coverage_per_unit
        ? `${selection.coverage_per_unit} ${unitLabel(selection.coverage_unit)}`
        : null
    ),
    line('List price', money(selection.list_price_cents, currency)),
    line('Sale price', money(selection.sale_price_cents, currency)),
    line('Discount', selection.discount_pct != null ? `${selection.discount_pct}%` : null),
    line('Sale ends', selection.sale_ends_at),
    line(
      'Piece size',
      selection.unit_w_mm && selection.unit_h_mm
        ? `${selection.unit_w_mm} × ${selection.unit_h_mm} mm`
        : null
    ),
    line('Colour', selection.color_hex),
    line('Notes', selection.notes),
  ];

  // The arithmetic the member can already see on the card. Handing over the
  // result rather than the inputs keeps the assistant from re-deriving it, which
  // is where a wrong answer would come from.
  if (selection.coverage_per_unit && selection.unit_price_cents) {
    const perArea = Math.round(selection.unit_price_cents / selection.coverage_per_unit);
    facts.push(
      `Effective cost: ${money(perArea, currency)} per ${unitLabel(selection.coverage_unit)}`
    );
  }

  const specs = parseSpecs(selection.specs_json ?? null);
  if (specs.length > 0) {
    facts.push(
      `Specs: ${specs
        .slice(0, MAX_SPECS)
        .map((s) => `${s.label} ${s.value}`)
        .join('; ')}`
    );
  }

  const sections: string[] = [facts.filter((f): f is string => f !== null).join('\n')];

  if (group) {
    const rivals = (hub.selections ?? []).filter(
      (s) => s.option_group_id === group.id && s.id !== selection.id
    );
    const decidedNote =
      group.preferred_selection_id === selection.id
        ? 'This is the currently preferred option for that surface.'
        : group.preferred_selection_id
          ? 'Another option is currently preferred for that surface.'
          : 'No option has been chosen for that surface yet.';
    sections.push(
      [
        `THE SURFACE IT IS FOR\n${groupHeading(group)}`,
        decidedNote,
        rivals.length > 0
          ? `Competing options:\n${rivals.map((s) => materialLine(s, currency, group)).join('\n')}`
          : 'It is the only option on the table for that surface.',
      ].join('\n')
    );
  }

  sections.push(
    [
      'THE PROJECT IT BELONGS TO',
      `${project.title} (${project.type}, ${project.status})`,
      line('Target budget', money(hub.rollups?.target_budget_cents, currency)),
      line('Estimated so far', money(hub.rollups?.estimate_total, currency)),
      line('Budget health', hub.rollups?.budget_health),
    ]
      .filter((l): l is string => l !== null && l !== undefined)
      .join('\n')
  );

  return sections.join('\n\n');
}
