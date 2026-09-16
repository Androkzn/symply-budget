import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { api, ensureData } from './client';

// Types
export interface TaskDraft {
  id: string;
  household_id: string;
  report_id: string;
  finding_id: string | null;
  title: string;
  description: string | null;
  plain_language_summary: string | null;
  system_category: string;
  severity: 'critical' | 'major' | 'minor' | 'informational';
  priority_score: number | null;
  suggested_timeframe: '0-30_days' | '3-6_months' | '1_year' | '2-5_years' | '5-10_years' | null;
  suggested_frequency: 'one_time' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom' | null;
  is_recurring_suggestion: boolean;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  diy_possible: boolean;
  diy_difficulty: 'easy' | 'medium' | 'hard' | 'professional_only' | null;
  diy_cost_min: number | null;
  diy_cost_max: number | null;
  source_page_numbers: number[];
  source_quotes: string[];
  image_ids: string[];
  status: 'draft' | 'converted' | 'dismissed';
  converted_to_task_id: string | null;
  dismissed_reason: string | null;
  dismissed_at: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskDraftWithRelations extends TaskDraft {
  finding?: {
    id: string;
    title: string;
    description: string;
    severity: string;
    evidence_page_numbers: string;
  } | null;
  images?: Array<{
    id: string;
    image_key: string;
    page_number: number | null;
    caption: string | null;
  }>;
}

export interface TaskDraftsSummary {
  total: number;
  by_severity: {
    critical: number;
    major: number;
    minor: number;
    informational: number;
  };
  by_category: Record<string, number>;
  total_cost_min: number;
  total_cost_max: number;
  diy_possible_count: number;
  recurring_suggestions: number;
}

// Request types
export interface TaskDraftsFilters {
  report_id?: string;
  status?: 'draft' | 'converted' | 'dismissed';
  severity?: 'critical' | 'major' | 'minor' | 'informational';
  system_category?: string;
  sort_by?: 'severity' | 'category' | 'priority_score' | 'created_at';
  sort_order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ConvertDraftRequest {
  add_recurring?: boolean;
  frequency?: string;
  start_date?: string;
}

export interface BulkConvertRequest {
  draft_ids: string[];
}

export interface DismissDraftRequest {
  reason?: string;
}

// Response types
interface DraftsListResponse {
  drafts: TaskDraft[];
  total: number;
  limit: number;
  offset: number;
}

interface DraftDetailResponse {
  draft: TaskDraftWithRelations;
}

interface SummaryResponse {
  summary: TaskDraftsSummary;
}

interface GenerateResponse {
  draftsCreated: number;
  error?: string;
}

interface ConvertResponse {
  taskId?: string;
  actionItemId?: string;
}

interface BulkConvertResponse {
  success: number;
  failed: number;
  errors: string[];
}

// API functions
const remoteTaskDraftsApi = {
  /**
   * List task drafts with filtering and sorting
   */
  list: async (
    householdId: string,
    filters?: TaskDraftsFilters
  ): Promise<DraftsListResponse> => {
    const params = new URLSearchParams();

    if (filters?.report_id) params.append('report_id', filters.report_id);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.severity) params.append('severity', filters.severity);
    if (filters?.system_category) params.append('system_category', filters.system_category);
    if (filters?.sort_by) params.append('sort_by', filters.sort_by);
    if (filters?.sort_order) params.append('sort_order', filters.sort_order);
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.offset) params.append('offset', String(filters.offset));

    const queryString = params.toString();
    const url = `/households/${householdId}/task-drafts${queryString ? `?${queryString}` : ''}`;

    const response = await api.get<DraftsListResponse>(url);
    const data = ensureData(response, 'Failed to get task drafts');

    // Parse JSON arrays from string if needed
    return {
      ...data,
      drafts: data.drafts.map(parseDraft),
    };
  },

  /**
   * Get summary statistics for task drafts
   */
  getSummary: async (
    householdId: string,
    reportId?: string
  ): Promise<TaskDraftsSummary> => {
    const url = reportId
      ? `/households/${householdId}/task-drafts/summary?report_id=${reportId}`
      : `/households/${householdId}/task-drafts/summary`;

    const response = await api.get<SummaryResponse>(url);
    return ensureData(response, 'Failed to get task drafts summary').summary;
  },

  /**
   * Generate task drafts from a report's findings
   */
  generate: async (
    householdId: string,
    reportId: string
  ): Promise<GenerateResponse> => {
    const response = await api.post<GenerateResponse>(
      `/households/${householdId}/task-drafts/generate`,
      { report_id: reportId }
    );
    return ensureData(response, 'Failed to generate task drafts');
  },

  /**
   * Get a single task draft with related data
   */
  get: async (
    householdId: string,
    draftId: string
  ): Promise<TaskDraftWithRelations> => {
    const response = await api.get<DraftDetailResponse>(
      `/households/${householdId}/task-drafts/${draftId}`
    );
    return parseDraft(ensureData(response, 'Failed to get task draft').draft) as TaskDraftWithRelations;
  },

  /**
   * Convert a task draft to maintenance task or action item
   */
  convert: async (
    householdId: string,
    draftId: string,
    request: ConvertDraftRequest
  ): Promise<ConvertResponse> => {
    const response = await api.post<ConvertResponse>(
      `/households/${householdId}/task-drafts/${draftId}/convert`,
      request
    );
    return ensureData(response, 'Failed to convert task draft');
  },

  /**
   * Bulk convert multiple drafts
   */
  bulkConvert: async (
    householdId: string,
    request: BulkConvertRequest
  ): Promise<BulkConvertResponse> => {
    const response = await api.post<BulkConvertResponse>(
      `/households/${householdId}/task-drafts/bulk-convert`,
      request
    );
    return ensureData(response, 'Failed to bulk convert task drafts');
  },

  /**
   * Dismiss a task draft
   */
  dismiss: async (
    householdId: string,
    draftId: string,
    request?: DismissDraftRequest
  ): Promise<{ success: boolean }> => {
    const response = await api.post<{ success: boolean }>(
      `/households/${householdId}/task-drafts/${draftId}/dismiss`,
      request || {}
    );
    return ensureData(response, 'Failed to dismiss task draft');
  },

  /**
   * Delete a task draft
   */
  delete: async (
    householdId: string,
    draftId: string
  ): Promise<{ success: boolean }> => {
    const response = await api.delete<{ success: boolean }>(
      `/households/${householdId}/task-drafts/${draftId}`
    );
    return ensureData(response, 'Failed to delete task draft');
  },
};

// Helper to parse JSON string fields
function parseDraft<T extends TaskDraft>(draft: T): T {
  return {
    ...draft,
    source_page_numbers: parseJsonArray(draft.source_page_numbers as unknown as string),
    source_quotes: parseJsonArray(draft.source_quotes as unknown as string),
    image_ids: parseJsonArray(draft.image_ids as unknown as string),
  };
}

function parseJsonArray(value: string | unknown[] | null): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens and stores call
 * `taskDraftsApi` exactly as before; the Proxy is what makes the H3 cutover cost
 * zero screen edits. See `documents/requirements/House v2/` §6.
 */
export const taskDraftsApi: typeof remoteTaskDraftsApi = createHouseLocalProxy(remoteTaskDraftsApi, {
  moduleName: 'task-drafts',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localTaskDraftsApi').localTaskDraftsApi,
});
