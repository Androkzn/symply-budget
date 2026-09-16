import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';

// Types
export interface HouseholdSpace {
  id: string;
  household_id: string;
  name: string;
  space_type: 'preset' | 'custom';
  category: 'indoor' | 'outdoor' | 'garage' | 'basement' | 'attic' | null;
  floor_level: number | null;
  icon_emoji: string | null;
  icon_color: string | null;
  custom_image_key: string | null;
  custom_image_url: string | null;
  description: string | null;
  area_sqft: number | null;
  display_order: number;
  floor_plan_id?: string | null;
  plan_x_percent?: number | null;
  plan_y_percent?: number | null;
  plan_width_percent?: number | null;
  plan_height_percent?: number | null;
  created_at: string;
  updated_at: string;
  version: number;
  task_count?: number;
  maintenance_task_count?: number;
  action_item_count?: number;
}

export interface PresetSpaceTemplate {
  name: string;
  category: string;
  emoji: string;
  color: string;
}

// Request types
interface CreateSpaceRequest {
  name: string;
  space_type: 'preset' | 'custom';
  category?: 'indoor' | 'outdoor' | 'garage' | 'basement' | 'attic';
  floor_level?: number;
  icon_emoji?: string;
  icon_color?: string;
  custom_image_key?: string;
  description?: string;
  area_sqft?: number;
  display_order?: number;
  floor_plan_id?: string;
  plan_x_percent?: number;
  plan_y_percent?: number;
  plan_width_percent?: number;
  plan_height_percent?: number;
}

interface UpdateSpaceRequest extends Partial<CreateSpaceRequest> {
  version: number;
}

interface ReorderSpaceEntry {
  space_id: string;
  display_order: number;
  version: number;
}

// Response types
interface SpacesListResponse {
  spaces: HouseholdSpace[];
}

interface SpaceResponse {
  space: HouseholdSpace;
}

interface PresetsResponse {
  templates: PresetSpaceTemplate[];
}

const remoteHouseholdSpacesApi = {
  // List all spaces for a household
  list: (householdId: string, filters?: { category?: string; floor_level?: number }) =>
    apiClient
      .get<SpacesListResponse>(`/households/${householdId}/spaces`, { params: filters })
      .then((res) => res.data),

  // Get preset templates
  getPresets: (householdId: string) =>
    apiClient
      .get<PresetsResponse>(`/households/${householdId}/spaces/presets`)
      .then((res) => res.data),

  // Create a new space
  create: (householdId: string, data: CreateSpaceRequest) =>
    apiClient
      .post<SpaceResponse>(`/households/${householdId}/spaces`, data)
      .then((res) => res.data),

  // Bulk create spaces from template
  bulkCreate: (householdId: string, templateType: string) =>
    apiClient
      .post<SpacesListResponse>(`/households/${householdId}/spaces/bulk`, {
        template_type: templateType,
      })
      .then((res) => res.data),

  // Get a single space
  get: (householdId: string, spaceId: string) =>
    apiClient
      .get<SpaceResponse>(`/households/${householdId}/spaces/${spaceId}`)
      .then((res) => res.data),

  // Update a space (requires optimistic-lock `version` — B10)
  update: (householdId: string, spaceId: string, data: UpdateSpaceRequest) =>
    apiClient
      .patch<SpaceResponse>(`/households/${householdId}/spaces/${spaceId}`, data)
      .then((res) => res.data),

  // Delete a space (pass `version` when available for optimistic locking)
  delete: (householdId: string, spaceId: string, version?: number) =>
    apiClient.delete(`/households/${householdId}/spaces/${spaceId}`, {
      params: version !== undefined ? { version } : undefined,
    }),

  // Reorder spaces (each row requires `version` — B10)
  reorder: (householdId: string, spaceOrders: ReorderSpaceEntry[]) =>
    apiClient
      .post(`/households/${householdId}/spaces/reorder`, { space_orders: spaceOrders })
      .then((res) => res.data),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens and stores call
 * `householdSpacesApi` exactly as before; the Proxy is what makes the H3 cutover cost
 * zero screen edits. See `documents/requirements/House v2/` §6.
 */
export const householdSpacesApi: typeof remoteHouseholdSpacesApi = createHouseLocalProxy(remoteHouseholdSpacesApi, {
  moduleName: 'household-spaces',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localSpacesApi').localSpacesApi,
});
