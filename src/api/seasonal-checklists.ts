import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';

// Types
export type Season = 'spring' | 'summer' | 'fall' | 'winter';

export interface SeasonalChecklistItem {
  id: string;
  checklist_id: string;
  task_template_id?: string;
  title: string;
  category?: string;
  is_completed: boolean;
  notes?: string;
  photo_keys?: string[];
  sort_order: number;
  completed_at?: string;
}

export interface SeasonalChecklist {
  id: string;
  household_id: string;
  season: Season;
  year: number;
  climate_zone: string;
  items: SeasonalChecklistItem[];
  progress: {
    total: number;
    completed: number;
    percentage: number;
  };
  created_at: string;
  updated_at: string;
}

// Request types
interface CreateChecklistRequest {
  season: Season;
  year: number;
  climate_zone?: string;
}

interface AddItemRequest {
  task_template_id?: string;
  title: string;
  category?: string;
  sort_order?: number;
}

interface UpdateItemRequest {
  is_completed?: boolean;
  notes?: string;
  photo_keys?: string[];
}

// Response types
interface ChecklistResponse {
  checklist: SeasonalChecklist;
}

interface ChecklistsListResponse {
  checklists: SeasonalChecklist[];
}

interface ItemResponse {
  item: SeasonalChecklistItem;
}

const remoteSeasonalChecklistsApi = {
  list: (householdId: string, filters?: { season?: Season; year?: number }) =>
    apiClient
      .get<ChecklistsListResponse>(`/households/${householdId}/seasonal-checklists`, {
        params: filters,
      })
      .then((res) => res.data),

  get: (householdId: string, checklistId: string) =>
    apiClient
      .get<ChecklistResponse>(`/households/${householdId}/seasonal-checklists/${checklistId}`)
      .then((res) => res.data),

  getCurrent: (householdId: string, options?: { season?: Season; year?: number; climate_zone?: string }) =>
    apiClient
      .get<ChecklistResponse>(`/households/${householdId}/seasonal-checklists/current`, {
        params: options,
      })
      .then((res) => res.data),

  create: (householdId: string, data: CreateChecklistRequest) =>
    apiClient
      .post<ChecklistResponse>(`/households/${householdId}/seasonal-checklists`, data)
      .then((res) => res.data),

  addItem: (householdId: string, checklistId: string, data: AddItemRequest) =>
    apiClient
      .post<ItemResponse>(`/households/${householdId}/seasonal-checklists/${checklistId}/items`, data)
      .then((res) => res.data),

  updateItem: (
    householdId: string,
    checklistId: string,
    itemId: string,
    data: UpdateItemRequest
  ) =>
    apiClient
      .patch<ItemResponse>(
        `/households/${householdId}/seasonal-checklists/${checklistId}/items/${itemId}`,
        data
      )
      .then((res) => res.data),
};

// Season helpers
export const SEASONS: { id: Season; label: string; icon: string; months: string }[] = [
  { id: 'spring', label: 'Spring', icon: 'flower', months: 'Mar - May' },
  { id: 'summer', label: 'Summer', icon: 'sunny', months: 'Jun - Aug' },
  { id: 'fall', label: 'Fall', icon: 'leaf', months: 'Sep - Nov' },
  { id: 'winter', label: 'Winter', icon: 'snow', months: 'Dec - Feb' },
];

export function getCurrentSeason(): Season {
  const month = new Date().getMonth() + 1; // 1-12
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'fall';
  return 'winter';
}

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens and stores call
 * `seasonalChecklistsApi` exactly as before; the Proxy is what makes the H3 cutover cost
 * zero screen edits. See `documents/requirements/House v2/` §6.
 */
export const seasonalChecklistsApi: typeof remoteSeasonalChecklistsApi = createHouseLocalProxy(remoteSeasonalChecklistsApi, {
  moduleName: 'seasonal-checklists',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localSeasonalChecklistsApi').localSeasonalChecklistsApi,
});
