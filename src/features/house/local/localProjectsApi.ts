/**
 * Local `projects` — the ledger counterpart of `src/api/projects.ts` (plan §11,
 * sub-wave B3).
 *
 * **This module owns `projects`, the labor-hub table, and NOT `home_projects`.**
 * Those are two different features that share an English word: `projects`
 * (`schema-labor-hub.ts:184`) is the job a household commissioned from a
 * contractor, usually out of an accepted quote, and is what `projectsApi`,
 * `ProjectsScreen` and `useHomeDashboard`'s active-project cards read.
 * `home_projects` (`schema-home-projects.ts`) is the C4 renovation planner with
 * its own fourteen tables, its own api module and its own facade one day. The
 * registry keeps them apart by prefix alone (`projects` vs `homeProjects`), so
 * this is the second-easiest mistake to make in Wave B after B2's two quote
 * tables.
 *
 * **All 16 methods are local. There is no gap, and that is a finding.** The
 * brief for this sub-wave expected `projectProgressPhotos` to force an H6 throw
 * site, on the reasonable assumption that a photo table implies an upload
 * method. `projectsApi` has none: `addProgressPhoto` takes a `photo_key` a
 * caller obtained elsewhere and writes a metadata ROW, exactly as
 * `contractorsApi.createDocument` does. B1 settled the principle — the document
 * row is ledgered and only moving the bytes needs the encrypted blob channel —
 * and the same split applies here, so the caption, the tags, the milestone the
 * photo belongs to and when it was taken all work offline. Nothing in this
 * module runs a model or reaches R2, so `unsupportedCopy.ts` gained no entry;
 * `unsupportedCopy.test.ts` would fail on copy for a method that never throws.
 *
 * **The delete is the reason this sub-wave is more than a registry edit.** D1
 * cascades `project_milestones`, `project_payments` and
 * `project_progress_photos` from `projects`. A ledger delete is a tombstone,
 * not a foreign key, so nothing enforces that on device and an orphan is
 * forever: it syncs to every peer and is never read. `deleteProject` therefore
 * removes the project AND its three child tables in ONE op, so a peer applies
 * the whole removal or none of it. Half-applying it would leave a peer holding
 * payments belonging to a project that no longer exists — which is how a
 * "total paid" figure survives the job it was paid for.
 *
 * **`ProjectWithDetails` is composed, never stored.** The contractor join, the
 * three child arrays and the entire `progress` block are rebuilt on every read.
 * `progress` is the interesting one: D1 has a `total_spent_cents` COLUMN that
 * `markPaymentPaid` recomputes and writes, and ledgering it would be the
 * derived-collection rule's exact failure mode — two members settle two
 * different payments offline, per-field LWW picks one device's total, and the
 * answer is then wrong on both. So `total_spent_cents` is deliberately absent
 * from `LocalProject` (the client DTO omits it too) and the sum is recomputed
 * from the payment rows, which is what `projectStore.updateProjectProgress`
 * already does to the server's response anyway.
 *
 * **Three DTO-vs-D1 divergences, all pre-existing, all documented on the types**
 * (`types.ts`): the client's `linked_report_ids` (plural, JSON) against D1's
 * `linked_report_id` (singular FK); `ProjectPayment.title`, which the client
 * requires and D1 does not have; and `progress.totalAmount`, which the client
 * declares and the Worker answers as `remainingAmount`. In each case the ledger
 * satisfies the CLIENT type, because that is the type `tsc` checks and the type
 * the screens read — the same call B2 made for `QuoteWithDetails.phone`.
 *
 * **Money is integer cents throughout** (`total_budget_cents`, `amount_cents`),
 * like `quotes` and unlike `contractor_visits.cost`. Nothing here divides by
 * 100 — the row IS the DTO and the screens format it.
 *
 * **No bulk path**, deliberately: every write is one row, or one row plus its
 * cascade, so `writeLocalBulk` is unused. The one multi-row write is
 * `deleteProject`, and a delete op carries row keys rather than row bodies, so
 * it is one op regardless of how many milestones the project had.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import { SPECIALTY_INFO, type ContractorSpecialty } from '@api/contractors';
import type {
  MilestoneStatus,
  PaymentStatus,
  PaymentType,
  ProjectStatus,
  ProjectWithDetails,
} from '@api/projects';

import { HouseLocalUnknownPropertyError } from './errors';
import { newLocalId } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal } from './localWrite';
import type {
  LocalContractor,
  LocalProject,
  LocalProjectMilestone,
  LocalProjectPayment,
  LocalProjectProgressPhoto,
} from './types';

// ---------------------------------------------------------------------------
// Input shapes — mirrors of the module-private request types in
// `src/api/projects.ts`. They are not exported there, so they are restated
// rather than imported; `apiParity.test.ts` catches a method that disappears
// and `tsc` catches a field whose type changed on the DTO.
// ---------------------------------------------------------------------------

export type CreateLocalProjectInput = {
  contractor_id: string;
  quote_id?: string;
  title: string;
  description?: string;
  start_date?: string;
  estimated_end_date?: string;
  total_budget_cents?: number;
  notes?: string;
  linked_report_ids?: string[];
  linked_task_ids?: string[];
};

/**
 * The remote `UpdateProjectRequest` also declares `linked_report_ids` and
 * `linked_task_ids`. They are omitted here because `ProjectService.updateProject`
 * accepts neither and `updateProjectSchema` declares neither — the server drops
 * them in transit, so applying them on device would make the same edit take
 * effect for one household and vanish for another. B2 narrowed
 * `UpdateLocalQuoteInput` the same way and for the same reason: the drop is
 * better stated in the type than hidden in the patch builder.
 *
 * The reverse asymmetry exists too and is also left alone: the server accepts
 * `total_spent_cents` on update, the client type does not declare it, and the
 * ledger does not store it at all (see the header).
 */
export type UpdateLocalProjectInput = {
  title?: string;
  description?: string;
  status?: ProjectStatus;
  start_date?: string;
  estimated_end_date?: string;
  actual_end_date?: string;
  total_budget_cents?: number;
  notes?: string;
};

export type LocalProjectFilters = {
  contractor_id?: string;
  status?: ProjectStatus;
};

export type CreateLocalMilestoneInput = {
  title: string;
  description?: string;
  due_date?: string;
  notes?: string;
};

export type UpdateLocalMilestoneInput = {
  title?: string;
  description?: string;
  status?: MilestoneStatus;
  due_date?: string;
  completed_date?: string;
  notes?: string;
  sort_order?: number;
};

export type CreateLocalPaymentInput = {
  type: PaymentType;
  title: string;
  amount_cents: number;
  due_date?: string;
  notes?: string;
};

export type UpdateLocalPaymentInput = {
  type?: PaymentType;
  title?: string;
  amount_cents?: number;
  status?: PaymentStatus;
  due_date?: string;
  paid_date?: string;
  receipt_document_key?: string;
  notes?: string;
};

export type CreateLocalProgressPhotoInput = {
  milestone_id?: string;
  photo_key: string;
  caption?: string;
  taken_at?: string;
  tags?: string[];
};

/** The statuses `getActive` keeps — `project-service.ts:152`. */
const ACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = ['planning', 'in_progress'];

function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function projectsOf(householdId: string): LocalProject[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalProject>('projects');
}

function milestonesOf(householdId: string): LocalProjectMilestone[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalProjectMilestone>('projectMilestones');
}

function paymentsOf(householdId: string): LocalProjectPayment[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalProjectPayment>('projectPayments');
}

function photosOf(householdId: string): LocalProjectProgressPhoto[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalProjectProgressPhoto>('projectProgressPhotos');
}

function contractorsById(householdId: string): Map<string, LocalContractor> {
  requireActiveProperty(householdId);
  return new Map(rowsOf<LocalContractor>('contractors').map((row) => [row.id, row]));
}

/** Server order: `created_at` desc (`getProjects`). */
function byCreatedAtDesc(a: { created_at: string }, b: { created_at: string }): number {
  return b.created_at.localeCompare(a.created_at);
}

/** Server order: `created_at` asc (`payments` in `enrichProject`). */
function byCreatedAtAsc(a: { created_at: string }, b: { created_at: string }): number {
  return a.created_at.localeCompare(b.created_at);
}

/**
 * Milestones come back ordered by `sort_order` — the member's own ordering of
 * the job, which is the only ordering the detail screen renders. `sort_order`
 * is `.default(0)` without `.notNull()` in D1, so the DTO's `number` can still
 * arrive as null over sync from a row the server wrote; `?? 0` keeps the
 * comparator total rather than letting one null scatter the list.
 */
function bySortOrder(a: LocalProjectMilestone, b: LocalProjectMilestone): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

/**
 * The contractor join, the three child arrays and the derived progress block,
 * rebuilt on every read.
 *
 * `enrichProject` throws `NotFoundError('Contractor not found')` when the join
 * dangles, and on device it can — a peer running a build older than the cascade
 * fix can still deliver a project whose contractor it deleted. A LIST read drops
 * the orphan so one dangling row cannot blank a whole screen; a SINGLE read
 * raises, matching the Worker. This is the same split `localQuotesApi` uses.
 */
function enrich(
  project: LocalProject,
  contractor: LocalContractor,
  milestones: readonly LocalProjectMilestone[],
  payments: readonly LocalProjectPayment[],
  photos: readonly LocalProjectProgressPhoto[],
): ProjectWithDetails {
  const mine = milestones.filter((row) => row.project_id === project.id).sort(bySortOrder);
  const paid = payments.filter((row) => row.project_id === project.id).sort(byCreatedAtAsc);
  const shots = photos.filter((row) => row.project_id === project.id).sort(byCreatedAtDesc);

  return {
    ...project,
    contractor: {
      id: contractor.id,
      name: contractor.name,
      company_name: contractor.company_name,
      specialty: contractor.specialty,
      // The server omits these two from its own `ProjectWithDetails` even
      // though the client's interface declares them — the same divergence B2
      // found on `QuoteWithDetails`. Filled in here: a superset of what the
      // server sends, so no screen can break on it, and it means the "call the
      // contractor" affordance on a project works offline.
      phone: contractor.phone,
      email: contractor.email,
      specialtyInfo:
        SPECIALTY_INFO[contractor.specialty as ContractorSpecialty] ?? SPECIALTY_INFO.other,
    },
    milestones: mine,
    payments: paid,
    progressPhotos: shots,
    progress: {
      completedMilestones: mine.filter((row) => row.status === 'completed').length,
      totalMilestones: mine.length,
      paidAmount: paid
        .filter((row) => row.status === 'paid')
        .reduce((sum, row) => sum + row.amount_cents, 0),
      // The CLIENT's field. The Worker answers `remainingAmount` here, which is
      // `totalAmount - paidAmount` and which no screen reads; `ProjectsScreen`
      // and `LaborHubDashboard` both read `totalAmount`, and
      // `projectStore.updateProjectProgress` already recomputes the whole block
      // client-side to supply it. Emitting the client's shape is what makes the
      // ledger path correct where the remote path is merely tolerated.
      totalAmount: paid.reduce((sum, row) => sum + row.amount_cents, 0),
    },
  };
}

/** Everything `enrich` needs, read once per call rather than once per project. */
function enrichmentContext(householdId: string) {
  return {
    byId: contractorsById(householdId),
    milestones: milestonesOf(householdId),
    payments: paymentsOf(householdId),
    photos: photosOf(householdId),
  };
}

function enrichAll(
  rows: readonly LocalProject[],
  context: ReturnType<typeof enrichmentContext>,
): ProjectWithDetails[] {
  const out: ProjectWithDetails[] = [];
  for (const row of rows) {
    const contractor = context.byId.get(row.contractor_id);
    if (contractor) {
      out.push(enrich(row, contractor, context.milestones, context.payments, context.photos));
    }
  }
  return out;
}

function requireProject(householdId: string, projectId: string): LocalProject {
  const found = projectsOf(householdId).find((row) => row.id === projectId);
  if (!found) throw new Error('Project not found');
  return found;
}

function requireMilestone(
  householdId: string,
  projectId: string,
  milestoneId: string,
): LocalProjectMilestone {
  const found = milestonesOf(householdId).find(
    (row) => row.id === milestoneId && row.project_id === projectId,
  );
  if (!found) throw new Error('Milestone not found');
  return found;
}

function requirePayment(
  householdId: string,
  projectId: string,
  paymentId: string,
): LocalProjectPayment {
  const found = paymentsOf(householdId).find(
    (row) => row.id === paymentId && row.project_id === projectId,
  );
  if (!found) throw new Error('Payment not found');
  return found;
}

function requirePhoto(
  householdId: string,
  projectId: string,
  photoId: string,
): LocalProjectProgressPhoto {
  const found = photosOf(householdId).find(
    (row) => row.id === photoId && row.project_id === projectId,
  );
  if (!found) throw new Error('Photo not found');
  return found;
}

/**
 * One place builds a project's `ProjectWithDetails` answer, so `create`,
 * `update` and every read return the identical shape. Re-reading after a write
 * rather than composing from the in-flight row is deliberate: it is the only
 * way the derived `progress` reflects a cascade the write may have performed.
 */
function detail(householdId: string, projectId: string): { project: ProjectWithDetails } {
  const project = requireProject(householdId, projectId);
  const context = enrichmentContext(householdId);
  const contractor = context.byId.get(project.contractor_id);
  if (!contractor) throw new Error('Contractor not found');
  return {
    project: enrich(project, contractor, context.milestones, context.payments, context.photos),
  };
}

/**
 * `updateProject`'s field semantics, and they differ from `localQuotesApi`'s on
 * purpose: absent means "leave it alone", and an EMPTY STRING is stored as an
 * empty string rather than coalesced to NULL.
 *
 * `project-service.ts:259` writes `updateData.description = input.description`
 * with no `|| null`, where `quote-service.ts` coalesces. Reproducing each
 * service's own quirk is what keeps a project edited offline and a project
 * edited online byte-identical; "fixing" one side would make the two backends
 * disagree about a field the member cleared.
 */
function projectPatch(data: UpdateLocalProjectInput): Partial<LocalProject> {
  const patch: Partial<LocalProject> = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;
  if (data.status !== undefined) patch.status = data.status;
  if (data.start_date !== undefined) patch.start_date = data.start_date;
  if (data.estimated_end_date !== undefined) patch.estimated_end_date = data.estimated_end_date;
  if (data.actual_end_date !== undefined) patch.actual_end_date = data.actual_end_date;
  if (data.total_budget_cents !== undefined) patch.total_budget_cents = data.total_budget_cents;
  if (data.notes !== undefined) patch.notes = data.notes;
  return patch;
}

function milestonePatch(data: UpdateLocalMilestoneInput): Partial<LocalProjectMilestone> {
  const patch: Partial<LocalProjectMilestone> = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;
  if (data.status !== undefined) patch.status = data.status;
  if (data.due_date !== undefined) patch.due_date = data.due_date;
  if (data.completed_date !== undefined) patch.completed_date = data.completed_date;
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.sort_order !== undefined) patch.sort_order = data.sort_order;
  return patch;
}

function paymentPatch(data: UpdateLocalPaymentInput): Partial<LocalProjectPayment> {
  const patch: Partial<LocalProjectPayment> = {};
  if (data.type !== undefined) patch.type = data.type;
  // `title` has no D1 column and the Worker's zod drops it, so this branch is
  // local-only reach. Applying it keeps the ledger row honest about a field the
  // client's `ProjectPayment` declares as a required `string` — see `types.ts`.
  if (data.title !== undefined) patch.title = data.title;
  if (data.amount_cents !== undefined) patch.amount_cents = data.amount_cents;
  if (data.status !== undefined) patch.status = data.status;
  if (data.due_date !== undefined) patch.due_date = data.due_date;
  if (data.paid_date !== undefined) patch.paid_date = data.paid_date;
  if (data.receipt_document_key !== undefined) {
    patch.receipt_document_key = data.receipt_document_key;
  }
  if (data.notes !== undefined) patch.notes = data.notes;
  return patch;
}

export const localProjectsApi = {
  /** `GET /projects` — `ProjectService.getProjects`. */
  getAll: async (householdId: string, filters?: LocalProjectFilters) => {
    const context = enrichmentContext(householdId);
    const rows = projectsOf(householdId)
      .filter((row) =>
        filters?.contractor_id ? row.contractor_id === filters.contractor_id : true,
      )
      .filter((row) => (filters?.status ? row.status === filters.status : true))
      .sort(byCreatedAtDesc);
    return { projects: enrichAll(rows, context) };
  },

  /**
   * `GET /projects/active` — the same read with `activeOnly`.
   *
   * This is the one B3 method with a live React Query subscriber:
   * `useHomeDashboard` holds `['home', 'projects', householdId]` and renders the
   * active-project cards on the home tab, which is why `projects` and its three
   * children all invalidate that prefix in `sync/ledgerRefresh.ts`.
   */
  getActive: async (householdId: string) => {
    const context = enrichmentContext(householdId);
    const rows = projectsOf(householdId)
      .filter((row) => ACTIVE_PROJECT_STATUSES.includes(row.status))
      .sort(byCreatedAtDesc);
    return { projects: enrichAll(rows, context) };
  },

  getOne: async (householdId: string, projectId: string) => detail(householdId, projectId),

  create: async (householdId: string, data: CreateLocalProjectInput) => {
    requireActiveProperty(householdId);
    // The Worker verifies the contractor belongs to the household first. B1 is
    // what made that answerable on device, and it is the dependency §11 used to
    // order the sub-waves: B1 gates B2 gates B3.
    const contractor = contractorsById(householdId).get(data.contractor_id);
    if (!contractor) throw new Error('Contractor not found');

    const timestamp = nowIso();
    const project: LocalProject = {
      // Random id, not deterministic: `projects` carries no `uniqueIndex` in D1
      // and none of B3's four tables does. Two members commissioning two jobs
      // from the same contractor is two projects, and a deterministic id would
      // merge work they meant to keep apart.
      id: newLocalId('prj'),
      household_id: householdId,
      contractor_id: data.contractor_id,
      quote_id: data.quote_id || null,
      title: data.title,
      description: data.description || null,
      // The route hard-codes `planning`; nothing can be created already running.
      status: 'planning',
      start_date: data.start_date || null,
      estimated_end_date: data.estimated_end_date || null,
      actual_end_date: null,
      total_budget_cents: data.total_budget_cents || null,
      notes: data.notes || null,
      // Both are stored as the JSON text D1 stores. `linked_report_ids` is the
      // plural the client declares and D1 does not have (`types.ts`); the
      // Worker's zod drops it, so keeping it is a superset of the remote
      // behaviour rather than a divergence a screen can trip over.
      linked_report_ids: data.linked_report_ids ? JSON.stringify(data.linked_report_ids) : null,
      linked_task_ids: data.linked_task_ids ? JSON.stringify(data.linked_task_ids) : null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        draft.projects.push(project);
      },
      { opType: 'PROJECT_CREATE', entityType: 'project', entityId: project.id, payload: project },
    );
    return detail(householdId, project.id);
  },

  update: async (householdId: string, projectId: string, data: UpdateLocalProjectInput) => {
    requireProject(householdId, projectId);
    const patch = projectPatch(data);
    await writeLocal(
      (draft) => {
        const project = draft.projects.find(
          (row) => row.id === projectId && row.household_id === householdId,
        );
        if (!project) throw new Error('Project not found');
        Object.assign(project, patch);
        project.updated_at = nowIso();
      },
      { opType: 'PROJECT_UPDATE', entityType: 'project', entityId: projectId, payload: data },
    );
    return detail(householdId, projectId);
  },

  /**
   * `DELETE /projects/:id` — the project AND its three child tables, in ONE op.
   *
   * D1 declares `onDelete: 'cascade'` on all three child foreign keys and
   * `ProjectService.deleteProject` deletes them explicitly on top of that. On
   * device there is no foreign key to enforce anything: a delete is a tombstone,
   * so a child left behind is an orphan that syncs to every peer and is never
   * read. B2 shipped exactly that bug at the contractor level and nothing
   * failed, because an orphan has nothing to complain to.
   *
   * ONE op rather than four is the other half. `mutateLocalHouseLedger` diffs
   * the whole ledger per call, so four writes would be four ops a peer applies
   * one at a time — and between the first and the last that peer holds payments
   * belonging to a project that no longer exists, which is how a "total paid"
   * figure outlives the job it paid for.
   */
  delete: async (householdId: string, projectId: string) => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.projects.some(
          (row) => row.id === projectId && row.household_id === householdId,
        );
        if (!exists) throw new Error('Project not found');
        draft.projects = draft.projects.filter((row) => row.id !== projectId);
        draft.projectMilestones = draft.projectMilestones.filter(
          (row) => row.project_id !== projectId,
        );
        draft.projectPayments = draft.projectPayments.filter(
          (row) => row.project_id !== projectId,
        );
        draft.projectProgressPhotos = draft.projectProgressPhotos.filter(
          (row) => row.project_id !== projectId,
        );
      },
      {
        opType: 'PROJECT_DELETE',
        entityType: 'project',
        entityId: projectId,
        payload: { id: projectId },
      },
    );
  },

  // ---- milestones ---------------------------------------------------------

  /**
   * `POST /projects/:id/milestones`.
   *
   * `sort_order` is `max(existing) + 1`, computed the Worker's way —
   * `Math.max(0, ...)` over the project's rows, so the first milestone is 1 and
   * not 0. The client's `CreateMilestoneRequest` cannot override it (the route's
   * zod can; the client type does not expose it), so this is the only path.
   *
   * Two members adding a milestone offline both compute the same next order and
   * converge to two rows sharing it. That is the RIGHT outcome and the reason
   * this table has no deterministic id: they are two different milestones, and
   * `bySortOrder` is a stable sort, so both render in insertion order rather
   * than one overwriting the other.
   */
  addMilestone: async (
    householdId: string,
    projectId: string,
    data: CreateLocalMilestoneInput,
  ) => {
    requireProject(householdId, projectId);
    const siblings = milestonesOf(householdId).filter((row) => row.project_id === projectId);
    const maxOrder = Math.max(0, ...siblings.map((row) => row.sort_order ?? 0));

    const milestone: LocalProjectMilestone = {
      id: newLocalId('pml'),
      // D1 scopes a milestone by its project alone; H5 puts several properties
      // on one device, so the ledger row carries the property too (`& Owned`).
      household_id: householdId,
      project_id: projectId,
      title: data.title,
      description: data.description || null,
      status: 'pending',
      due_date: data.due_date || null,
      completed_date: null,
      sort_order: maxOrder + 1,
      notes: data.notes || null,
      created_at: nowIso(),
    };

    await writeLocal(
      (draft) => {
        draft.projectMilestones.push(milestone);
      },
      {
        opType: 'PROJECT_MILESTONE_CREATE',
        entityType: 'project_milestone',
        entityId: milestone.id,
        payload: milestone,
      },
    );
    return { milestone };
  },

  updateMilestone: async (
    householdId: string,
    projectId: string,
    milestoneId: string,
    data: UpdateLocalMilestoneInput,
  ) => {
    requireProject(householdId, projectId);
    requireMilestone(householdId, projectId, milestoneId);
    const patch = milestonePatch(data);
    await writeLocal(
      (draft) => {
        const milestone = draft.projectMilestones.find((row) => row.id === milestoneId);
        if (!milestone) throw new Error('Milestone not found');
        Object.assign(milestone, patch);
        // No `updated_at` — `project_milestones` has no such column, and adding
        // one on the ledger row would put a field in the op log that the D1
        // table cannot hold.
      },
      {
        opType: 'PROJECT_MILESTONE_UPDATE',
        entityType: 'project_milestone',
        entityId: milestoneId,
        payload: data,
      },
    );
    return { milestone: requireMilestone(householdId, projectId, milestoneId) };
  },

  deleteMilestone: async (householdId: string, projectId: string, milestoneId: string) => {
    requireProject(householdId, projectId);
    requireMilestone(householdId, projectId, milestoneId);
    await writeLocal(
      (draft) => {
        draft.projectMilestones = draft.projectMilestones.filter((row) => row.id !== milestoneId);
        // `project_progress_photos.milestone_id` is `set null`, NOT cascade
        // (`schema-labor-hub.ts:291`) — a photo of the work outlives the
        // milestone it was filed under, exactly as a contractor document
        // outlives its visit. Clearing the pointer in the SAME op is what stops
        // a peer from holding a photo that points at a milestone it no longer
        // has.
        for (const photo of draft.projectProgressPhotos) {
          if (photo.milestone_id === milestoneId) photo.milestone_id = null;
        }
      },
      {
        opType: 'PROJECT_MILESTONE_DELETE',
        entityType: 'project_milestone',
        entityId: milestoneId,
        payload: { id: milestoneId },
      },
    );
  },

  /**
   * `POST /projects/:id/milestones/:mid/complete` — the Worker's own
   * `updateMilestone(status: 'completed', completedDate: now)`, routed through
   * the same patch builder so the two paths cannot drift.
   *
   * Note the Worker stamps `completed_date` with a full ISO timestamp
   * (`nowIso()`), not a `YYYY-MM-DD` date, despite the column's name. Mirrored:
   * the milestone list would otherwise sort differently on the two backends.
   */
  completeMilestone: async (householdId: string, projectId: string, milestoneId: string) =>
    localProjectsApi.updateMilestone(householdId, projectId, milestoneId, {
      status: 'completed',
      completed_date: nowIso(),
    }),

  // ---- payments -----------------------------------------------------------

  addPayment: async (householdId: string, projectId: string, data: CreateLocalPaymentInput) => {
    requireProject(householdId, projectId);

    const payment: LocalProjectPayment = {
      id: newLocalId('ppy'),
      household_id: householdId,
      project_id: projectId,
      type: data.type,
      // Client-only: `project_payments` has no `title` column and the Worker's
      // zod drops it, so a payment fetched from the server has `undefined` in a
      // slot the DTO types as `string`. The ledger stores what the caller passed.
      title: data.title,
      amount_cents: data.amount_cents,
      // The route hard-codes `pending`; a payment cannot be created already paid.
      status: 'pending',
      due_date: data.due_date || null,
      paid_date: null,
      receipt_document_key: null,
      notes: data.notes || null,
      created_at: nowIso(),
    };

    await writeLocal(
      (draft) => {
        draft.projectPayments.push(payment);
      },
      {
        opType: 'PROJECT_PAYMENT_CREATE',
        entityType: 'project_payment',
        entityId: payment.id,
        payload: payment,
      },
    );
    return { payment };
  },

  updatePayment: async (
    householdId: string,
    projectId: string,
    paymentId: string,
    data: UpdateLocalPaymentInput,
  ) => {
    requireProject(householdId, projectId);
    requirePayment(householdId, projectId, paymentId);
    const patch = paymentPatch(data);
    await writeLocal(
      (draft) => {
        const payment = draft.projectPayments.find((row) => row.id === paymentId);
        if (!payment) throw new Error('Payment not found');
        Object.assign(payment, patch);
      },
      {
        opType: 'PROJECT_PAYMENT_UPDATE',
        entityType: 'project_payment',
        entityId: paymentId,
        payload: data,
      },
    );
    return { payment: requirePayment(householdId, projectId, paymentId) };
  },

  deletePayment: async (householdId: string, projectId: string, paymentId: string) => {
    requireProject(householdId, projectId);
    requirePayment(householdId, projectId, paymentId);
    await writeLocal(
      (draft) => {
        draft.projectPayments = draft.projectPayments.filter((row) => row.id !== paymentId);
      },
      {
        opType: 'PROJECT_PAYMENT_DELETE',
        entityType: 'project_payment',
        entityId: paymentId,
        payload: { id: paymentId },
      },
    );
  },

  /**
   * `POST /projects/:id/payments/:pid/mark-paid`.
   *
   * The Worker does this in two writes — the payment, then `total_spent_cents`
   * on the project — and the second one is the one this facade deliberately
   * does NOT reproduce. That column is the sum of the paid payments, and a
   * stored aggregate under per-field LWW converges wrongly by construction: two
   * members settling two different payments offline each compute a total that
   * omits the other's, and the merge picks one. `progress.paidAmount` is
   * recomputed from the rows on every read instead, which is also what
   * `projectStore.updateProjectProgress` does to the server's own answer.
   *
   * So this is one op, not two, and it is the write that has to survive a
   * kitchen with no signal: the member has just handed over a cheque.
   */
  markPaymentPaid: async (
    householdId: string,
    projectId: string,
    paymentId: string,
    receiptDocumentKey?: string,
  ) => {
    requireProject(householdId, projectId);
    requirePayment(householdId, projectId, paymentId);
    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const payment = draft.projectPayments.find((row) => row.id === paymentId);
        if (!payment) throw new Error('Payment not found');
        payment.status = 'paid';
        payment.paid_date = timestamp;
        // `undefined` means "not supplied" and must not clear a receipt key an
        // earlier call recorded — the Worker's `if (input.x !== undefined)`.
        if (receiptDocumentKey !== undefined) payment.receipt_document_key = receiptDocumentKey;
      },
      {
        opType: 'PROJECT_PAYMENT_MARK_PAID',
        entityType: 'project_payment',
        entityId: paymentId,
        payload: { id: paymentId, paid_date: timestamp },
      },
    );
    return { payment: requirePayment(householdId, projectId, paymentId) };
  },

  // ---- progress photos ----------------------------------------------------

  /**
   * `POST /projects/:id/photos` — the metadata ROW, not the bytes.
   *
   * `photo_key` names an object in the encrypted blob channel (H6); this method
   * records that it exists, along with the caption, the tags and the milestone
   * it belongs to. That split is B1's, settled on `contractorDocuments`: the
   * paperwork works offline and only the transfer needs the channel. It is also
   * why this module has no throw site — `projectsApi` has no upload method and
   * no URL builder at all, so there is nothing here that reaches R2.
   *
   * One divergence, in the client's favour: the Worker ignores `taken_at`
   * entirely (`createProgressPhotoSchema` does not declare it) and stamps the
   * row with the moment it was FILED. The client's `CreateProgressPhotoRequest`
   * declares it, and a photo of last week's framing filed today belongs to last
   * week — so a supplied value is honoured and `nowIso()` is the fallback,
   * which is exactly what the server would have written.
   */
  addProgressPhoto: async (
    householdId: string,
    projectId: string,
    data: CreateLocalProgressPhotoInput,
  ) => {
    requireProject(householdId, projectId);

    // One clock read, not two: `taken_at` falling back to `created_at` must be
    // the SAME instant, or a photo filed with no date sorts a millisecond away
    // from where it was written and the two orderings disagree for no reason.
    const timestamp = nowIso();
    const photo: LocalProjectProgressPhoto = {
      id: newLocalId('pph'),
      household_id: householdId,
      project_id: projectId,
      milestone_id: data.milestone_id || null,
      photo_key: data.photo_key,
      caption: data.caption || null,
      taken_at: data.taken_at || timestamp,
      tags: data.tags ? JSON.stringify(data.tags) : null,
      created_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        draft.projectProgressPhotos.push(photo);
      },
      {
        opType: 'PROJECT_PHOTO_CREATE',
        entityType: 'project_photo',
        entityId: photo.id,
        payload: photo,
      },
    );
    return { photo };
  },

  deleteProgressPhoto: async (householdId: string, projectId: string, photoId: string) => {
    requireProject(householdId, projectId);
    requirePhoto(householdId, projectId, photoId);
    await writeLocal(
      (draft) => {
        draft.projectProgressPhotos = draft.projectProgressPhotos.filter(
          (row) => row.id !== photoId,
        );
      },
      {
        opType: 'PROJECT_PHOTO_DELETE',
        entityType: 'project_photo',
        entityId: photoId,
        payload: { id: photoId },
      },
    );
  },
};
