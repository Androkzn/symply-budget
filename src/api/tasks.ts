import type { HouseBlobDescriptor } from '@features/house/local/blobs';
import { createHouseLocalProxy } from '@features/house/local/localApiProxy';
import { tasksListResponseSchema } from '@symply/contracts';

import type { BudgetItem } from './budget';
import { apiClient } from './client';
import { shouldValidateApiResponses, validateApiResponse } from './validateResponse';

// Types
export type TaskWorkflowStage =
  | 'planning'
  | 'getting_quotes'
  | 'comparing_quotes'
  | 'quote_selected'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/** Task priority/severity: nice_to_have (default) through critical */
export type TaskPrioritySeverity =
  | 'nice_to_have'
  | 'low'
  | 'medium'
  | 'high'
  | 'urgent'
  | 'critical';

export const TASK_PRIORITY_SEVERITIES: TaskPrioritySeverity[] = [
  'nice_to_have',
  'low',
  'medium',
  'high',
  'urgent',
  'critical',
];

/** Risk if a task is neglected — assessed independently of priority. */
export type TaskRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Effort/skill required to complete a task. */
export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'involved' | 'expert';

/** Coarse "how long will this take" tier — replaces the old estimated_minutes. */
export type TimeEffort = 'quick' | 'short' | 'medium' | 'half_day' | 'all_day';

/** Human-readable label for each effort tier, rendered on task cards + detail. */
export const TIME_EFFORT_LABELS: Record<TimeEffort, string> = {
  quick: 'Quick',
  short: 'Short',
  medium: 'Couple hours',
  half_day: 'Half day',
  all_day: 'All day',
};

/** Effort tiers in ascending duration order — for pickers/selectors. */
export const TIME_EFFORTS: TimeEffort[] = ['quick', 'short', 'medium', 'half_day', 'all_day'];

/** Async AI-enrichment lifecycle for quick-captured tasks. */
export type TaskEnrichmentStatus =
  | 'pending'
  | 'enriching'
  | 'enriched'
  | 'needs_clarification'
  | 'failed';

export interface TaskPhoto {
  id: string;
  photo_key: string;
  photo_url: string;
  sort_order: number;
  /**
   * H6 encrypted-channel descriptor, when the BYTES travelled through
   * `@features/house/local/blobs` instead of the legacy R2 upload.
   *
   * This field is what closes the H6 attachment gap for tasks. `LocalTask` is
   * `Omit<Task, …> & Owned`, so the photo array already synced peer-to-peer —
   * but it carried a `photo_key` pointing at an R2 object a local-first
   * household never wrote, which is exactly Budget's `localWishMedia.ts` bug:
   * the row travels and the bytes do not. A descriptor is content-derived and
   * device-independent, so any enrolled peer can open it.
   *
   * Optional and additive on purpose. A photo created on the legacy server path
   * has no descriptor, keeps its `photo_key` + `photo_url`, and renders through
   * the same `<Image>` it always did. Only rows written by the local-first
   * picker carry this, and only those render through `HouseBlobImage`.
   *
   * Type-only import: the blobs barrel pulls `expo-file-system` and the crypto
   * engine, and `src/api/tasks.ts` is on the cold path of every screen. `import
   * type` is erased at compile time, so nothing is added to the module graph.
   */
  blob?: HouseBlobDescriptor | null;
}

/**
 * Server-computed "add to planned spending" suggestion. The backend owns the
 * whole decision tree, copy, and cost formatting; the chip just renders these
 * strings.
 */
export interface TaskPurchaseSuggestion {
  /** 'actionable' → show the add chip; 'added' → show the confirmation. */
  state: 'actionable' | 'added';
  /** Primary line, e.g. "Looks like a purchase". */
  title: string;
  /** Secondary line, e.g. "Add to planned spending · ~$450–$900". Null when none. */
  subtitle: string | null;
  /** Pre-formatted cost, e.g. "$450–$900", or null when unknown. */
  amount_label: string | null;
  /** Label for the accept button. */
  action_label: string;
}

export interface Task {
  id: string;
  system_category: string | null;
  title: string;
  description: string | null;
  frequency: 'one_time' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
  custom_interval_days: number | null;
  next_due_date: string | null;
  last_completed_at: string | null;
  assigned_to: {
    id: string;
    display_name: string | null;
  } | null;
  /** Room/area this task belongs to (FK householdSpaces). Used for board "by area" grouping/filter. */
  space_id?: string | null;
  is_active: boolean;
  source: 'manual' | 'ai_generated' | 'template';
  /** Priority/severity level (default: nice_to_have). Optional for backwards compatibility. */
  priority_severity?: TaskPrioritySeverity;
  // ===== Smart Task Assistant (AI enrichment) =====
  /** Risk if neglected, assessed independently of priority. Null until enriched. */
  risk_level?: TaskRiskLevel | null;
  /** Effort/skill required. Null until enriched. */
  complexity?: TaskComplexity | null;
  /** Coarse "how long will this take" tier (Quick … All day). Null until enriched. */
  time_effort?: TimeEffort | null;
  /** Short plain-language explanation of the risk/priority call. */
  ai_rationale?: string | null;
  /**
   * Async enrichment lifecycle. 'pending'/'enriching' → show "Analyzing…" and
   * poll; 'enriched' → final; 'needs_clarification' → the AI couldn't
   * interpret the raw text and is asking a question instead of guessing;
   * 'failed' → user can edit manually. Null on legacy / manually-created
   * tasks (no enrichment).
   */
  enrichment_status?: TaskEnrichmentStatus | null;
  /** Set when enrichment_status='needs_clarification' — what the AI is asking. */
  clarification_question?: string | null;
  /**
   * Server-computed "add to planned spending" suggestion for purchase tasks.
   * Null when nothing should be shown. Rendered verbatim by the chip — all the
   * decision + formatting logic lives on the backend.
   */
  purchase_suggestion?: TaskPurchaseSuggestion | null;
  // ===== Blockers (household sharing) =====
  blocked?: boolean;
  blocker_reason?: string | null;
  blocked_at?: string | null;
  blocked_by?: { id: string; display_name: string | null } | null;
  // Reminder settings
  reminder_enabled: boolean;
  reminder_days_before: number;
  reminder_time: string;
  reminder_repeat: boolean;
  snooze_until?: string;
  // Contractor and quote management fields
  needs_contractor?: boolean;
  contractor_category?: string;
  workflow_stage?: TaskWorkflowStage;
  scheduled_work_date?: string;
  scheduled_work_time_start?: string;
  scheduled_work_time_end?: string;
  selected_quote_id?: string;
  linked_project_id?: string;
  /** True when this task is private to the user who created it. */
  is_personal?: boolean;
  /** ID of the user who created this task. */
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  photos?: TaskPhoto[];
  cover_photo_id?: string | null;
  cover_photo_url?: string | null;
  // Subtasks (if loaded)
  subtasks?: MaintenanceSubtask[];
  subtask_progress?: SubtaskProgress;
}

export interface MaintenanceCompletion {
  id: string;
  completed_by: {
    id: string;
    display_name: string | null;
  };
  completed_at: string;
  notes: string | null;
  photo_keys: string[];
}

// Subtask types
export interface MaintenanceSubtask {
  id: string;
  task_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  is_completed: boolean;
  completed_at: string | null;
  completed_by: {
    id: string;
    display_name: string | null;
  } | null;
  reminder_enabled: boolean;
  reminder_days_before: number;
  reminder_time: string;
  reminder_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubtaskProgress {
  completed: number;
  total: number;
  percentage: number; // 0-100
}

export interface CreateSubtaskRequest {
  title: string; // Required, non-empty
  description?: string;
  sort_order?: number; // Defaults to end of list if not provided
  reminder_enabled?: boolean; // Defaults to false
  reminder_days_before?: number; // Defaults to 1 (if reminder enabled)
  reminder_time?: string; // HH:MM format, defaults to 09:00
}

export interface UpdateSubtaskRequest {
  title?: string;
  description?: string;
  reminder_enabled?: boolean;
  reminder_days_before?: number;
  reminder_time?: string; // HH:MM format
}

export interface ReorderSubtasksRequest {
  subtask_ids: string[]; // Ordered array of subtask IDs
}

// Request types
interface CreateTaskRequest {
  title: string;
  description?: string;
  system_category?: string;
  frequency: 'one_time' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
  custom_interval_days?: number;
  next_due_date?: string;
  assigned_to?: string;
  priority_severity?: TaskPrioritySeverity;
  time_effort?: TimeEffort | null;
  reminder_enabled?: boolean;
  reminder_days_before?: number;
  reminder_time?: string;
  reminder_repeat?: boolean;
  space_id?: string | null;
  is_personal?: boolean;
  photos?: Array<{ photo_key: string }>;
  cover_photo_index?: number;
}

interface UpdateTaskRequest
  extends Partial<Omit<CreateTaskRequest, 'assigned_to'>> {
  is_active?: boolean;
  space_id?: string | null;
  snooze_until?: string;
  /** Nullable so a task can be unassigned (cleared), not just reassigned. */
  assigned_to?: string | null;
  photos?: Array<{ photo_key: string }>;
  cover_photo_index?: number;
}

/** Fast-capture payload for {@link tasksApi.quickCreate}. */
export interface QuickCreateTaskRequest {
  /** Raw voice transcript or typed description; AI enriches the rest. */
  text: string;
  assigned_to?: string;
  space_id?: string | null;
  /** When true, this task is private — only visible to the current user. */
  is_personal?: boolean;
}

interface CompleteTaskRequest {
  notes?: string;
  photo_keys?: string[];
}

interface TaskFilters {
  system_category?: string;
  is_active?: boolean;
  limit?: number;
  cursor?: string;
}

interface PaginationFilters {
  limit?: number;
  cursor?: string;
}

// Response types
interface TasksListResponse {
  tasks: Task[];
  next_cursor?: string;
}

interface TaskResponse {
  task: Task;
}

interface CompleteTaskResponse {
  task: Task;
  completion: {
    id: string;
    completed_at: string;
    notes: string | null;
  };
}

interface CompletionHistoryResponse {
  completions: MaintenanceCompletion[];
  next_cursor?: string;
}

interface UpcomingTasksResponse {
  tasks: Task[];
}

// ===== Smart Task Assistant: planner + report =====

export interface PlannedTaskItem {
  task_id: string;
  title: string;
  /** Minutes allocated within the user's time budget (not a task-time estimate). */
  minutes: number;
  /** Effort tier shown per task instead of a precise time. */
  time_effort: TimeEffort | null;
  score: number;
  partial: boolean;
  subtask_ids?: string[];
  reason: string;
}

export interface SkippedTaskItem {
  task_id: string;
  title: string;
  minutes: number;
  time_effort: TimeEffort | null;
  reason: 'no_time_left' | 'too_long';
}

export interface TaskBudgetPlan {
  budget_minutes: number;
  used_minutes: number;
  selected: PlannedTaskItem[];
  skipped: SkippedTaskItem[];
}

export interface TaskReport {
  generated_at: string;
  total_active: number;
  overdue: number;
  due_today: number;
  due_this_week: number;
  later: number;
  no_due_date: number;
  high_risk: number;
  top_tasks: Array<{
    task_id: string;
    title: string;
    score: number;
    risk_level: TaskRiskLevel | null;
    priority_severity: TaskPrioritySeverity | null;
    time_effort: TimeEffort | null;
    days_until_due: number | null;
  }>;
}

interface PlanResponse {
  plan: TaskBudgetPlan;
}

interface ReportResponse {
  report: TaskReport;
}

// ===== Activity feed (notes) =====
export interface TaskNote {
  id: string;
  kind: 'progress' | 'blocker' | 'resolution' | string;
  body: string;
  created_at: string;
  author: { id: string; display_name: string | null } | null;
}

interface NotesResponse {
  notes: TaskNote[];
}

// Quote management types
interface RequestQuotesRequest {
  contractor_ids: string[];
  description?: string;
}

interface SelectQuoteRequest {
  quote_id: string;
}

interface UpdateWorkflowStageRequest {
  workflow_stage: TaskWorkflowStage;
}

interface ScheduleWorkRequest {
  scheduled_date: string;
  scheduled_time_start?: string;
  scheduled_time_end?: string;
  contractor_id?: string; // Optional - backend will fetch from quote if not provided
}

const remoteTasksApi = {
  // Task CRUD
  list: (householdId: string, filters?: TaskFilters) =>
    apiClient
      .get<TasksListResponse>(
        `/households/${householdId}/tasks`,
        { params: filters }
      )
      .then((res) => {
        const data = res.data;
        if (!shouldValidateApiResponses()) return data;
        return validateApiResponse(
          tasksListResponseSchema,
          data,
          `GET /households/${householdId}/tasks`
        );
      }),

  getUpcoming: (householdId: string, days: number = 7) =>
    apiClient
      .get<UpcomingTasksResponse>(
        `/households/${householdId}/tasks/upcoming`,
        { params: { days } }
      )
      .then((res) => {
        const data = res.data;
        if (!shouldValidateApiResponses()) return data;
        return validateApiResponse(
          tasksListResponseSchema,
          data,
          `GET /households/${householdId}/tasks/upcoming`
        );
      }),

  create: (householdId: string, data: CreateTaskRequest) =>
    apiClient
      .post<TaskResponse>(
        `/households/${householdId}/tasks`,
        data
      )
      .then((res) => res.data),

  /**
   * Smart Task Assistant fast capture. Persists a minimal task instantly from a
   * raw voice/typed description and kicks off async AI enrichment (risk,
   * priority, complexity, time effort, subtasks). Returns 201 immediately with
   * the provisional task (`enrichment_status: 'pending'`); poll/refetch to pick
   * up the enriched result.
   */
  quickCreate: (householdId: string, data: QuickCreateTaskRequest) =>
    apiClient
      .post<TaskResponse>(
        `/households/${householdId}/tasks/quick`,
        data
      )
      .then((res) => res.data),

  get: (householdId: string, taskId: string) =>
    apiClient
      .get<TaskResponse>(
        `/households/${householdId}/tasks/${taskId}`
      )
      .then((res) => res.data),

  /** "What can I do in N minutes?" — deterministic, budget-aware task plan. */
  getPlan: (householdId: string, minutes: number) =>
    apiClient
      .get<PlanResponse>(
        `/households/${householdId}/tasks/plan`,
        { params: { minutes } }
      )
      .then((res) => res.data.plan),

  /** Actionable summary over active tasks (counts, high-risk, top items). */
  getReport: (householdId: string) =>
    apiClient
      .get<ReportResponse>(
        `/households/${householdId}/tasks/report`
      )
      .then((res) => res.data.report),

  // ===== Blockers + activity feed (household sharing) =====

  /** Flag a task as blocked with a reason. */
  reportBlocker: (householdId: string, taskId: string, reason: string) =>
    apiClient
      .post<TaskResponse>(
        `/households/${householdId}/tasks/${taskId}/block`,
        { reason }
      )
      .then((res) => res.data),

  /** Clear a task's blocked state (optional resolution note). */
  resolveBlocker: (householdId: string, taskId: string, note?: string) =>
    apiClient
      .post<TaskResponse>(
        `/households/${householdId}/tasks/${taskId}/unblock`,
        note ? { note } : {}
      )
      .then((res) => res.data),

  // ===== Purchase → planned-spending suggestion =====

  /**
   * Accept the AI "this task is a purchase" suggestion: create a planned-spending
   * item linked to the task. Returns the new budget item plus the refreshed task
   * (now carrying `budget_item_id`). Idempotent server-side.
   */
  createBudgetItemFromTask: (householdId: string, taskId: string) =>
    apiClient
      .post<{ item: BudgetItem; task: Task }>(
        `/households/${householdId}/tasks/${taskId}/budget-item`,
        {}
      )
      .then((res) => res.data),

  /** Dismiss the "add to planned spending" chip for a task (no budget item created). */
  dismissPurchaseSuggestion: (householdId: string, taskId: string) =>
    apiClient
      .post<TaskResponse>(
        `/households/${householdId}/tasks/${taskId}/dismiss-purchase`,
        {}
      )
      .then((res) => res.data),

  /** List a task's household activity feed (newest first). */
  listNotes: (householdId: string, taskId: string) =>
    apiClient
      .get<NotesResponse>(
        `/households/${householdId}/tasks/${taskId}/notes`
      )
      .then((res) => res.data.notes),

  /** Add a progress note to a task's activity feed. */
  addNote: (householdId: string, taskId: string, body: string) =>
    apiClient
      .post<{ note: { id: string; created_at: string } }>(
        `/households/${householdId}/tasks/${taskId}/notes`,
        { body }
      )
      .then((res) => res.data.note),

  update: (
    householdId: string,
    taskId: string,
    data: UpdateTaskRequest
  ) =>
    apiClient
      .patch<TaskResponse>(
        `/households/${householdId}/tasks/${taskId}`,
        data
      )
      .then((res) => res.data),

  delete: (householdId: string, taskId: string) =>
    apiClient.delete(
      `/households/${householdId}/tasks/${taskId}`
    ),

  // Completion
  complete: (householdId: string, taskId: string, data: CompleteTaskRequest) =>
    apiClient
      .post<CompleteTaskResponse>(
        `/households/${householdId}/tasks/${taskId}/complete`,
        data
      )
      .then((res) => res.data),

  getHistory: (
    householdId: string,
    taskId: string,
    filters?: PaginationFilters
  ) =>
    apiClient
      .get<CompletionHistoryResponse>(
        `/households/${householdId}/tasks/${taskId}/history`,
        { params: filters }
      )
      .then((res) => res.data),

  // Quote management for tasks
  getTaskQuotes: (householdId: string, taskId: string) =>
    apiClient
      .get<{ quotes: any[] }>(
        `/households/${householdId}/tasks/${taskId}/quotes`
      )
      .then((res) => res.data),

  requestTaskQuotes: (
    householdId: string,
    taskId: string,
    data: RequestQuotesRequest
  ) =>
    apiClient
      .post<{ quotes: any[] }>(
        `/households/${householdId}/tasks/${taskId}/quotes/request`,
        data
      )
      .then((res) => res.data),

  compareTaskQuotesWithAI: (
    householdId: string,
    taskId: string,
    quoteIds: string[]
  ) =>
    apiClient
      .post<{ comparison: any }>(
        `/households/${householdId}/tasks/${taskId}/quotes/compare-ai`,
        { quote_ids: quoteIds }
      )
      .then((res) => res.data),

  selectTaskQuote: (
    householdId: string,
    taskId: string,
    data: SelectQuoteRequest
  ) =>
    apiClient
      .post<TaskResponse>(
        `/households/${householdId}/tasks/${taskId}/select-quote`,
        data
      )
      .then((res) => res.data),

  updateWorkflowStage: (
    householdId: string,
    taskId: string,
    data: UpdateWorkflowStageRequest
  ) =>
    apiClient
      .patch<TaskResponse>(
        `/households/${householdId}/tasks/${taskId}/workflow-stage`,
        data
      )
      .then((res) => res.data),

  scheduleTaskWork: (
    householdId: string,
    taskId: string,
    data: ScheduleWorkRequest
  ) =>
    apiClient
      .post<TaskResponse>(
        `/households/${householdId}/tasks/${taskId}/schedule-work`,
        data
      )
      .then((res) => res.data),

  // Subtask management
  createSubtask: (
    householdId: string,
    taskId: string,
    data: CreateSubtaskRequest
  ) =>
    apiClient
      .post<{ subtask: MaintenanceSubtask }>(
        `/households/${householdId}/tasks/${taskId}/subtasks`,
        data
      )
      .then((res) => res.data.subtask),

  listSubtasks: (householdId: string, taskId: string) =>
    apiClient
      .get<{ subtasks: MaintenanceSubtask[] }>(
        `/households/${householdId}/tasks/${taskId}/subtasks`
      )
      .then((res) => res.data.subtasks),

  getSubtask: (householdId: string, taskId: string, subtaskId: string) =>
    apiClient
      .get<{ subtask: MaintenanceSubtask }>(
        `/households/${householdId}/tasks/${taskId}/subtasks/${subtaskId}`
      )
      .then((res) => res.data.subtask),

  updateSubtask: (
    householdId: string,
    taskId: string,
    subtaskId: string,
    data: UpdateSubtaskRequest
  ) =>
    apiClient
      .patch<{ subtask: MaintenanceSubtask }>(
        `/households/${householdId}/tasks/${taskId}/subtasks/${subtaskId}`,
        data
      )
      .then((res) => res.data.subtask),

  deleteSubtask: (householdId: string, taskId: string, subtaskId: string) =>
    apiClient
      .delete<{ message: string }>(
        `/households/${householdId}/tasks/${taskId}/subtasks/${subtaskId}`
      )
      .then((res) => res.data),

  completeSubtask: (householdId: string, taskId: string, subtaskId: string) =>
    apiClient
      .post<{ subtask: MaintenanceSubtask; task: Task }>(
        `/households/${householdId}/tasks/${taskId}/subtasks/${subtaskId}/complete`,
        {}
      )
      .then((res) => res.data),

  uncompleteSubtask: (householdId: string, taskId: string, subtaskId: string) =>
    apiClient
      .post<{ subtask: MaintenanceSubtask; task: Task }>(
        `/households/${householdId}/tasks/${taskId}/subtasks/${subtaskId}/uncomplete`,
        {}
      )
      .then((res) => res.data),

  reorderSubtasks: (
    householdId: string,
    taskId: string,
    subtaskIds: string[]
  ) =>
    apiClient
      .post<{ subtasks: MaintenanceSubtask[] }>(
        `/households/${householdId}/tasks/${taskId}/subtasks/reorder`,
        { subtask_ids: subtaskIds }
      )
      .then((res) => res.data.subtasks),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens and stores call
 * `tasksApi` exactly as before; the Proxy is what makes the H3 cutover cost
 * zero screen edits. See `documents/requirements/House v2/` §6.
 */
export const tasksApi: typeof remoteTasksApi = createHouseLocalProxy(remoteTasksApi, {
  moduleName: 'tasks',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localTasksApi').localTasksApi,
});
