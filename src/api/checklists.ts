import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';

// Types
export interface ChecklistItem {
  id: string;
  checklist_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  is_required: boolean;
  linked_task_id: string | null;
  created_at: string;
}

export interface Checklist {
  id: string;
  household_id: string;
  name: string;
  description: string | null;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'seasonal' | 'yearly' | 'custom';
  icon: string | null;
  color: string | null;
  is_active: boolean;
  season: string | null;
  custom_days: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  items: ChecklistItem[];
}

export interface ChecklistInstance {
  id: string;
  checklist_id: string;
  household_id: string;
  period_start: string;
  period_end: string;
  period_label: string | null;
  total_items: number;
  completed_items: number;
  status: 'not_started' | 'in_progress' | 'completed';
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistInstanceWithDetails extends ChecklistInstance {
  checklist: Checklist;
  completedItemIds: string[];
}

export interface ChecklistProgress {
  checklist: Checklist;
  currentInstance: ChecklistInstanceWithDetails | null;
  recentInstances: ChecklistInstance[];
  completionRate: number;
  streak: number;
}

export interface ChecklistItemCompletion {
  id: string;
  instance_id: string;
  item_id: string;
  completed_by: string;
  completed_at: string;
  notes: string | null;
}

// Request types
interface CreateChecklistRequest {
  name: string;
  description?: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'seasonal' | 'yearly' | 'custom';
  icon?: string;
  color?: string;
  season?: 'spring' | 'summer' | 'fall' | 'winter';
  custom_days?: number[];
  items: Array<{
    title: string;
    description?: string;
    is_required?: boolean;
  }>;
}

interface CompleteItemRequest {
  notes?: string;
}

// Response types
interface ChecklistsResponse {
  checklists: Checklist[];
}

interface ChecklistResponse {
  checklist: Checklist;
}

interface InstanceResponse {
  instance: ChecklistInstanceWithDetails | null;
}

interface ProgressResponse {
  progress: ChecklistProgress[];
}

interface CompleteItemResponse {
  instance: ChecklistInstance;
  completion: ChecklistItemCompletion;
}

const remoteChecklistsApi = {
  // Checklists
  getAll: (householdId: string) =>
    apiClient
      .get<ChecklistsResponse>(`/households/${householdId}/checklists`)
      .then((res) => res.data),

  create: (householdId: string, data: CreateChecklistRequest) =>
    apiClient
      .post<ChecklistResponse>(`/households/${householdId}/checklists`, data)
      .then((res) => res.data),

  delete: (householdId: string, checklistId: string) =>
    apiClient.delete(`/households/${householdId}/checklists/${checklistId}`),

  // Progress
  getProgress: (householdId: string) =>
    apiClient
      .get<ProgressResponse>(`/households/${householdId}/checklists/progress`)
      .then((res) => res.data),

  // Instances
  getCurrentInstance: (householdId: string, checklistId: string) =>
    apiClient
      .get<InstanceResponse>(`/households/${householdId}/checklists/${checklistId}/current`)
      .then((res) => res.data),

  // Item completion
  completeItem: (
    householdId: string,
    instanceId: string,
    itemId: string,
    data?: CompleteItemRequest
  ) =>
    apiClient
      .post<CompleteItemResponse>(
        `/households/${householdId}/checklists/instances/${instanceId}/items/${itemId}/complete`,
        data || {}
      )
      .then((res) => res.data),

  uncompleteItem: (householdId: string, instanceId: string, itemId: string) =>
    apiClient.delete(
      `/households/${householdId}/checklists/instances/${instanceId}/items/${itemId}/complete`
    ),

  // Defaults
  createDefaults: (householdId: string) =>
    apiClient.post(`/households/${householdId}/checklists/create-defaults`),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens and stores call
 * `checklistsApi` exactly as before; the Proxy is what makes the H3 cutover cost
 * zero screen edits. See `documents/requirements/House v2/` §6.
 */
export const checklistsApi: typeof remoteChecklistsApi = createHouseLocalProxy(remoteChecklistsApi, {
  moduleName: 'checklists',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localChecklistsApi').localChecklistsApi,
});
