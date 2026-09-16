import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

import { households, users } from './schema';

/**
 * Home Projects — household renovation / improvement planning.
 * Distinct from Labor Hub `projects` (contractor jobs). See migration 0105.
 */

export const homeProjects = sqliteTable(
  'home_projects',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    type: text('type').notNull().default('renovation'),
    template_key: text('template_key'),
    status: text('status').notNull().default('planning'),
    /**
     * `'draft' | 'published'` — whether anyone but `created_by` can see this at
     * all (migration 0163). Orthogonal to `status`, which is where the WORK is;
     * a draft can be `in_progress` and a published project can be an `idea`.
     */
    visibility: text('visibility').notNull().default('published'),
    /**
     * `'owner' | 'viewer'` — the role a household member with no explicit grant
     * gets. `'owner'` by default because that is what every member effectively
     * had before 0163.
     */
    default_role: text('default_role').notNull().default('owner'),
    /**
     * `[{ user_id, role }]`, explicit overrides only; NULL means "none".
     * Parsed exclusively through `parseHomeProjectAccessGrants` in
     * `@symply/contracts` so the Worker and the device ledger cannot disagree
     * about who may edit.
     */
    access_json: text('access_json'),
    summary: text('summary'),
    goals: text('goals'),
    constraints: text('constraints'),
    target_budget_cents: integer('target_budget_cents'),
    currency: text('currency').notNull().default('USD'),
    contingency_pct: integer('contingency_pct').notNull().default(15),
    target_start_at: text('target_start_at'),
    target_end_at: text('target_end_at'),
    cover_attachment_id: text('cover_attachment_id'),
    /**
     * The change-of-use target — "woodworking shop", "home gym" (migration 0166).
     * NULL for a like-for-like renovation, which is most projects. On the row
     * rather than buried in `summary` because it DRIVES requirements a
     * room-type template cannot express (dust extraction, circuit load, task
     * lighting), and a pack keyed off prose would re-parse it on every read.
     */
    target_use: text('target_use'),
    /**
     * The project's own jobs, as `["task_a","task_b"]` (migration 0170).
     *
     * Replaces the `home_project_tasks` join table, which had no primary key
     * and so could not be ledgered (hazard S2). Same call as `access_json`
     * above and as `projects.linked_task_ids` before it: a short list, read as
     * a block with its parent, never queried across projects.
     *
     * NULL means "no linked tasks" and is stored in preference to `'[]'`.
     * Parsed exclusively through `parseHomeProjectLinkedTaskIds` in
     * `@symply/contracts`, so the Worker and the device ledger cannot disagree
     * about what a malformed value means.
     */
    linked_task_ids: text('linked_task_ids'),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    updated_by: text('updated_by'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byHousehold: index('hp_by_household').on(t.household_id),
    byHouseholdStatus: index('hp_by_household_status').on(t.household_id, t.status),
    byHouseholdVisibility: index('hp_by_household_visibility').on(
      t.household_id,
      t.visibility
    ),
  })
);

export const homeProjectSpaces = sqliteTable(
  'home_project_spaces',
  {
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    space_id: text('space_id').notNull(),
  },
  (t) => ({
    byProject: index('hps_by_project').on(t.project_id),
  })
);

export const homeProjectBudgetLines = sqliteTable(
  'home_project_budget_lines',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    category: text('category').notNull().default('other'),
    label: text('label').notNull(),
    estimate_cents: integer('estimate_cents').notNull().default(0),
    actual_cents: integer('actual_cents').notNull().default(0),
    selection_id: text('selection_id'),
    sort_order: integer('sort_order').notNull().default(0),
    version: integer('version').notNull().default(1),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpbl_by_project').on(t.project_id),
  })
);

/**
 * A surface being decided — "Kitchen floor", "Master bath tile" — under which
 * several `homeProjectSelections` compete. See migration 0162.
 *
 * The group owns the area, because one project routinely prices two floors and
 * `category` cannot carry two of anything. It also owns the winner, as an id
 * rather than a flag on the option, so "exactly one preferred" is a property of
 * the schema instead of an invariant the service has to keep remembering.
 */
export const homeProjectOptionGroups = sqliteTable(
  'home_project_option_groups',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').notNull().default('finish'),
    /** NULL for per-piece groups (five faucets); the card must not invent a total. */
    area_value: real('area_value'),
    /** 'm2' | 'sqft' — stored as entered; arithmetic normalises to m². */
    area_unit: text('area_unit'),
    /** 'manual' | 'geometry' — a floor-plan prefill is a hint, not measured truth. */
    area_source: text('area_source').notNull().default('manual'),
    waste_factor_pct: integer('waste_factor_pct').notNull().default(10),
    preferred_selection_id: text('preferred_selection_id'),
    /**
     * `'manual' | 'smart_project'` (migration 0166) — badges the card until the
     * member edits it. Provenance is not cosmetic: it is what lets someone
     * scrolling a plausible-looking plan tell which rows nobody has checked.
     */
    draft_source: text('draft_source').notNull().default('manual'),
    draft_confidence: text('draft_confidence'),
    sort_order: integer('sort_order').notNull().default(0),
    version: integer('version').notNull().default(1),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpog_by_project').on(t.project_id),
  })
);

export const homeProjectSelections = sqliteTable(
  'home_project_selections',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').notNull().default('other'),
    status: text('status').notNull().default('idea'),
    qty: integer('qty').notNull().default(1),
    unit: text('unit'),
    unit_price_cents: integer('unit_price_cents'),
    vendor: text('vendor'),
    product_url: text('product_url'),
    surface_ref: text('surface_ref'),
    notes: text('notes'),
    assignee_user_id: text('assignee_user_id'),
    /** NULL = standalone selection, i.e. every row predating migration 0162. */
    option_group_id: text('option_group_id'),
    brand: text('brand'),
    sku: text('sku'),
    /** Vendor's photo URL; the durable copy is an attachment row and wins on the card. */
    image_url: text('image_url'),
    /** What one purchasable unit covers — 20 sqft/box. Turns shelf price into floor price. */
    coverage_per_unit: real('coverage_per_unit'),
    coverage_unit: text('coverage_unit'),
    /** `[{ label, value }]`, ordered, already member-facing. */
    specs_json: text('specs_json'),
    /**
     * Appearance, for the surface preview. See migration 0164.
     *
     * `color_hex` is what `materialSchema.colorHex` requires — a finish with no
     * colour renders as a hole in the room. `unit_*_mm` is the real size of ONE
     * repeat, and REAL rather than INTEGER because a 12 in tile is 304.8 mm and
     * rounding it walks the joint line off across a long wall. Both NULL when
     * the page stated no size: a guessed repeat makes the preview lie.
     */
    color_hex: text('color_hex'),
    grout_color_hex: text('grout_color_hex'),
    unit_w_mm: real('unit_w_mm'),
    unit_h_mm: real('unit_h_mm'),
    /**
     * The offer. `unit_price_cents` above stays the ONLY money an estimate
     * reads; these three describe the deal and mirror it. A sale price written
     * into `unit_price_cents` would be right until the sale ended and then
     * wrong in a stored number nobody re-reads.
     */
    list_price_cents: integer('list_price_cents'),
    sale_price_cents: integer('sale_price_cents'),
    /** 0-100, derived from the two prices — never copied off a stale badge. */
    discount_pct: integer('discount_pct'),
    /** ISO date. NULL = no end date published, NOT "no sale". */
    sale_ends_at: text('sale_ends_at'),
    /** 'manual' | 'link_og' | 'link_ai' — shown on the card; provenance is not cosmetic. */
    extraction_source: text('extraction_source').notNull().default('manual'),
    extraction_confidence: text('extraction_confidence'),
    sort_order: integer('sort_order').notNull().default(0),
    version: integer('version').notNull().default(1),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpsel_by_project').on(t.project_id),
    byGroup: index('hpsel_by_group').on(t.option_group_id),
  })
);

export const homeProjectPhases = sqliteTable(
  'home_project_phases',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('pending'),
    starts_on: text('starts_on'),
    ends_on: text('ends_on'),
    /** `'manual' | 'smart_project'` — see `homeProjectOptionGroups.draft_source`. */
    draft_source: text('draft_source').notNull().default('manual'),
    draft_confidence: text('draft_confidence'),
    sort_order: integer('sort_order').notNull().default(0),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpph_by_project').on(t.project_id),
  })
);

export const homeProjectMilestones = sqliteTable(
  'home_project_milestones',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    phase_id: text('phase_id'),
    title: text('title').notNull(),
    due_on: text('due_on'),
    done_at: text('done_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpm_by_project').on(t.project_id),
  })
);

export const homeProjectBlockers = sqliteTable(
  'home_project_blockers',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    severity: text('severity').notNull().default('medium'),
    status: text('status').notNull().default('open'),
    notes: text('notes'),
    resolved_at: text('resolved_at'),
    /** `'manual' | 'smart_project'` — see `homeProjectOptionGroups.draft_source`. */
    draft_source: text('draft_source').notNull().default('manual'),
    draft_confidence: text('draft_confidence'),
    /** Migration 0171 — the member's own order, same meaning as on phases. */
    sort_order: integer('sort_order').notNull().default(0),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpb_by_project').on(t.project_id),
  })
);

export const homeProjectAttachments = sqliteTable(
  'home_project_attachments',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    selection_id: text('selection_id'),
    kind: text('kind').notNull().default('photo'),
    r2_key: text('r2_key'),
    url: text('url'),
    filename: text('filename'),
    content_type: text('content_type'),
    file_size: integer('file_size'),
    caption: text('caption'),
    tags: text('tags'),
    status: text('status').notNull().default('pending_upload'),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpa_by_project').on(t.project_id),
  })
);

export const homeProjectPlanLinks = sqliteTable(
  'home_project_plan_links',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    floor_plan_id: text('floor_plan_id').notNull(),
    zone_payload: text('zone_payload'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hppl_by_project').on(t.project_id),
  })
);

export const homeProjectGeometry = sqliteTable(
  'home_project_geometry',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('manual'),
    status: text('status').notNull().default('completed'),
    schema_version: integer('schema_version').notNull().default(1),
    payload_json: text('payload_json'),
    confidence: text('confidence'),
    disclaimer: text('disclaimer'),
    error_code: text('error_code'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpg_by_project').on(t.project_id),
  })
);

export const homeProjectComments = sqliteTable(
  'home_project_comments',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    selection_id: text('selection_id'),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpc_by_project').on(t.project_id, t.created_at),
  })
);

export const homeProjectActivity = sqliteTable(
  'home_project_activity',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    actor_user_id: text('actor_user_id'),
    action: text('action').notNull(),
    entity_type: text('entity_type'),
    entity_id: text('entity_id'),
    meta_json: text('meta_json'),
    idempotency_key: text('idempotency_key'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpact_by_project').on(t.project_id, t.created_at),
  })
);

/**
 * `home_project_tasks` USED TO BE HERE, and is gone as of migration 0170.
 *
 * It was a PK-less join (`project_id`, `task_id`, `created_at`) — hazard S2 in
 * the local-first plan — so a local-first household could not hold a project's
 * own tasks at all, and three `homeProjectsApi` methods refused on device. The
 * link now lives on the parent as `home_projects.linked_task_ids`, the same
 * shape `projects.linked_task_ids` has carried since migration 0061.
 *
 * `home_project_contractors` below is the SAME hazard and is deliberately NOT
 * moved with it: `quote_id` makes it a link with a payload rather than a pure
 * join, so it wants its own decision rather than this one applied by analogy.
 * It stays in `HOUSE_S2_DEFERRED_TABLES` with `home_project_spaces`.
 */
export const homeProjectContractors = sqliteTable(
  'home_project_contractors',
  {
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    contractor_id: text('contractor_id').notNull(),
    quote_id: text('quote_id'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpco_by_project').on(t.project_id),
  })
);

/**
 * What already EXISTS on the project's space — migration 0166.
 *
 * The table Smart Project could not do without. A generated plan that does not
 * know the shed already has a roof will plan roofing, and the member then has
 * to delete a phase that looks entirely reasonable. Recording the starting
 * state is what turns "here is a renovation" into "here is what YOU still need".
 *
 * `state` is `'present' | 'absent' | 'unknown'`, and `unknown` is load-bearing:
 * it becomes a question for the member instead of an assumption in either
 * direction.
 */
export const homeProjectAsIs = sqliteTable(
  'home_project_as_is',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    /** One of `AS_IS_ELEMENTS` in `@symply/contracts`. */
    element: text('element').notNull(),
    state: text('state').notNull().default('unknown'),
    /** The member's own words that decided this, so review can show its reason. */
    evidence: text('evidence'),
    /** `'manual' | 'smart_project'` — a member's correction stops being AI output. */
    source: text('source').notNull().default('manual'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpai_by_project').on(t.project_id),
  })
);

/**
 * One describe-to-draft generation — migration 0166.
 *
 * Deliberately the same shape as the `home_project_geometry` AI-schematic row
 * (status / confidence / disclaimer / error_code): that pattern already has a
 * queue consumer, a retry policy and a cron stuck-row sweep written against it,
 * and a second job shape would need all three again.
 *
 * `spaces_json` holds the dimensions the member TYPED. Every area in the
 * resulting draft is computed from this column by shared contract code — the
 * model is never asked to multiply. Keeping the input means regeneration does
 * not ask for measurements twice.
 */
export const homeProjectSmartDrafts = sqliteTable(
  'home_project_smart_drafts',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => homeProjects.id, { onDelete: 'cascade' }),
    /** `'generating' | 'completed' | 'failed' | 'cancelled'`. */
    status: text('status').notNull().default('generating'),
    description: text('description').notNull(),
    spaces_json: text('spaces_json'),
    attachment_ids_json: text('attachment_ids_json'),
    confidence: text('confidence'),
    disclaimer: text('disclaimer'),
    error_code: text('error_code'),
    /** Phases suppressed by as-is state, so review can explain the gap. */
    dropped_json: text('dropped_json'),
    /**
     * Generated tasks, held here rather than written to `tasks`. A House task
     * is household-shared the moment it exists, so materialising a draft's
     * tasks would put work in everyone's list for a project nobody else can
     * see. `publishSmartDraft` turns them into real tasks; nothing else does.
     */
    tasks_json: text('tasks_json'),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byProject: index('hpsd_by_project').on(t.project_id),
    byStatusUpdated: index('hpsd_by_status_updated').on(t.status, t.updated_at),
  })
);

export type HomeProject = typeof homeProjects.$inferSelect;
export type HomeProjectAsIs = typeof homeProjectAsIs.$inferSelect;
export type HomeProjectSmartDraft = typeof homeProjectSmartDrafts.$inferSelect;
export type NewHomeProject = typeof homeProjects.$inferInsert;
export type HomeProjectSelection = typeof homeProjectSelections.$inferSelect;
export type HomeProjectOptionGroup = typeof homeProjectOptionGroups.$inferSelect;
export type HomeProjectBudgetLine = typeof homeProjectBudgetLines.$inferSelect;
export type HomeProjectPhase = typeof homeProjectPhases.$inferSelect;
export type HomeProjectMilestone = typeof homeProjectMilestones.$inferSelect;
export type HomeProjectBlocker = typeof homeProjectBlockers.$inferSelect;
export type HomeProjectAttachment = typeof homeProjectAttachments.$inferSelect;
export type HomeProjectPlanLink = typeof homeProjectPlanLinks.$inferSelect;
export type HomeProjectGeometry = typeof homeProjectGeometry.$inferSelect;
export type HomeProjectComment = typeof homeProjectComments.$inferSelect;
export type HomeProjectActivityRow = typeof homeProjectActivity.$inferSelect;
