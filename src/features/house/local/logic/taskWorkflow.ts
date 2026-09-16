/**
 * Task workflow-stage transitions — the contractor pipeline, on device.
 *
 * Ported from `backend/src/routes/tasks.ts` (`/quotes/request` :417,
 * `/quotes/compare-ai` :454, `/select-quote` :491, `/workflow-stage` :513,
 * `/schedule-work` :534) — keep in sync.
 *
 * WHAT THE SERVER ACTUALLY ENFORCES — READ THIS BEFORE ADDING A STATE MACHINE
 * ---------------------------------------------------------------------------
 * There is no from→to guard on the server. `workflow_stage` is a plain TEXT
 * column and every one of those five routes does the same thing: call
 * `updateTask` with a stage literal (plus, for two of them, some companion
 * fields) and re-read the task. The "rules" are therefore exactly two facts:
 *
 *   1. which ACTION implies which stage, and
 *   2. which companion fields move with it in the same write.
 *
 * Both are encoded below. A `planning → completed` jump is legal here because
 * it is legal on the server; inventing an ordering locally would mean a member
 * offline is refused a transition their partner online is allowed, and the
 * ledger would then hold two devices with different ideas of the pipeline.
 *
 * THE ONE DELIBERATE DIVERGENCE
 * -----------------------------
 * `assertWorkflowStage` rejects a stage outside the union. The server does not
 * (the `/workflow-stage` route reads `body.workflow_stage` unvalidated — there
 * is no `zValidator` on it), and it gets away with it because a bad value there
 * is one bad row in D1 that an operator can fix with a query. In the ledger the
 * same value is an LWW-merged row replicated to every device in the household,
 * with no operator and no query. Rejecting at the boundary is the cheap side of
 * that asymmetry, and no screen can trip it: the only callers are
 * `QuoteComparisonScreen` / `QuoteManagementScreen` / `ScheduleWorkScreen`, all
 * of which pass literals from `TaskWorkflowStage`.
 */
import type { TaskWorkflowStage } from '@api/tasks';

/** Every stage the pipeline defines, in pipeline order (`src/api/tasks.ts:8`). */
export const TASK_WORKFLOW_STAGES: readonly TaskWorkflowStage[] = [
  'planning',
  'getting_quotes',
  'comparing_quotes',
  'quote_selected',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
];

const STAGE_SET = new Set<string>(TASK_WORKFLOW_STAGES);

export function isTaskWorkflowStage(value: unknown): value is TaskWorkflowStage {
  return typeof value === 'string' && STAGE_SET.has(value);
}

/**
 * The five server actions that move a task's stage, and the stage each lands on.
 *
 * `set_stage` is absent on purpose — the `/workflow-stage` route takes the
 * stage from the caller rather than implying one, so it has no entry to make.
 */
export type TaskWorkflowAction =
  | 'request_quotes'
  | 'compare_quotes'
  | 'select_quote'
  | 'schedule_work';

export const STAGE_FOR_ACTION: Record<TaskWorkflowAction, TaskWorkflowStage> = {
  // routes/tasks.ts:443 — set after the quote rows are created.
  request_quotes: 'getting_quotes',
  // routes/tasks.ts:480 — set after the AI comparison returns.
  compare_quotes: 'comparing_quotes',
  // routes/tasks.ts:501
  select_quote: 'quote_selected',
  // routes/tasks.ts:570
  schedule_work: 'scheduled',
};

/**
 * The fields one transition writes. Every key is optional because the ledger
 * mutator applies only what is present — a patch that named every column would
 * overwrite a peer's concurrent edit to a field this action never touched, and
 * LWW is per field precisely so that does not have to happen.
 */
export type TaskWorkflowPatch = {
  workflow_stage?: TaskWorkflowStage;
  selected_quote_id?: string;
  scheduled_work_date?: string;
  scheduled_work_time_start?: string;
  scheduled_work_time_end?: string;
};

/** Throws when a caller invents a stage. See the header for why this is stricter than the server. */
export function assertWorkflowStage(stage: unknown): TaskWorkflowStage {
  if (!isTaskWorkflowStage(stage)) {
    throw new Error(`Unknown task workflow stage: ${String(stage)}`);
  }
  return stage;
}

/** `PATCH /workflow-stage` (routes/tasks.ts:521) — stage only, nothing else moves. */
export function setStagePatch(stage: unknown): TaskWorkflowPatch {
  return { workflow_stage: assertWorkflowStage(stage) };
}

/** `POST /select-quote` (routes/tasks.ts:499) — the quote id and the stage land together. */
export function selectQuotePatch(quoteId: string): TaskWorkflowPatch {
  return { selected_quote_id: quoteId, workflow_stage: STAGE_FOR_ACTION.select_quote };
}

/**
 * `POST /schedule-work` (routes/tasks.ts:566).
 *
 * The server writes `scheduled_time_start` / `_end` straight through, including
 * `undefined` when the body omitted them, which Drizzle turns into "leave the
 * column alone". Omitting the keys here reproduces that; setting them to `null`
 * would clear a time the member had already picked.
 */
export function scheduleWorkPatch(input: {
  scheduled_date: string;
  scheduled_time_start?: string;
  scheduled_time_end?: string;
}): TaskWorkflowPatch {
  const patch: TaskWorkflowPatch = {
    scheduled_work_date: input.scheduled_date,
    workflow_stage: STAGE_FOR_ACTION.schedule_work,
  };
  if (input.scheduled_time_start !== undefined) {
    patch.scheduled_work_time_start = input.scheduled_time_start;
  }
  if (input.scheduled_time_end !== undefined) {
    patch.scheduled_work_time_end = input.scheduled_time_end;
  }
  return patch;
}
