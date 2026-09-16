import { zValidator } from '@hono/zod-validator';
import {
  homeProjectAccessUpdateSchema,
  homeProjectVisibilitySchema,
  normalizeHexColor,
  smartProjectIncludeSchema,
  SMART_PROJECT_MAX_PHOTOS,
} from '@symply/contracts';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { assertCanUseAI } from '../services/entitlement-service';
import { ShelfTagExtractionService } from '../services/home-projects/shelf-tag-extraction-service';
import { TEMPLATE_KEYS } from '../services/home-projects/templates';
import { HomeProjectsService } from '../services/home-projects-service';
import type { Env } from '../types';

const homeProjects = new Hono<{ Bindings: Env }>();

homeProjects.use('/*', authMiddleware());

function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

function svc(c: { env: Env }): HomeProjectsService {
  return new HomeProjectsService(c.env, c.env.DB);
}

const createProjectSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  type: z
    .enum([
      'renovation',
      'replacement',
      'remodel',
      'expansion',
      'finish_refresh',
      'outdoor',
      'custom',
    ])
    .optional(),
  // Straight off the catalogue — a template added there is accepted here without
  // a second edit, and an unknown key is still a 400.
  templateKey: z.enum(TEMPLATE_KEYS).optional(),
  summary: z.string().max(4000).optional(),
  goals: z.string().max(4000).optional(),
  constraints: z.string().max(4000).optional(),
  targetBudgetCents: z.number().int().min(0).optional(),
  currency: z.string().max(8).optional(),
  contingencyPct: z.number().int().min(0).max(50).optional(),
  targetStartAt: z.string().max(40).optional(),
  targetEndAt: z.string().max(40).optional(),
  spaceIds: z.array(z.string()).max(50).optional(),
  // A wizard that lets a member plan quietly before telling the household.
  // Absent means `published`, which is what every existing client sends.
  visibility: homeProjectVisibilitySchema.optional(),
});

const patchProjectSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  type: z.string().max(40).optional(),
  status: z
    .enum(['idea', 'planning', 'ready', 'in_progress', 'on_hold', 'done', 'archived'])
    .optional(),
  summary: z.string().max(4000).nullable().optional(),
  goals: z.string().max(4000).nullable().optional(),
  constraints: z.string().max(4000).nullable().optional(),
  targetBudgetCents: z.number().int().min(0).nullable().optional(),
  currency: z.string().max(8).optional(),
  contingencyPct: z.number().int().min(0).max(50).optional(),
  targetStartAt: z.string().max(40).nullable().optional(),
  targetEndAt: z.string().max(40).nullable().optional(),
  coverAttachmentId: z.string().max(64).nullable().optional(),
  // Publish / unpublish. Not nullable — a project always has a visibility, and
  // `null` here would mean "clear it", which is not a state the column has.
  visibility: homeProjectVisibilitySchema.optional(),
});

/** `[{label, value}]` — the spec chips on an option card. */
const materialSpecSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(60),
});

/**
 * A colour the room editor can actually parse — migration 0164.
 *
 * Run through the contract's own `normalizeHexColor` rather than a fourth copy
 * of the hex regex, so what reaches D1 is always lowercase `#rrggbb` and always
 * satisfies `materialSchema.colorHex`. That matters more than it looks: ONE
 * malformed hex fails `parseRoomSurfaceModel` for the whole document, so a
 * single bad swatch costs the member the entire room editor, not one field.
 * Widening `#FFF` is deliberate for the same reason the normaliser does it —
 * a hand-rolled client sending shorthand should get a stored colour, not a 400.
 */
const hexColorSchema = z
  .string()
  .max(7)
  .transform((raw, ctx) => {
    const hex = normalizeHexColor(raw);
    if (!hex) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected a #rrggbb colour',
      });
      return z.NEVER;
    }
    return hex;
  });

/**
 * One repeat's real-world size, millimetres.
 *
 * `.max(10_000)` mirrors `materialSchema`'s bound exactly. Ten metres is past
 * any real tile or plank, so a bigger number came from a misread coverage
 * figure or a page dimension — and letting it through only moves the failure to
 * the Room Surface Model, where it costs the whole room instead of one field.
 * Not `.int()`: a 12 in tile is 304.8 mm and rounding it walks the joint line
 * visibly off across a long wall, which is why the column is REAL.
 */
const unitMmSchema = z.number().finite().positive().max(10_000);

/**
 * `YYYY-MM-DD`, and a date that exists.
 *
 * The shape check alone stores "2026-02-31", which `Date` rolls forward to
 * 3 March. The column is read back as a countdown shown to the member ("sale
 * ends in 3 days"), so a garbage date there is a countdown to nothing.
 */
const saleEndsAtSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date (YYYY-MM-DD)')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, 'Not a real calendar date');

/**
 * Appearance + offer, shared by the create and patch bodies — migration 0164.
 *
 * Every field is optional AND nullable, and both meanings are load-bearing:
 * absent means "this client predates the column", which is every client that
 * exists today, while an explicit `null` means "the member cleared it". Folding
 * the two together would either 400 every existing client or make clearing a
 * wrong colour impossible.
 */
const materialAppearanceFields = {
  colorHex: hexColorSchema.nullable().optional(),
  groutColorHex: hexColorSchema.nullable().optional(),
  unitWMm: unitMmSchema.nullable().optional(),
  unitHMm: unitMmSchema.nullable().optional(),
  /*
    The offer. Integer cents and non-negative, exactly like `unitPriceCents` —
    and, unlike it, never read by an estimate. `unit_price_cents` stays the only
    money the takeoff and the budget see; these three describe the deal beside
    it. See the note on `HomeProjectsService.createSelection`.
  */
  listPriceCents: z.number().int().min(0).nullable().optional(),
  salePriceCents: z.number().int().min(0).nullable().optional(),
  /*
    0-100. Bounded because the value is rendered as "save 62%" on the card: a
    negative percentage badges a price RISE as a saving, and anything over 100
    claims the shop pays the member to take the tile.
  */
  discountPct: z.number().int().min(0).max(100).nullable().optional(),
  saleEndsAt: saleEndsAtSchema.nullable().optional(),
};

const selectionSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(40).optional(),
  status: z.string().max(40).optional(),
  qty: z.number().int().min(0).optional(),
  unit: z.string().max(40).optional(),
  unitPriceCents: z.number().int().min(0).optional(),
  vendor: z.string().max(200).optional(),
  productUrl: z.string().url().max(2000).optional(),
  notes: z.string().max(4000).optional(),
  optionGroupId: z.string().max(64).optional(),
  brand: z.string().max(200).optional(),
  sku: z.string().max(120).optional(),
  imageUrl: z.string().url().max(2000).optional(),
  coveragePerUnit: z.number().positive().max(100_000).optional(),
  coverageUnit: z.enum(['sqft', 'm2']).optional(),
  specs: z.array(materialSpecSchema).max(10).optional(),
  /*
    Position in the materials list, for a client writing a PLAN one row at a
    time — the Smart Project wizard passes the index so the plan's order
    survives the round trip. Omitted by every member-driven add, and the
    service then puts the new material on TOP. See `topSelectionSortOrder`.

    Non-negative and bounded: the service's own prepends run below zero, so a
    client cannot claim a position ahead of them, and the cap keeps a stray
    number from parking a row where nothing can ever be added above it.
  */
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  ...materialAppearanceFields,
});

const patchSelectionSchema = selectionSchema
  // Position is a create-time fact; a PATCH that carried it would be accepted
  // and then ignored, since `updateSelection` names every column it writes.
  .omit({ sortOrder: true })
  .partial()
  .extend({
  version: z.number().int().optional(),
  unit: z.string().max(40).nullable().optional(),
  unitPriceCents: z.number().int().min(0).nullable().optional(),
  vendor: z.string().max(200).nullable().optional(),
  productUrl: z.string().url().max(2000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  optionGroupId: z.string().max(64).nullable().optional(),
  brand: z.string().max(200).nullable().optional(),
  sku: z.string().max(120).nullable().optional(),
  imageUrl: z.string().url().max(2000).nullable().optional(),
  coveragePerUnit: z.number().positive().max(100_000).nullable().optional(),
  coverageUnit: z.enum(['sqft', 'm2']).nullable().optional(),
  specs: z.array(materialSpecSchema).max(10).nullable().optional(),
  // Re-stated rather than inherited from `.partial()` so the patch body is
  // readable on its own, and so a future edit to the create rules cannot
  // silently loosen the patch ones. Same shape, same bounds.
  ...materialAppearanceFields,
});

const optionGroupSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().max(40).optional(),
  areaValue: z.number().positive().max(1_000_000).nullable().optional(),
  areaUnit: z.enum(['sqft', 'm2']).nullable().optional(),
  wasteFactorPct: z.number().int().min(0).max(100).optional(),
});

const patchOptionGroupSchema = optionGroupSchema.partial().extend({
  version: z.number().int().optional(),
});

homeProjects.get('/templates', async (c) => {
  return c.json({ templates: svc(c).listTemplates() });
});

homeProjects.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projects = await svc(c).listProjects(householdId, userId, {
    status: c.req.query('status') || undefined,
    type: c.req.query('type') || undefined,
    q: c.req.query('q') || undefined,
    spaceId: c.req.query('spaceId') || undefined,
  });
  return c.json({ projects });
});

homeProjects.post('/', zValidator('json', createProjectSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const project = await svc(c).createProject(householdId, userId, input);
  return c.json({ project }, 201);
});

homeProjects.get('/:projectId/hub', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const hub = await svc(c).getHub(householdId, userId, c.req.param('projectId'));
  return c.json(hub);
});

homeProjects.get('/:projectId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const hub = await svc(c).getHub(householdId, userId, c.req.param('projectId'));
  return c.json({
    project: hub.project,
    rollups: hub.rollups,
    space_ids: hub.space_ids,
  });
});

homeProjects.patch('/:projectId', zValidator('json', patchProjectSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const project = await svc(c).updateProject(
    householdId,
    userId,
    c.req.param('projectId'),
    c.req.valid('json')
  );
  return c.json({ project });
});

homeProjects.post('/:projectId/archive', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const project = await svc(c).archiveProject(
    householdId,
    userId,
    c.req.param('projectId')
  );
  return c.json({ project });
});

/**
 * Permanent, and the only route in this file that destroys member data. Guarded
 * at `manage` in the service, so a member with view-only access on the project
 * gets a 403 rather than a deleted renovation.
 */
homeProjects.delete('/:projectId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await svc(c).deleteProject(householdId, userId, c.req.param('projectId'));
  return c.body(null, 204);
});

// Per-project permissions — every household member with their effective role.
homeProjects.get('/:projectId/access', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const access = await svc(c).getProjectAccess(householdId, userId, c.req.param('projectId'));
  return c.json({ access });
});

// Whole-list PUT: the sheet edits several rows and saves once. See the service.
homeProjects.put(
  '/:projectId/access',
  zValidator('json', homeProjectAccessUpdateSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const access = await svc(c).setProjectAccess(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json')
    );
    return c.json({ access });
  }
);

// Selections
homeProjects.post(
  '/:projectId/selections',
  zValidator('json', selectionSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const selection = await svc(c).createSelection(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json')
    );
    return c.json({ selection }, 201);
  }
);

/**
 * Paste a shop link → a comparable option card.
 *
 * The fetch and the model call both live in the service, which degrades through
 * AI → OpenGraph → bare-URL rather than failing: the member pasted a link and
 * must end up with a row either way. `extraction` tells the client which rung it
 * landed on so the card can label its own provenance.
 */
homeProjects.post(
  '/:projectId/selections/from-link',
  zValidator(
    'json',
    z.object({
      url: z.string().url().max(2000),
      optionGroupId: z.string().max(64).optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const { selection, extraction } = await svc(c).importSelectionFromLink(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json')
    );
    return c.json({ selection, extraction }, 201);
  }
);

/**
 * Photograph a shelf label → the same option card the link path produces.
 *
 * The member is standing in an aisle holding a tile sample; the alternative is
 * typing a forty-character product name and a per-square-foot price into a phone
 * one-handed. The reading rules — a trade price is not a sale, the size lives
 * inside the product name, a per-square-foot price with no coverage is a
 * complete answer — all live in `ai/prompts/extract-shelf-tag.ts`, because none
 * of them can be recovered downstream once the model has chosen its fields.
 *
 * `getHub` runs FIRST and is the reason this route is not a straight mirror of
 * `from-link`: that path's service checks access before it spends, and this one
 * must too. It is the only public call that both proves the caller can see the
 * project and yields the project itself, whose `currency` decides whether the
 * card carries a "Listed in USD" chip. Its cost is a rounding error beside the
 * several seconds the model takes.
 *
 * The 6 MB bound matches the surface-preview route above: base64 of a ~4 MB
 * photo. Rejecting here is cheaper than rejecting after the bytes are decoded.
 */
homeProjects.post(
  '/:projectId/selections/from-shelf-tag',
  zValidator(
    'json',
    z.object({
      photoBase64: z.string().min(1).max(6_000_000),
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
      optionGroupId: z.string().max(64).optional(),
      // The member's own note about WHICH label to read ("the left one"). Fenced
      // as a hint in the prompt, never as an instruction that could add a field.
      hint: z.string().max(280).optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    await assertCanUseAI(userId, c.env);
    const householdId = getHouseholdId(c);
    const projectId = c.req.param('projectId');
    const input = c.req.valid('json');

    const { project } = await svc(c).getHub(householdId, userId, projectId);

    const reader = new ShelfTagExtractionService(c.env);
    const extraction = await reader.extractFromPhoto({
      photoBase64: input.photoBase64,
      declaredMimeType: input.mimeType ?? 'image/jpeg',
      householdId,
      userId,
      hint: input.hint,
    });

    const selection = await svc(c).createSelection(householdId, userId, projectId, {
      ...reader.toSelectionDraft(extraction, project.currency),
      status: 'idea',
      optionGroupId: input.optionGroupId,
      extractionConfidence: extraction.confidence,
    });

    return c.json(
      {
        selection,
        // Shaped like the link path's `extraction` (source + confidence) so a
        // client that already renders provenance needs no special case, plus the
        // facts a shelf tag has that a web page does not: the flat listing, the
        // appearance the preview draws from, and the offer — which is null on a
        // trade price however large the gap looked on the label.
        extraction: {
          source: 'shelf_tag_ai',
          confidence: extraction.confidence,
          notices: extraction.notices,
          listing: extraction.listing,
          appearance: extraction.appearance,
          offer: extraction.offer,
        },
      },
      201
    );
  }
);

// Option groups — "Kitchen floor", the surface several options compete for.
homeProjects.post(
  '/:projectId/option-groups',
  zValidator('json', optionGroupSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const group = await svc(c).createOptionGroup(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json')
    );
    return c.json({ option_group: group }, 201);
  }
);

homeProjects.patch(
  '/:projectId/option-groups/:groupId',
  zValidator('json', patchOptionGroupSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const group = await svc(c).updateOptionGroup(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.param('groupId'),
      c.req.valid('json')
    );
    return c.json({ option_group: group });
  }
);

homeProjects.delete('/:projectId/option-groups/:groupId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await svc(c).deleteOptionGroup(
    householdId,
    userId,
    c.req.param('projectId'),
    c.req.param('groupId')
  );
  return c.body(null, 204);
});

/** Pick the option that gets built. `selectionId: null` returns to undecided. */
homeProjects.post(
  '/:projectId/option-groups/:groupId/preferred',
  zValidator('json', z.object({ selectionId: z.string().max(64).nullable() })),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const result = await svc(c).setPreferredSelection(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.param('groupId'),
      c.req.valid('json').selectionId
    );
    return c.json({ option_group: result.group, budget_line: result.budget_line });
  }
);

homeProjects.patch(
  '/:projectId/selections/:selectionId',
  zValidator('json', patchSelectionSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const selection = await svc(c).updateSelection(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.param('selectionId'),
      c.req.valid('json')
    );
    return c.json({ selection });
  }
);

homeProjects.delete('/:projectId/selections/:selectionId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await svc(c).deleteSelection(
    householdId,
    userId,
    c.req.param('projectId'),
    c.req.param('selectionId')
  );
  return c.body(null, 204);
});

// Budget lines
homeProjects.post(
  '/:projectId/budget-lines',
  zValidator(
    'json',
    z.object({
      category: z.enum(['materials', 'labor', 'permits', 'contingency', 'other']),
      label: z.string().min(1).max(200),
      estimateCents: z.number().int().min(0).optional(),
      actualCents: z.number().int().min(0).optional(),
      selectionId: z.string().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const line = await svc(c).createBudgetLine(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json')
    );
    return c.json({ budget_line: line }, 201);
  }
);

homeProjects.patch(
  '/:projectId/budget-lines/:lineId',
  zValidator(
    'json',
    z.object({
      category: z.string().optional(),
      label: z.string().optional(),
      estimateCents: z.number().int().min(0).optional(),
      actualCents: z.number().int().min(0).optional(),
      version: z.number().int().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const line = await svc(c).updateBudgetLine(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.param('lineId'),
      c.req.valid('json')
    );
    return c.json({ budget_line: line });
  }
);

homeProjects.delete('/:projectId/budget-lines/:lineId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await svc(c).deleteBudgetLine(
    householdId,
    userId,
    c.req.param('projectId'),
    c.req.param('lineId')
  );
  return c.body(null, 204);
});

// Phases / milestones / blockers
homeProjects.post(
  '/:projectId/phases',
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200),
      startsOn: z.string().optional(),
      endsOn: z.string().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const phase = await svc(c).createPhase(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json')
    );
    return c.json({ phase }, 201);
  }
);

/**
 * Reorder BEFORE `/:phaseId`, or Hono matches `reorder` as a phase id and the
 * route below answers 404 for every drop.
 */
homeProjects.post(
  '/:projectId/phases/reorder',
  zValidator('json', z.object({ phaseIds: z.array(z.string()).max(200) })),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const phases = await svc(c).reorderPhases(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json').phaseIds
    );
    return c.json({ phases });
  }
);

homeProjects.patch(
  '/:projectId/phases/:phaseId',
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200).optional(),
      // The vocabulary the Timeline offers. `done` is the one that matters
      // beyond the badge: `smart-project.ts` splits a re-plan on
      // `DONE_PHASE_STATUSES`, so until this route existed nothing could tell
      // the model which phases were already finished.
      status: z.enum(['pending', 'in_progress', 'done']).optional(),
      startsOn: z.string().nullable().optional(),
      endsOn: z.string().nullable().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const phase = await svc(c).updatePhase(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.param('phaseId'),
      c.req.valid('json')
    );
    return c.json({ phase });
  }
);

homeProjects.delete('/:projectId/phases/:phaseId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await svc(c).deletePhase(
    householdId,
    userId,
    c.req.param('projectId'),
    c.req.param('phaseId')
  );
  return c.body(null, 204);
});

homeProjects.post(
  '/:projectId/milestones',
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200),
      phaseId: z.string().optional(),
      dueOn: z.string().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const milestone = await svc(c).createMilestone(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json')
    );
    return c.json({ milestone }, 201);
  }
);

homeProjects.post(
  '/:projectId/blockers',
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200),
      severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      notes: z.string().max(4000).optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const blocker = await svc(c).createBlocker(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json')
    );
    return c.json({ blocker }, 201);
  }
);

/** Before `/:blockerId`, for the reason on the phases reorder route. */
homeProjects.post(
  '/:projectId/blockers/reorder',
  zValidator('json', z.object({ blockerIds: z.array(z.string()).max(200) })),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const blockers = await svc(c).reorderBlockers(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json').blockerIds
    );
    return c.json({ blockers });
  }
);

homeProjects.patch(
  '/:projectId/blockers/:blockerId',
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200).optional(),
      severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      status: z.enum(['open', 'resolved']).optional(),
      notes: z.string().max(4000).nullable().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const blocker = await svc(c).updateBlocker(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.param('blockerId'),
      c.req.valid('json')
    );
    return c.json({ blocker });
  }
);

homeProjects.delete('/:projectId/blockers/:blockerId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await svc(c).deleteBlocker(
    householdId,
    userId,
    c.req.param('projectId'),
    c.req.param('blockerId')
  );
  return c.body(null, 204);
});

// Attachments
homeProjects.post(
  '/:projectId/attachments/upload-url',
  zValidator(
    'json',
    z.object({
      filename: z.string().min(1),
      file_size: z.number().positive(),
      content_type: z.enum([
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
      ]),
      // `texture` and `reference` are the two material-scoped kinds. Both were
      // reachable from the client and NEITHER was in this enum, so the Worker
      // 400'd every one of them: a surface swatch worked on a local-first
      // household (the ledger validates nothing) and failed on a server-backed
      // one. Same shape of bug as the `status` CHECK — the permissive side is
      // the one that gets exercised, so the strict side rots unnoticed.
      kind: z
        .enum([
          'photo',
          'file',
          'link',
          'plan_ref',
          'scan',
          'schematic',
          'texture',
          'reference',
        ])
        .optional(),
      selectionId: z.string().optional(),
      tags: z.array(z.enum(['before', 'after'])).max(2).optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const input = c.req.valid('json');
    const result = await svc(c).createAttachmentUpload(
      householdId,
      userId,
      c.req.param('projectId'),
      {
        filename: input.filename,
        fileSize: input.file_size,
        contentType: input.content_type,
        kind: input.kind,
        selectionId: input.selectionId,
        tags: input.tags,
      }
    );
    return c.json({
      attachment_id: result.attachment.id,
      upload_url: result.upload_url,
      attachment: result.attachment,
    });
  }
);

homeProjects.put('/:projectId/attachments/:attachmentId/upload', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const bytes = await c.req.arrayBuffer();
  const contentType = c.req.header('content-type') || 'application/octet-stream';
  const attachment = await svc(c).uploadAttachmentBytes(
    householdId,
    userId,
    c.req.param('projectId'),
    c.req.param('attachmentId'),
    bytes,
    contentType
  );
  return c.json({ attachment });
});

// Plan links + geometry
homeProjects.post(
  '/:projectId/plan-links',
  zValidator(
    'json',
    z.object({
      floorPlanId: z.string().min(1),
      zonePayload: z.unknown().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const planLink = await svc(c).createPlanLink(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json')
    );
    return c.json({ plan_link: planLink }, 201);
  }
);

homeProjects.put('/:projectId/geometry/manual', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const payload = await c.req.json();
  const geometry = await svc(c).putManualGeometry(
    householdId,
    userId,
    c.req.param('projectId'),
    payload
  );
  return c.json({ geometry });
});

homeProjects.get('/:projectId/geometry', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const hub = await svc(c).getHub(householdId, userId, c.req.param('projectId'));
  return c.json({ geometry: hub.geometry });
});

homeProjects.post('/:projectId/geometry/roomplan', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const payload = await c.req.json();
  const geometry = await svc(c).putRoomPlanGeometry(
    householdId,
    userId,
    c.req.param('projectId'),
    payload
  );
  return c.json({ geometry }, 201);
});

homeProjects.post(
  '/:projectId/geometry/ai-schematic',
  zValidator(
    'json',
    z.object({ attachmentIds: z.array(z.string()).max(8).optional() }).optional()
  ),
  async (c) => {
    const userId = c.get('userId');
    await assertCanUseAI(userId, c.env);
    const householdId = getHouseholdId(c);
    const body = c.req.valid('json') || {};
    const geometry = await svc(c).enqueueAiSchematic(
      householdId,
      userId,
      c.req.param('projectId'),
      body.attachmentIds
    );
    return c.json({ geometry }, 202);
  }
);

homeProjects.post('/:projectId/geometry/:geometryId/cancel', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const geometry = await svc(c).cancelGeometryJob(
    householdId,
    userId,
    c.req.param('projectId'),
    c.req.param('geometryId')
  );
  return c.json({ geometry });
});

// ---------------------------------------------------------------------------
// Smart Project — describe-to-draft (migration 0166)
// ---------------------------------------------------------------------------

/**
 * Start a draft from a description.
 *
 * Creates the project as `visibility='draft'` and returns 202 — generation runs
 * on the queue. The project exists immediately so the client has somewhere to
 * navigate to and poll, but it is private to its creator until they publish.
 *
 * Note the shape: dimensions are accepted, photos are accepted, and there is no
 * field anywhere for an area, a quantity or a price. See
 * `@symply/contracts/smart-project`.
 */
homeProjects.post(
  '/smart-draft',
  zValidator(
    'json',
    z.object({
      description: z.string().min(20).max(4000),
      spaces: z
        .array(
          z.object({
            label: z.string().min(1).max(80),
            length_m: z.number().min(0.5).max(60),
            width_m: z.number().min(0.5).max(60),
            /** At the wall, not the peak. */
            height_m: z.number().min(1.4).max(12),
            /** Floor to ridge, for a space open to a pitched roof. */
            ridge_height_m: z.number().min(1.4).max(14).optional(),
          })
        )
        .max(8)
        .optional(),
      attachment_ids: z.array(z.string()).max(SMART_PROJECT_MAX_PHOTOS).optional(),
      space_id: z.string().nullable().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    await assertCanUseAI(userId, c.env);
    const householdId = getHouseholdId(c);
    const result = await svc(c).enqueueSmartDraft(
      householdId,
      userId,
      c.req.valid('json')
    );
    return c.json(result, 202);
  }
);

/**
 * `POST /smart-draft/generate` — think, do not store.
 *
 * Returns the drafted plan and writes NOTHING. The client saves it through
 * `homeProjectsApi`, which routes to the device ledger on a local-first
 * household and to D1 on a server-backed one — so the same endpoint serves
 * both, and a drafted project always lands where that household's projects
 * actually live.
 *
 * This replaces the write-through queue path for the client. That path wrote
 * the project into D1 directly, which on House — local-first by default —
 * produced a project the member's own phone could never open, and was why the
 * feature had to be hidden from everybody. See BRD §12 Q4.
 *
 * Synchronous on purpose: a Worker's 30s ceiling is CPU time, and waiting on a
 * provider is not CPU.
 */
homeProjects.post(
  '/smart-draft/generate',
  zValidator(
    'json',
    z.object({
      description: z.string().min(20).max(4000),
      spaces: z
        .array(
          z.object({
            label: z.string().min(1).max(80),
            length_m: z.number().min(0.5).max(60),
            width_m: z.number().min(0.5).max(60),
            height_m: z.number().min(1.4).max(12),
            ridge_height_m: z.number().min(1.4).max(14).optional(),
          })
        )
        .max(8)
        .optional(),
      attachment_ids: z.array(z.string()).max(SMART_PROJECT_MAX_PHOTOS).optional(),
      // Keys handed back by `POST /smart-draft/photos`. Separate from
      // `attachment_ids` rather than overloaded into it: those are rows on a
      // project that exists, these are loose R2 objects for a project that does
      // not. One field carrying two kinds of identifier would make the
      // household check on each of them easy to get wrong.
      //
      // The cap is the SHARED constant, not a literal. A client offering more
      // than the route accepts does not lose the extra photos — zod rejects the
      // whole body, so the member loses the generation.
      photo_keys: z.array(z.string().max(300)).max(SMART_PROJECT_MAX_PHOTOS).optional(),
      // Re-plan. Sent by the client rather than read from D1, because on a
      // local-first household these phases only exist in the device ledger —
      // a server-side load would work on the households this feature is least
      // used on and quietly return nothing everywhere else.
      existing: z
        .object({
          title: z.string().min(1).max(200),
          target_use: z.string().max(80).nullish(),
          phases: z
            .array(
              z.object({
                title: z.string().min(1).max(200),
                status: z.string().max(40),
              })
            )
            .max(60),
        })
        .optional(),
      // What the member ticked in the wizard's last step. Absent means all
      // three, which is what every client sent before the step existed — an
      // older build must keep getting the whole draft rather than an empty one.
      include: smartProjectIncludeSchema.optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    await assertCanUseAI(userId, c.env);
    const householdId = getHouseholdId(c);
    const body = c.req.valid('json');

    const plan = await svc(c).generateSmartProjectPlan(householdId, userId, {
      description: body.description,
      spaces: body.spaces ?? [],
      attachmentIds: body.attachment_ids ?? [],
      photoKeys: body.photo_keys ?? [],
      existing: body.existing
        ? {
            title: body.existing.title,
            targetUse: body.existing.target_use ?? null,
            phases: body.existing.phases,
          }
        : undefined,
      include: body.include,
    });

    if (!plan) {
      // Reached only after the generator has ALREADY retried once (see
      // `generateSmartProjectPlan`). This comment used to claim malformed
      // generation was permanent — "the same prompt against the same model
      // reproduces it" — and the suite disproved it: the same shed description
      // drafted fine twice and 422'd once. Sampling is stochastic. Two failed
      // samples is weak evidence the prompt itself is unsatisfiable, which is
      // why the copy still points at rewording rather than at retrying.
      return c.json(
        { error: { code: 'malformed_generation', message: 'Could not draft that project. Try describing it differently.' } },
        422
      );
    }
    return c.json({ plan });
  }
);

/**
 * `POST /smart-draft/photos` — one photo for a project that does not exist yet.
 *
 * Raw bytes, `Content-Type` says what they are, and the reply is the R2 key to
 * pass to `/smart-draft/generate`. There is no create-then-PUT step because
 * there is no row to create: `home_project_attachments.project_id` is NOT NULL,
 * and the project is what the member is asking the model to draft.
 *
 * The object is deleted as soon as the plan is generated — see
 * `purgeSmartDraftPhotos`.
 */
homeProjects.post('/smart-draft/photos', async (c) => {
  const userId = c.get('userId');
  // Same gate as generation: a photo is only ever an input to an AI call, so a
  // member who cannot generate must not be able to fill R2 either.
  await assertCanUseAI(userId, c.env);
  const householdId = getHouseholdId(c);
  const bytes = await c.req.arrayBuffer();
  const contentType = c.req.header('content-type') || '';
  const result = await svc(c).uploadSmartDraftPhoto(
    householdId,
    userId,
    bytes,
    contentType
  );
  return c.json(result, 201);
});

homeProjects.get('/:projectId/smart-draft', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const draft = await svc(c).getSmartDraft(
    householdId,
    userId,
    c.req.param('projectId')
  );
  return c.json({ draft });
});

homeProjects.post('/:projectId/smart-draft/:draftId/cancel', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const draft = await svc(c).cancelSmartDraft(
    householdId,
    userId,
    c.req.param('projectId'),
    c.req.param('draftId')
  );
  return c.json({ draft });
});

/**
 * Publish a reviewed draft to the household.
 *
 * The only route that makes a Smart Project visible to anyone but its creator,
 * and the only one that turns its generated tasks into real House tasks.
 */
homeProjects.post('/:projectId/publish', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const project = await svc(c).publishSmartDraft(
    householdId,
    userId,
    c.req.param('projectId')
  );
  return c.json({ project });
});

// ---- as-is state ----------------------------------------------------------

homeProjects.get('/:projectId/as-is', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const as_is = await svc(c).listAsIs(
    householdId,
    userId,
    c.req.param('projectId')
  );
  return c.json({ as_is });
});

homeProjects.put(
  '/:projectId/as-is',
  zValidator(
    'json',
    z.object({
      element: z.string().min(1),
      state: z.enum(['present', 'absent', 'unknown']),
      evidence: z.string().max(400).nullable().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const entry = await svc(c).upsertAsIs(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json')
    );
    return c.json({ as_is: entry });
  }
);

homeProjects.delete('/:projectId/as-is/:asIsId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const result = await svc(c).deleteAsIs(
    householdId,
    userId,
    c.req.param('projectId'),
    c.req.param('asIsId')
  );
  return c.json(result);
});

/**
 * Photoreal preview of one surface.
 *
 * A **decision aid, not a measurement** — every quantity a member orders
 * against comes from the stored geometry, and this route reads that same
 * geometry to compute the scale facts it holds the model to. See
 * `services/home-projects/surface-preview.ts`.
 *
 * `layoutPngBase64` is the scale-true drawing captured from the device canvas.
 * Optional: without it the preview is prompt-only and less faithful, which the
 * response reports through `used_layout_reference` rather than pretending
 * otherwise. The 6 MB bound is base64 of the 4 MB raw cap the service enforces
 * — a rejection here is cheaper than one after the bytes have been decoded.
 */
homeProjects.post(
  '/:projectId/surfaces/:surfaceId/preview',
  zValidator(
    'json',
    z
      .object({ layoutPngBase64: z.string().max(6_000_000).optional() })
      .optional()
  ),
  async (c) => {
    const userId = c.get('userId');
    await assertCanUseAI(userId, c.env);
    const householdId = getHouseholdId(c);
    const body = c.req.valid('json') || {};
    const result = await svc(c).generateSurfacePreview(
      householdId,
      userId,
      c.req.param('projectId'),
      {
        surfaceId: c.req.param('surfaceId'),
        layoutPngBase64: body.layoutPngBase64,
      }
    );
    return c.json(
      {
        attachment: result.attachment,
        // The brief goes back so the app can show the member exactly what the
        // picture was told, beside the picture. A render with no statement of
        // its instructions is indistinguishable from one that had none.
        brief: result.brief,
        model: result.model,
      },
      201
    );
  }
);

homeProjects.post('/:projectId/export.pdf', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const result = await svc(c).exportProjectSummary(
    householdId,
    userId,
    c.req.param('projectId')
  );
  return c.json(result);
});

homeProjects.get('/:projectId/exports/:exportId/pdf', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const exportId = c.req.param('exportId');
  const file = await svc(c).getExportPdf(householdId, userId, projectId, exportId);
  return new Response(file.body, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
    },
  });
});

// Comments / activity / tasks / contractors
homeProjects.post(
  '/:projectId/comments',
  zValidator(
    'json',
    z.object({
      body: z.string().min(1).max(4000),
      selectionId: z.string().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const comment = await svc(c).addComment(
      householdId,
      userId,
      c.req.param('projectId'),
      c.req.valid('json')
    );
    return c.json({ comment }, 201);
  }
);

homeProjects.get('/:projectId/activity', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const result = await svc(c).listActivity(
    householdId,
    userId,
    c.req.param('projectId'),
    c.req.query('cursor') || undefined,
    Number(c.req.query('limit') || 50)
  );
  return c.json(result);
});

homeProjects.get('/:projectId/tasks', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const tasks = await svc(c).listLinkedTasks(
    householdId,
    userId,
    c.req.param('projectId')
  );
  return c.json({ tasks });
});

homeProjects.post(
  '/:projectId/tasks',
  zValidator(
    'json',
    z
      .object({
        taskId: z.string().min(1).optional(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
      })
      .refine((v) => Boolean(v.taskId || v.title), {
        message: 'taskId or title is required',
      })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const body = c.req.valid('json');
    if (body.taskId) {
      const link = await svc(c).linkTask(
        householdId,
        userId,
        c.req.param('projectId'),
        body.taskId
      );
      return c.json({ link }, 201);
    }
    const link = await svc(c).createTaskFromProject(
      householdId,
      userId,
      c.req.param('projectId'),
      { title: body.title!, description: body.description }
    );
    return c.json({ link }, 201);
  }
);

homeProjects.post(
  '/:projectId/contractors',
  zValidator(
    'json',
    z.object({
      contractorId: z.string().min(1),
      quoteId: z.string().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const input = c.req.valid('json');
    const link = await svc(c).linkContractor(
      householdId,
      userId,
      c.req.param('projectId'),
      input.contractorId,
      input.quoteId
    );
    return c.json({ link }, 201);
  }
);

export default homeProjects;
