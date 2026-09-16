/**
 * House chat assistant — the WRITE half. "Do it for me", not "here's how".
 *
 * ## The problem this shape exists to solve
 *
 * A member in a project chat says "add 12 boxes of the herringbone oak at $89 a
 * box". Manually that is four taps on the hub. The assistant should be able to
 * do exactly that, and until this module existed it could only describe it —
 * `HOUSE_CHAT_CONFIG` shipped with no `assistant` capability at all, so the
 * model had zero tools and every actionable request degraded into a clarifying
 * question. That is the behaviour the screenshot in the brief shows.
 *
 * ## Why the Worker does not perform the write
 *
 * The obvious fix — give the assistant a `HomeProjectsService` and let it INSERT
 * — is wrong here, and not marginally so.
 *
 * A House V2 home project is **Tier A**. `homeProjectsApi` on the client is a
 * `createHouseLocalProxy`, and seventeen of its thirty methods route to
 * `localHomeProjectsApi` — the on-device encrypted ledger. For a local-first
 * household D1 has never seen a row of that project and never will. Chat is
 * Tier B and server-authoritative. This is the same asymmetry that already
 * forced the grounding snapshot to be assembled on the client
 * (`src/screens/home-projects/projectChatContext.ts`): the Worker cannot READ
 * the project, so it certainly cannot WRITE it.
 *
 * A server-side tool would therefore:
 *  - silently no-op (or 404) for every local-first household, i.e. for the
 *    households the local-first mode exists to protect;
 *  - and, for the server-backed ones, become a SECOND write path beside the
 *    facade — duplicating the validation, the budget-line derivation and the
 *    rollup recomputation the hub depends on, and drifting from them.
 *
 * "AI must be able to do whatever the user can do manually" is satisfied by
 * exactly one arrangement: **the AI's write goes down the same code path as the
 * user's tap.**
 *
 * ## So the tool proposes and the client executes
 *
 * Every tool here is a pure function. It validates the model's arguments,
 * normalises them into the facade's own input shape, and returns a
 * {@link ChatProposedAction} — an envelope carried on the AI message's
 * `metadata.actions`. The client picks it up and runs it through
 * `homeProjectsApi`, which is the identical call the hub screen makes. Same
 * validation, same local/remote routing, same React Query invalidation, same
 * sync. Nothing about a material added by the assistant differs from one added
 * by hand, because nothing about the write differs.
 *
 * The precedent is already in the tree: Budget's `scan_receipt_for_review`
 * returns a `receiptDraft` the client confirms rather than an expense the
 * Worker inserted. This generalises that one special case into a catalogue.
 *
 * ## Addressing an existing row without ids
 *
 * The grounding brief deliberately omits ids — they cost context and invite the
 * model to re-derive them. But `update_material` needs a handle. So the brief
 * now carries a short deterministic `ref` (the first {@link REF_LEN} characters
 * of the row id) and the tools take that ref back. The client resolves it by
 * prefix against the hub it is already rendering. Deterministic beats a stored
 * ref→id map: no state to persist, and a ref stays valid across an app restart,
 * a re-open of the room, and a second device.
 *
 * `name` is accepted as a fallback for the case the model paraphrases rather
 * than quotes. Resolution order and the ambiguity refusal live on the client
 * (`src/features/chat/actions/`), because that is where the rows are.
 *
 * ## What is NOT here
 *
 * Reads. The assistant already has the household's own record of the project in
 * front of it via the subject block — a `get_materials` tool would round-trip
 * to a Worker that cannot answer it. Everything in this file changes something.
 */
import type { GenerateToolDef } from '../../ai/provider';

import type { ChatAssistantSubject } from './chat-room-service-core';

/** How many characters of a row id the brief exposes as an addressable ref. */
export const REF_LEN = 6;

/** Every write the assistant can perform on a home project. */
export type HouseActionKind =
  | 'add_material'
  | 'update_material'
  | 'remove_material'
  | 'add_budget_line'
  | 'update_budget_line'
  | 'add_phase'
  | 'add_blocker'
  | 'resolve_blocker'
  | 'add_task'
  | 'update_project';

/**
 * One write the assistant has decided on, addressed to the client that owns the
 * rows. Mirrored verbatim by `src/features/chat/actions/types.ts` — keep the two
 * in sync; the client parses this leniently and drops anything it cannot map.
 */
export interface ChatProposedAction {
  /**
   * Stable within one AI message. The client's dedupe key: a reconnect, a
   * re-render or a second device replaying the same message must not apply the
   * same write twice.
   */
  id: string;
  kind: HouseActionKind;
  /** The project this write lands in. Always resolved from the room's subject. */
  project_id: string;
  /**
   * Arguments in the FACADE's shape (`createSelection`'s input, etc.), already
   * validated and unit-converted. The client passes them through rather than
   * re-interpreting them.
   */
  args: Record<string, unknown>;
  /**
   * Which existing row this targets, for the kinds that need one. `ref` is an
   * id prefix from the brief; `name` is the model's own words as a fallback.
   */
  target?: { ref?: string; name?: string };
  /** The card's one-line label: "Add 12 boxes of Herringbone Oak — $1,068". */
  summary: string;
  /**
   * True when the member must tap before it happens. Set for anything that
   * destroys or overwrites work; additive writes apply on arrival (see the
   * apply policy in `useChatMessageActions`).
   */
  confirm: boolean;
}

/** A tool handler's verdict: an action to carry, or a reason it cannot be built. */
type Normalised = { action: Omit<ChatProposedAction, 'id'> } | { error: string };

interface ActionDescriptor {
  kind: HouseActionKind;
  tool: GenerateToolDef;
  /**
   * Build the envelope from the model's raw input. Pure — it never touches the
   * database, because there is no database here that holds these rows.
   */
  normalise(input: Record<string, unknown>, subject: ResolvedSubject): Normalised;
}

/** The project (and optionally the material) a room is about. */
export interface ResolvedSubject {
  projectId: string;
  projectLabel: string;
  /** Set only in a material room — the implicit target of material writes. */
  materialRef: string | null;
  materialLabel: string | null;
}

// ---------------------------------------------------------------- helpers

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** A model-supplied dollar amount → integer cents. Negative is rejected. */
function cents(v: unknown): number | undefined {
  const n = num(v);
  if (n == null || n < 0) return undefined;
  return Math.round(n * 100);
}

function money(c: number | undefined): string | null {
  if (c == null) return null;
  return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * The row an update/remove targets. In a MATERIAL room the material is implicit
 * — the member said "make it 14 boxes" about the thing the chat is named after
 * — so an omitted ref falls back to the subject rather than failing.
 */
function resolveTarget(
  input: Record<string, unknown>,
  subject: ResolvedSubject,
  opts: { implicitMaterial: boolean }
): { ref?: string; name?: string } | null {
  const ref = str(input.ref);
  const name = str(input.name);
  if (ref || name) return { ref, name };
  if (opts.implicitMaterial && subject.materialRef) {
    return { ref: subject.materialRef, name: subject.materialLabel ?? undefined };
  }
  return null;
}

/** Copy only the keys the model actually supplied, so a PATCH stays a PATCH. */
function pick(
  input: Record<string, unknown>,
  spec: Record<string, (v: unknown) => unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, coerce] of Object.entries(spec)) {
    if (!(key in input)) continue;
    const value = coerce(input[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const MATERIAL_TARGET_SCHEMA = {
  ref: {
    type: 'string',
    description:
      'The material\'s short ref, exactly as shown after "ref" in the household record above. Preferred over name.',
  },
  name: {
    type: 'string',
    description: 'The material\'s name, if you have no ref. Must match the record.',
  },
} as const;

const AREA_UNITS = ['m2', 'sqft'] as const;
const BUDGET_CATEGORIES = ['materials', 'labor', 'permits', 'contingency', 'other'] as const;
const BLOCKER_SEVERITIES = ['low', 'medium', 'high'] as const;
const PROJECT_STATUSES = ['planning', 'in_progress', 'on_hold', 'complete'] as const;

// ---------------------------------------------------------------- catalogue

const ADD_MATERIAL: ActionDescriptor = {
  kind: 'add_material',
  tool: {
    name: 'add_material',
    description:
      'Add a material / product / fixture to this project\'s shortlist — the same row the member would create with "Add material" on the project hub. Use it whenever they ask you to add, shortlist, or price something. Prices are in dollars.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'What it is, e.g. "Herringbone white oak flooring".' },
        category: {
          type: 'string',
          description: 'Free text grouping, e.g. "Flooring", "Plumbing", "Paint".',
        },
        qty: { type: 'number', description: 'How many units. Defaults to 1.' },
        unit: { type: 'string', description: 'Unit of the quantity, e.g. "box", "sq ft", "each".' },
        unit_price: { type: 'number', description: 'Price per unit in dollars.' },
        vendor: { type: 'string', description: 'Where it is bought, e.g. "Home Depot".' },
        brand: { type: 'string' },
        sku: { type: 'string', description: 'Model / SKU number, when known.' },
        product_url: { type: 'string', description: 'Link to the product page.' },
        coverage_per_unit: {
          type: 'number',
          description: 'Area one unit covers — only for area-priced goods (flooring, tile, paint).',
        },
        coverage_unit: { type: 'string', enum: [...AREA_UNITS] },
        notes: { type: 'string', description: 'Anything the member said about it.' },
      },
      required: ['name'],
    },
  },
  normalise(input, subject) {
    const name = str(input.name);
    if (!name) return { error: 'A material needs a name.' };

    const qty = num(input.qty);
    const unitPriceCents = cents(input.unit_price);
    const coverageUnit = str(input.coverage_unit);
    const args = {
      name,
      ...pick(input, {
        category: str,
        unit: str,
        vendor: str,
        brand: str,
        sku: str,
        notes: str,
      }),
      ...(qty != null && qty > 0 ? { qty } : {}),
      ...(unitPriceCents != null ? { unitPriceCents } : {}),
      ...(str(input.product_url) ? { productUrl: str(input.product_url) } : {}),
      ...(num(input.coverage_per_unit) != null &&
      (coverageUnit === 'm2' || coverageUnit === 'sqft')
        ? { coveragePerUnit: num(input.coverage_per_unit), coverageUnit }
        : {}),
    };

    const total = unitPriceCents != null ? unitPriceCents * (qty ?? 1) : undefined;
    const qtyPart = qty != null && qty > 1 ? `${qty}${input.unit ? ` ${str(input.unit)}` : ''} ` : '';
    const pricePart = money(total) ? ` — ${money(total)}` : '';
    return {
      action: {
        kind: 'add_material',
        project_id: subject.projectId,
        args,
        summary: `Add ${qtyPart}${name}${pricePart}`,
        confirm: false,
      },
    };
  },
};

const UPDATE_MATERIAL: ActionDescriptor = {
  kind: 'update_material',
  tool: {
    name: 'update_material',
    description:
      'Change a material already on this project — quantity, price, vendor, status, notes. Identify it by its ref from the household record. In a chat about ONE material you may omit ref and it applies to that material. Only send the fields that change.',
    input_schema: {
      type: 'object',
      properties: {
        ...MATERIAL_TARGET_SCHEMA,
        new_name: { type: 'string', description: 'Rename it.' },
        qty: { type: 'number' },
        unit: { type: 'string' },
        unit_price: { type: 'number', description: 'New price per unit, in dollars.' },
        vendor: { type: 'string' },
        brand: { type: 'string' },
        sku: { type: 'string' },
        product_url: { type: 'string' },
        status: {
          type: 'string',
          description:
            'Where it stands, e.g. "considering", "chosen", "ordered", "purchased", "installed".',
        },
        coverage_per_unit: { type: 'number' },
        coverage_unit: { type: 'string', enum: [...AREA_UNITS] },
        notes: { type: 'string' },
      },
    },
  },
  normalise(input, subject) {
    const target = resolveTarget(input, subject, { implicitMaterial: true });
    if (!target) {
      return {
        error:
          'Say which material — pass its ref from the household record above (or its exact name).',
      };
    }

    const coverageUnit = str(input.coverage_unit);
    const args = {
      ...pick(input, {
        qty: num,
        unit: str,
        vendor: str,
        brand: str,
        sku: str,
        status: str,
        notes: str,
      }),
      ...(str(input.new_name) ? { name: str(input.new_name) } : {}),
      ...('unit_price' in input && cents(input.unit_price) != null
        ? { unitPriceCents: cents(input.unit_price) }
        : {}),
      ...(str(input.product_url) ? { productUrl: str(input.product_url) } : {}),
      ...(num(input.coverage_per_unit) != null &&
      (coverageUnit === 'm2' || coverageUnit === 'sqft')
        ? { coveragePerUnit: num(input.coverage_per_unit), coverageUnit }
        : {}),
    };
    if (Object.keys(args).length === 0) {
      return { error: 'Nothing to change — say which field to set.' };
    }

    const what = target.name || subject.materialLabel || 'the material';
    const changes = Object.keys(args)
      .map((k) => FIELD_LABELS[k] ?? k)
      .join(', ');
    return {
      action: {
        kind: 'update_material',
        project_id: subject.projectId,
        target,
        args,
        summary: `Update ${what} (${changes})`,
        confirm: false,
      },
    };
  },
};

/** Human words for the facade's camelCase fields, used in card summaries. */
const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  qty: 'quantity',
  unit: 'unit',
  unitPriceCents: 'price',
  vendor: 'vendor',
  brand: 'brand',
  sku: 'SKU',
  productUrl: 'link',
  status: 'status',
  notes: 'notes',
  coveragePerUnit: 'coverage',
  coverageUnit: 'coverage unit',
  estimateCents: 'estimate',
  actualCents: 'actual',
  label: 'label',
  category: 'category',
  title: 'title',
  targetBudgetCents: 'target budget',
  targetEndAt: 'target date',
  summary: 'description',
};

const REMOVE_MATERIAL: ActionDescriptor = {
  kind: 'remove_material',
  tool: {
    name: 'remove_material',
    description:
      'Remove a material from this project entirely. Destructive — the member is asked to confirm before it happens, so say plainly what you are removing.',
    input_schema: {
      type: 'object',
      properties: MATERIAL_TARGET_SCHEMA,
    },
  },
  normalise(input, subject) {
    const target = resolveTarget(input, subject, { implicitMaterial: true });
    if (!target) return { error: 'Say which material to remove (its ref from the record).' };
    return {
      action: {
        kind: 'remove_material',
        project_id: subject.projectId,
        target,
        args: {},
        summary: `Remove ${target.name || subject.materialLabel || 'the material'}`,
        confirm: true,
      },
    };
  },
};

const ADD_BUDGET_LINE: ActionDescriptor = {
  kind: 'add_budget_line',
  tool: {
    name: 'add_budget_line',
    description:
      'Add a cost line to the project budget — labour, permits, contingency, or a cost no material covers. Materials already priced on the shortlist generate their own line; do not duplicate them here.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'What the cost is, e.g. "Mold remediation — quoted".' },
        category: { type: 'string', enum: [...BUDGET_CATEGORIES] },
        estimate: { type: 'number', description: 'Estimated cost in dollars.' },
        actual: { type: 'number', description: 'Actual cost in dollars, once known.' },
      },
      required: ['label', 'category'],
    },
  },
  normalise(input, subject) {
    const label = str(input.label);
    const category = str(input.category);
    if (!label) return { error: 'A budget line needs a label.' };
    if (!category || !BUDGET_CATEGORIES.includes(category as (typeof BUDGET_CATEGORIES)[number])) {
      return { error: `category must be one of: ${BUDGET_CATEGORIES.join(', ')}.` };
    }
    const estimateCents = cents(input.estimate);
    const actualCents = cents(input.actual);
    if (estimateCents == null && actualCents == null) {
      return { error: 'Give an estimate or an actual amount.' };
    }
    return {
      action: {
        kind: 'add_budget_line',
        project_id: subject.projectId,
        args: {
          label,
          category,
          ...(estimateCents != null ? { estimateCents } : {}),
          ...(actualCents != null ? { actualCents } : {}),
        },
        summary: `Add budget line “${label}” — ${money(estimateCents ?? actualCents)}`,
        confirm: false,
      },
    };
  },
};

const UPDATE_BUDGET_LINE: ActionDescriptor = {
  kind: 'update_budget_line',
  tool: {
    name: 'update_budget_line',
    description:
      'Change a budget line already on the project — usually to record what something actually cost. Identify it by its ref from the household record.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The budget line\'s ref from the record above.' },
        name: { type: 'string', description: 'Its label, if you have no ref.' },
        label: { type: 'string', description: 'Rename it.' },
        category: { type: 'string', enum: [...BUDGET_CATEGORIES] },
        estimate: { type: 'number', description: 'New estimate in dollars.' },
        actual: { type: 'number', description: 'What it actually cost, in dollars.' },
      },
    },
  },
  normalise(input, subject) {
    const target = resolveTarget(input, subject, { implicitMaterial: false });
    if (!target) return { error: 'Say which budget line — pass its ref from the record above.' };
    const args = {
      ...pick(input, { label: str, category: str }),
      ...('estimate' in input && cents(input.estimate) != null
        ? { estimateCents: cents(input.estimate) }
        : {}),
      ...('actual' in input && cents(input.actual) != null
        ? { actualCents: cents(input.actual) }
        : {}),
    };
    if (Object.keys(args).length === 0) return { error: 'Nothing to change on that line.' };
    return {
      action: {
        kind: 'update_budget_line',
        project_id: subject.projectId,
        target,
        args,
        summary: `Update budget line ${target.name ?? target.ref} (${Object.keys(args)
          .map((k) => FIELD_LABELS[k] ?? k)
          .join(', ')})`,
        confirm: false,
      },
    };
  },
};

const ADD_PHASE: ActionDescriptor = {
  kind: 'add_phase',
  tool: {
    name: 'add_phase',
    description:
      'Add a phase (a stage of work) to the project timeline, e.g. "Demo", "Mold remediation", "Electrical rough-in".',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    },
  },
  normalise(input, subject) {
    const title = str(input.title);
    if (!title) return { error: 'A phase needs a title.' };
    return {
      action: {
        kind: 'add_phase',
        project_id: subject.projectId,
        args: { title },
        summary: `Add phase “${title}”`,
        confirm: false,
      },
    };
  },
};

const ADD_BLOCKER: ActionDescriptor = {
  kind: 'add_blocker',
  tool: {
    name: 'add_blocker',
    description:
      'Record something that is holding the project up — a permit not issued, a wall that turned out to be wet, a decision nobody has made. Use it when the member describes a problem rather than asks a question about one.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        severity: { type: 'string', enum: [...BLOCKER_SEVERITIES] },
        notes: { type: 'string' },
      },
      required: ['title'],
    },
  },
  normalise(input, subject) {
    const title = str(input.title);
    if (!title) return { error: 'A blocker needs a title.' };
    const severity = str(input.severity);
    return {
      action: {
        kind: 'add_blocker',
        project_id: subject.projectId,
        args: {
          title,
          ...(severity && BLOCKER_SEVERITIES.includes(severity as (typeof BLOCKER_SEVERITIES)[number])
            ? { severity }
            : {}),
          ...(str(input.notes) ? { notes: str(input.notes) } : {}),
        },
        summary: `Add blocker “${title}”`,
        confirm: false,
      },
    };
  },
};

const RESOLVE_BLOCKER: ActionDescriptor = {
  kind: 'resolve_blocker',
  tool: {
    name: 'resolve_blocker',
    description: 'Mark a blocker on this project as resolved.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The blocker\'s ref from the record above.' },
        name: { type: 'string', description: 'Its title, if you have no ref.' },
        notes: { type: 'string', description: 'How it was resolved.' },
      },
    },
  },
  normalise(input, subject) {
    const target = resolveTarget(input, subject, { implicitMaterial: false });
    if (!target) return { error: 'Say which blocker — pass its ref from the record above.' };
    return {
      action: {
        kind: 'resolve_blocker',
        project_id: subject.projectId,
        target,
        args: { status: 'resolved', ...(str(input.notes) ? { notes: str(input.notes) } : {}) },
        summary: `Resolve blocker ${target.name ?? target.ref}`,
        confirm: false,
      },
    };
  },
};

const ADD_TASK: ActionDescriptor = {
  kind: 'add_task',
  tool: {
    name: 'add_task',
    description:
      'Create a maintenance task linked to this project — something a person has to DO, which then appears in the household\'s tasks alongside the project.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['title'],
    },
  },
  normalise(input, subject) {
    const title = str(input.title);
    if (!title) return { error: 'A task needs a title.' };
    return {
      action: {
        kind: 'add_task',
        project_id: subject.projectId,
        args: { title, ...(str(input.description) ? { description: str(input.description) } : {}) },
        summary: `Add task “${title}”`,
        confirm: false,
      },
    };
  },
};

const UPDATE_PROJECT: ActionDescriptor = {
  kind: 'update_project',
  tool: {
    name: 'update_project',
    description:
      'Change the project itself — its status, target budget, dates or description. Overwrites what the member set, so it is confirmed before it happens.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: [...PROJECT_STATUSES] },
        target_budget: { type: 'number', description: 'Target budget in dollars.' },
        summary: { type: 'string', description: 'What the project is, in a sentence or two.' },
        target_end_date: { type: 'string', description: 'When it should be done, YYYY-MM-DD.' },
      },
    },
  },
  normalise(input, subject) {
    const isDate = (v: unknown) =>
      typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    const status = str(input.status);
    // Keys here are `homeProjectsApi.update`'s own patch shape — the client
    // passes them straight through rather than re-mapping them.
    const args = {
      ...(status && PROJECT_STATUSES.includes(status as (typeof PROJECT_STATUSES)[number])
        ? { status }
        : {}),
      ...pick(input, { summary: str }),
      ...('target_budget' in input && cents(input.target_budget) != null
        ? { targetBudgetCents: cents(input.target_budget) }
        : {}),
      ...(isDate(input.target_end_date) ? { targetEndAt: isDate(input.target_end_date) } : {}),
    };
    if (Object.keys(args).length === 0) return { error: 'Nothing to change on the project.' };
    return {
      action: {
        kind: 'update_project',
        project_id: subject.projectId,
        args,
        summary: `Update ${subject.projectLabel} (${Object.keys(args)
          .map((k) => FIELD_LABELS[k] ?? k)
          .join(', ')})`,
        confirm: true,
      },
    };
  },
};

const DESCRIPTORS: ActionDescriptor[] = [
  ADD_MATERIAL,
  UPDATE_MATERIAL,
  REMOVE_MATERIAL,
  ADD_BUDGET_LINE,
  UPDATE_BUDGET_LINE,
  ADD_PHASE,
  ADD_BLOCKER,
  RESOLVE_BLOCKER,
  ADD_TASK,
  UPDATE_PROJECT,
];

const BY_KIND = new Map(DESCRIPTORS.map((d) => [d.kind as string, d]));

/** True for a tool name this module owns. */
export function isHouseActionTool(name: string): boolean {
  return BY_KIND.has(name);
}

/**
 * The action tools offered for a room.
 *
 * Empty for a room with no project subject — the household's general chat and
 * the dedicated assistant room have no project to write to, and offering tools
 * that can only fail teaches the model to try them.
 */
export function houseActionTools(subject: ResolvedSubject | null): GenerateToolDef[] {
  if (!subject) return [];
  return DESCRIPTORS.map((d) => d.tool);
}

/**
 * Read a room's subject into the project (and material) an action targets.
 *
 * A material room carries the project on `parentId`; a project room IS the
 * project. Anything else has nothing to write to.
 */
export function resolveActionSubject(
  subject: ChatAssistantSubject | null | undefined
): ResolvedSubject | null {
  if (!subject) return null;
  if (subject.type === 'home_project') {
    return {
      projectId: subject.id,
      projectLabel: subject.label || 'this project',
      materialRef: null,
      materialLabel: null,
    };
  }
  if (subject.type === 'home_project_material' && subject.parentId) {
    return {
      projectId: subject.parentId,
      projectLabel: subject.parentLabel || 'this project',
      materialRef: subject.id.slice(0, REF_LEN),
      materialLabel: subject.label || null,
    };
  }
  return null;
}

/**
 * Turn one tool call into an action for the client, or into the sentence the
 * model should read instead.
 *
 * Never throws and never returns a bare failure: the string it hands back is
 * fed straight into the model's `tool_result`, so it has to be something the
 * assistant can relay to a member without sounding broken.
 */
export function buildHouseAction(
  subject: ResolvedSubject | null,
  call: { name: string; input: Record<string, unknown> },
  /** Index within this reply — makes the action id stable and unique. */
  seq: number
): { result: string; action?: ChatProposedAction } {
  const descriptor = BY_KIND.get(call.name);
  if (!descriptor) return { result: `Unknown action “${call.name}”.` };
  if (!subject) {
    return {
      result:
        'This chat is not attached to a project, so there is nothing to change. Ask the member to open the project\'s own chat.',
    };
  }

  const outcome = descriptor.normalise(call.input ?? {}, subject);
  if ('error' in outcome) return { result: outcome.error };

  const action: ChatProposedAction = { id: `${call.name}-${seq}`, ...outcome.action };
  return {
    result: action.confirm
      ? `Ready: “${action.summary}”. It is shown to the member as a confirmation card — tell them briefly what it will do and that they need to confirm it.`
      : `Done: “${action.summary}”. It is being applied to their project now. Confirm it back to them in one short sentence; do NOT call this tool again for the same thing.`,
    action,
  };
}
