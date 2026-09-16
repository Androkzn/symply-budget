/**
 * Local counterpart of `src/api/task-drafts.ts` (8 methods) — Stage H3.
 *
 * `task_drafts` is Tier A (plan §1.2, "AI-seeded but user-editable"), and the
 * emphasis is on the second half. The rows *originate* in the reports pipeline,
 * which is Tier B and can never move on device — AWS Lambda has to read the PDF
 * and E2EE would blind it. So the split is:
 *
 *  - drafts that are already in the ledger are listed, summarized, converted,
 *    dismissed and deleted entirely offline — that is the whole triage flow a
 *    member actually performs;
 *  - `generate`, which asks the Worker to mine a report's findings for new
 *    drafts, belongs to Stage H7 (server-compute displacement) and is not
 *    built. It throws `HouseLocalUnsupportedError` with member-facing copy
 *    rather than being left off the object: a MISSING key is the one failure
 *    mode the plan forbids, because the Proxy's non-strict modules would route
 *    it to a server that has no local-first household to generate against
 *    (`localApiProxy.ts` header, "a missing local method must THROW").
 *
 * Ported behaviour comes from `backend/src/services/task-draft-service.ts` —
 * filter defaults, the severity sort order, the summary fold, and the exact
 * task row `convertToMaintenanceTask` writes.
 */
// Polyfill before the engine / @symply/local-first graph loads (@noble captures
// globalThis.crypto at module load) — plan §6.1.
import './cryptoPolyfill';

import type {
  BulkConvertRequest,
  ConvertDraftRequest,
  DismissDraftRequest,
  TaskDraft,
  TaskDraftsFilters,
  TaskDraftsSummary,
  TaskDraftWithRelations,
} from '@api/task-drafts';
import type { Task } from '@api/tasks';

import { HouseLocalUnsupportedError } from './errors';
import { isoNow, newLocalId } from './ids';
import { rowsOf, writeLocal, writeLocalBulk } from './localWrite';
import type { LocalTask, LocalTaskDraft } from './types';

/**
 * Nothing here is Tier C, so no method is remote by design. `generate` is a
 * different category — unsupported until H7 — and it throws.
 */
export const HOUSE_LOCAL_TASK_DRAFTS_REMOTE_METHODS: readonly string[] = [];

/** `task-draft-service.ts:185` — the defaults the Worker applies when unasked. */
const DEFAULT_STATUS: NonNullable<TaskDraftsFilters['status']> = 'draft';
const DEFAULT_SORT_BY: NonNullable<TaskDraftsFilters['sort_by']> = 'priority_score';
const DEFAULT_SORT_ORDER: NonNullable<TaskDraftsFilters['sort_order']> = 'desc';
const DEFAULT_LIMIT = 100;
const DEFAULT_OFFSET = 0;

/** The `CASE WHEN severity = …` ladder the service builds in SQL. */
const SEVERITY_RANK: Record<string, number> = {
  critical: 1,
  major: 2,
  minor: 3,
  informational: 4,
};

const TASK_FREQUENCIES: readonly Task['frequency'][] = [
  'one_time',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom',
];

/**
 * D1 has no CHECK on `tasks.frequency`, so the Worker would happily store
 * whatever string the client sent. The ledger row IS the DTO screens are typed
 * against (`types.ts` header), so an unrecognized value is coerced to the
 * service's own fallback instead of being allowed to reach a `switch` on a
 * union type.
 */
function asFrequency(value: string | null | undefined): Task['frequency'] | null {
  return TASK_FREQUENCIES.includes(value as Task['frequency'])
    ? (value as Task['frequency'])
    : null;
}

function draftsOf(householdId: string): LocalTaskDraft[] {
  return rowsOf<LocalTaskDraft>('taskDrafts').filter((row) => row.household_id === householdId);
}

/**
 * SQLite's null ordering, reproduced: `ORDER BY col DESC` puts NULLs last and
 * `ASC` puts them first. Drafts without a priority score are common (the
 * generator only scores what it is confident about), so getting this wrong
 * would float every unscored draft to the top of the triage list.
 */
function compareNullableNumbers(a: number | null, b: number | null, ascending: boolean): number {
  if (a === b) return 0;
  if (a === null) return ascending ? -1 : 1;
  if (b === null) return ascending ? 1 : -1;
  return ascending ? a - b : b - a;
}

function sortDrafts(
  drafts: LocalTaskDraft[],
  sortBy: NonNullable<TaskDraftsFilters['sort_by']>,
  sortOrder: NonNullable<TaskDraftsFilters['sort_order']>,
): LocalTaskDraft[] {
  const ascending = sortOrder === 'asc';
  const direction = ascending ? 1 : -1;
  return [...drafts].sort((a, b) => {
    switch (sortBy) {
      case 'severity':
        // Note this reads "backwards" — `desc` on the rank ladder surfaces
        // informational before critical. It is what the Worker does, and the
        // screen picks the order, so parity beats intuition here.
        return direction * ((SEVERITY_RANK[a.severity] ?? 5) - (SEVERITY_RANK[b.severity] ?? 5));
      case 'category':
        return direction * a.system_category.localeCompare(b.system_category);
      case 'created_at':
        return direction * a.created_at.localeCompare(b.created_at);
      case 'priority_score':
      default:
        return compareNullableNumbers(a.priority_score, b.priority_score, ascending);
    }
  });
}

/** Exactly the fold in `getTaskDraftsSummary`, over ledger rows. */
function summarize(drafts: readonly LocalTaskDraft[]): TaskDraftsSummary {
  const summary: TaskDraftsSummary = {
    total: drafts.length,
    by_severity: { critical: 0, major: 0, minor: 0, informational: 0 },
    by_category: {},
    total_cost_min: 0,
    total_cost_max: 0,
    diy_possible_count: 0,
    recurring_suggestions: 0,
  };

  for (const draft of drafts) {
    if (draft.severity in summary.by_severity) {
      summary.by_severity[draft.severity] += 1;
    }
    summary.by_category[draft.system_category] =
      (summary.by_category[draft.system_category] ?? 0) + 1;
    summary.total_cost_min += draft.estimated_cost_min ?? 0;
    summary.total_cost_max += draft.estimated_cost_max ?? 0;
    if (draft.diy_possible) summary.diy_possible_count += 1;
    if (draft.is_recurring_suggestion) summary.recurring_suggestions += 1;
  }

  return summary;
}

/**
 * The task row `convertToMaintenanceTask` inserts, minus the three columns the
 * client `Task` DTO does not carry (`suggested_by`, `suggestion_reason`,
 * `why_important`). Dropping them is forced by the ledger's own rule that a row
 * IS the DTO — storing fields no screen can read would give the LWW map a
 * surface with no reader.
 */
function buildTaskFromDraft(
  draft: LocalTaskDraft,
  householdId: string,
  options: ConvertDraftRequest,
  timestamp: string,
): LocalTask {
  return {
    id: newLocalId('task'),
    household_id: householdId,
    system_category: draft.system_category,
    title: draft.title,
    description: draft.description,
    frequency: options.add_recurring
      ? (asFrequency(options.frequency) ?? asFrequency(draft.suggested_frequency) ?? 'yearly')
      : 'custom',
    custom_interval_days: null,
    // The service writes a full ISO timestamp into what screens treat as a
    // date column when no start date is given. Reproduced rather than
    // corrected, so a converted draft looks the same on both paths.
    next_due_date: options.start_date || timestamp,
    last_completed_at: null,
    assigned_to: null,
    is_active: true,
    source: 'ai_generated',
    // `reminder_days_before` is set explicitly by the service; the other three
    // come from the D1 column defaults (`backend/src/db/schema.ts` tasks).
    reminder_enabled: true,
    reminder_days_before: 7,
    reminder_time: '09:00',
    reminder_repeat: true,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/** The draft-side half of a conversion — status flip plus the back-pointer. */
function markConverted(draft: LocalTaskDraft, taskId: string, timestamp: string): void {
  draft.status = 'converted';
  draft.converted_to_task_id = taskId;
  draft.converted_at = timestamp;
  draft.updated_at = timestamp;
}

export const localTaskDraftsApi = {
  /** GET /households/:id/task-drafts */
  list: async (
    householdId: string,
    filters?: TaskDraftsFilters,
  ): Promise<{ drafts: TaskDraft[]; total: number; limit: number; offset: number }> => {
    const status = filters?.status ?? DEFAULT_STATUS;
    const limit = filters?.limit ?? DEFAULT_LIMIT;
    const offset = filters?.offset ?? DEFAULT_OFFSET;

    const matched = draftsOf(householdId).filter((draft) => {
      if (filters?.report_id && draft.report_id !== filters.report_id) return false;
      if (status && draft.status !== status) return false;
      if (filters?.severity && draft.severity !== filters.severity) return false;
      if (filters?.system_category && draft.system_category !== filters.system_category) {
        return false;
      }
      return true;
    });

    const sorted = sortDrafts(
      matched,
      filters?.sort_by ?? DEFAULT_SORT_BY,
      filters?.sort_order ?? DEFAULT_SORT_ORDER,
    );

    // `total` counts the whole filtered set, not the page — the screen's
    // "N drafts" header reads it while the list is paginated.
    return {
      drafts: sorted.slice(offset, offset + limit),
      total: matched.length,
      limit,
      offset,
    };
  },

  /** GET /households/:id/task-drafts/summary — always over status='draft'. */
  getSummary: async (householdId: string, reportId?: string): Promise<TaskDraftsSummary> =>
    summarize(
      draftsOf(householdId).filter(
        (draft) =>
          draft.status === 'draft' && (reportId ? draft.report_id === reportId : true),
      ),
    ),

  /**
   * POST /households/:id/task-drafts/generate — Stage H7.
   *
   * Mining a report's findings needs the report, and reports are Tier B: the
   * PDF text, findings and images never enter the ledger. Until H7 gives the
   * device its own generation path this is honest-unavailable, not silent.
   */
  generate: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('task-drafts.generate');
  },

  /**
   * GET /households/:id/task-drafts/:draftId.
   *
   * `finding` and `images` are joins onto `findings` / `report_images`, both
   * Tier B. They come back empty rather than absent so the detail screen's
   * optional-chaining renders the draft without its evidence panel instead of
   * failing on a missing key.
   */
  get: async (householdId: string, draftId: string): Promise<TaskDraftWithRelations> => {
    const draft = draftsOf(householdId).find((row) => row.id === draftId);
    if (!draft) throw new Error('Task draft not found');
    return { ...draft, finding: null, images: [] };
  },

  /** POST /households/:id/task-drafts/:draftId/convert */
  convert: async (
    householdId: string,
    draftId: string,
    request: ConvertDraftRequest,
  ): Promise<{ taskId?: string; actionItemId?: string }> => {
    const draft = draftsOf(householdId).find((row) => row.id === draftId);
    if (!draft) throw new Error('Task draft not found');
    if (draft.status !== 'draft') throw new Error('Task draft already processed');

    const timestamp = isoNow();
    const task = buildTaskFromDraft(draft, householdId, request, timestamp);

    await writeLocal(
      (ledger) => {
        const target = ledger.taskDrafts.find((row) => row.id === draftId);
        if (!target) throw new Error('Task draft not found');
        ledger.tasks.push(task);
        markConverted(target, task.id, timestamp);
      },
      {
        opType: 'TASK_DRAFT_CONVERT',
        entityType: 'taskDraft',
        entityId: draftId,
        payload: { task_id: task.id, household_id: householdId },
      },
    );

    return { taskId: task.id };
  },

  /**
   * POST /households/:id/task-drafts/bulk-convert.
   *
   * The Worker loops `convertToMaintenanceTask`, catching per draft. Locally
   * that loop would be one whole-ledger capture/diff/seal per draft, and the
   * screen sends up to 50 at once — so the per-draft *validation* is kept
   * (errors are still reported one by one, in the server's `id: message` form)
   * while the *writes* are batched one op per chunk.
   */
  bulkConvert: async (
    householdId: string,
    request: BulkConvertRequest,
  ): Promise<{ success: number; failed: number; errors: string[] }> => {
    const timestamp = isoNow();
    const errors: string[] = [];
    const planned: Array<{ draftId: string; task: LocalTask }> = [];

    const byId = new Map(draftsOf(householdId).map((row) => [row.id, row]));
    for (const draftId of request.draft_ids) {
      const draft = byId.get(draftId);
      if (!draft) {
        errors.push(`${draftId}: Task draft not found`);
        continue;
      }
      if (draft.status !== 'draft') {
        errors.push(`${draftId}: Task draft already processed`);
        continue;
      }
      planned.push({ draftId, task: buildTaskFromDraft(draft, householdId, {}, timestamp) });
    }

    await writeLocalBulk(
      planned,
      (ledger, chunk) => {
        const drafts = new Map(ledger.taskDrafts.map((row) => [row.id, row]));
        for (const entry of chunk) {
          const target = drafts.get(entry.draftId);
          if (!target) continue;
          ledger.tasks.push(entry.task);
          markConverted(target, entry.task.id, timestamp);
        }
      },
      (chunk) => ({
        opType: 'TASK_DRAFT_CONVERT_BULK',
        entityType: 'taskDraft',
        entityId: chunk[0]!.draftId,
        payload: { count: chunk.length, household_id: householdId },
      }),
    );

    return { success: planned.length, failed: errors.length, errors };
  },

  /** POST /households/:id/task-drafts/:draftId/dismiss */
  dismiss: async (
    householdId: string,
    draftId: string,
    request?: DismissDraftRequest,
  ): Promise<{ success: boolean }> => {
    const timestamp = isoNow();
    await writeLocal(
      (ledger) => {
        const draft = ledger.taskDrafts.find(
          (row) => row.id === draftId && row.household_id === householdId,
        );
        // The Worker's UPDATE matches zero rows and still answers success; a
        // dismissal the member already made on another device must not error.
        if (!draft) return;
        draft.status = 'dismissed';
        draft.dismissed_reason = request?.reason ?? null;
        draft.dismissed_at = timestamp;
        draft.updated_at = timestamp;
      },
      {
        opType: 'TASK_DRAFT_DISMISS',
        entityType: 'taskDraft',
        entityId: draftId,
        payload: { reason: request?.reason ?? null },
      },
    );
    return { success: true };
  },

  /** DELETE /households/:id/task-drafts/:draftId */
  delete: async (householdId: string, draftId: string): Promise<{ success: boolean }> => {
    await writeLocal(
      (ledger) => {
        ledger.taskDrafts = ledger.taskDrafts.filter(
          (row) => !(row.id === draftId && row.household_id === householdId),
        );
      },
      {
        opType: 'TASK_DRAFT_DELETE',
        entityType: 'taskDraft',
        entityId: draftId,
        payload: { household_id: householdId },
      },
    );
    return { success: true };
  },
};
