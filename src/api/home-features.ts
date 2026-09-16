import { createHouseLocalProxy } from '@features/house/local/localApiProxy';
import { homeFeaturesListResponseSchema } from '@symply/contracts';

import { api, ensureData } from './client';
import { shouldValidateApiResponses, validateApiResponse } from './validateResponse';

// Types
export interface HomeFeature {
  id: string;
  household_id: string;
  feature_type: string;
  feature_subtype: string | null;
  quantity: number;
  location: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  warranty_expires: string | null;
  age_years: number | null;
  condition: 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';
  notes: string | null;
  source: 'manual' | 'report_extraction' | 'user_input';
  source_report_id: string | null;
  extraction_confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateHomeFeatureRequest {
  feature_type: string;
  feature_subtype?: string;
  quantity?: number;
  location?: string;
  brand?: string;
  model?: string;
  serial_number?: string;
  install_date?: string;
  warranty_expires?: string;
  age_years?: number;
  condition?: 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';
  notes?: string;
}

export interface UpdateHomeFeatureRequest extends Partial<CreateHomeFeatureRequest> {}

// Feature type options for UI
export const FEATURE_TYPES = [
  { value: 'hvac', label: 'HVAC System' },
  { value: 'central_ac', label: 'Central AC' },
  { value: 'furnace', label: 'Furnace' },
  { value: 'heat_pump', label: 'Heat Pump' },
  { value: 'boiler', label: 'Boiler' },
  { value: 'water_heater', label: 'Water Heater' },
  { value: 'tankless_water_heater', label: 'Tankless Water Heater' },
  { value: 'fireplace', label: 'Fireplace' },
  { value: 'wood_stove', label: 'Wood Stove' },
  { value: 'pool', label: 'Pool' },
  { value: 'hot_tub', label: 'Hot Tub' },
  { value: 'septic', label: 'Septic System' },
  { value: 'well', label: 'Well' },
  { value: 'water_softener', label: 'Water Softener' },
  { value: 'sump_pump', label: 'Sump Pump' },
  { value: 'solar_panels', label: 'Solar Panels' },
  { value: 'generator', label: 'Generator' },
  { value: 'security_system', label: 'Security System' },
  { value: 'garage_door', label: 'Garage Door Opener' },
  { value: 'irrigation_system', label: 'Irrigation System' },
  { value: 'radon_mitigation', label: 'Radon Mitigation' },
  { value: 'central_vacuum', label: 'Central Vacuum' },
  { value: 'other', label: 'Other' },
] as const;

export const FEATURE_SUBTYPES: Record<string, Array<{ value: string; label: string }>> = {
  fireplace: [
    { value: 'wood_burning', label: 'Wood Burning' },
    { value: 'gas', label: 'Gas' },
    { value: 'electric', label: 'Electric' },
    { value: 'pellet', label: 'Pellet' },
  ],
  water_heater: [
    { value: 'gas', label: 'Gas' },
    { value: 'electric', label: 'Electric' },
    { value: 'propane', label: 'Propane' },
    { value: 'solar', label: 'Solar' },
    { value: 'heat_pump', label: 'Heat Pump' },
  ],
  hvac: [
    { value: 'central', label: 'Central' },
    { value: 'mini_split', label: 'Mini Split' },
    { value: 'window', label: 'Window Units' },
  ],
  pool: [
    { value: 'inground', label: 'In-ground' },
    { value: 'above_ground', label: 'Above Ground' },
  ],
};

export const CONDITION_OPTIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'unknown', label: 'Unknown' },
] as const;

// API functions
const remoteHomeFeaturesApi = {
  /**
   * Get all home features for a household
   */
  async getFeatures(householdId: string): Promise<HomeFeature[]> {
    const response = await api.get<{ features: HomeFeature[] }>(
      `/households/${householdId}/home-features`
    );
    const data = ensureData(response, 'Failed to get home features');
    if (!shouldValidateApiResponses()) return data.features;
    const parsed = validateApiResponse(
      homeFeaturesListResponseSchema,
      data,
      `GET /households/${householdId}/home-features`,
    );
    return parsed.features;
  },

  /**
   * Get a single home feature
   */
  async getFeature(householdId: string, featureId: string): Promise<HomeFeature> {
    const response = await api.get<{ feature: HomeFeature }>(
      `/households/${householdId}/home-features/${featureId}`
    );
    return ensureData(response, 'Failed to get home feature').feature;
  },

  /**
   * Create a new home feature
   */
  async createFeature(
    householdId: string,
    data: CreateHomeFeatureRequest
  ): Promise<HomeFeature> {
    const response = await api.post<{ feature: HomeFeature }>(
      `/households/${householdId}/home-features`,
      data
    );
    return ensureData(response, 'Failed to create home feature').feature;
  },

  /**
   * Update a home feature
   */
  async updateFeature(
    householdId: string,
    featureId: string,
    data: UpdateHomeFeatureRequest
  ): Promise<HomeFeature> {
    const response = await api.put<{ feature: HomeFeature }>(
      `/households/${householdId}/home-features/${featureId}`,
      data
    );
    return ensureData(response, 'Failed to update home feature').feature;
  },

  /**
   * Delete a home feature
   */
  async deleteFeature(householdId: string, featureId: string): Promise<void> {
    await api.delete(`/households/${householdId}/home-features/${featureId}`);
  },

  /**
   * Get features by type
   */
  async getFeaturesByType(
    householdId: string,
    featureType: string
  ): Promise<HomeFeature[]> {
    const params = new URLSearchParams({ type: featureType });
    const response = await api.get<{ features: HomeFeature[] }>(
      `/households/${householdId}/home-features?${params.toString()}`
    );
    return ensureData(response, 'Failed to get home features by type').features;
  },
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens and stores call
 * `homeFeaturesApi` exactly as before; the Proxy is what makes the H3 cutover cost
 * zero screen edits. See `documents/requirements/House v2/` §6.
 */
export const homeFeaturesApi: typeof remoteHomeFeaturesApi = createHouseLocalProxy(remoteHomeFeaturesApi, {
  moduleName: 'home-features',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localHomeFeaturesApi').localHomeFeaturesApi,
});
