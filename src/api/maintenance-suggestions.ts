import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { api, ensureData } from './client';

// Types
export interface MaintenanceSuggestion {
  id: string;
  household_id: string;
  feature_id: string;
  template_id: string;
  // Suggestion details from template
  title: string;
  description: string | null;
  frequency: string;
  suggested_start_date: string | null;
  // Status
  status: 'pending' | 'accepted' | 'dismissed' | 'snoozed';
  applied_task_id: string | null;
  accepted_at: string | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  snooze_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceTemplate {
  id: string;
  title: string;
  description: string | null;
  plain_language_description: string | null;
  feature_type: string;
  feature_subtype: string | null;
  frequency: string;
  best_season: 'spring' | 'summer' | 'fall' | 'winter' | 'any' | null;
  best_month: number | null;
  system_category: string;
  estimated_duration_minutes: number | null;
  diy_difficulty: 'easy' | 'medium' | 'hard' | 'professional_only' | null;
  professional_recommended: boolean;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  diy_cost_min: number | null;
  diy_cost_max: number | null;
  why_important: string | null;
  neglect_consequences: string | null;
  how_to_steps: string[] | null;
  tools_needed: string[] | null;
  materials_needed: string[] | null;
  safety_warnings: string[] | null;
  video_url: string | null;
  article_url: string | null;
}

export interface SuggestionWithTemplate extends MaintenanceSuggestion {
  template: Partial<MaintenanceTemplate>;
  feature?: {
    id: string;
    feature_type: string;
    feature_subtype: string | null;
    location: string | null;
  };
}

export interface ApplySuggestionsRequest {
  suggestion_ids: string[];
  start_date?: string;
}

export interface DismissSuggestionRequest {
  reason?: string;
}

export interface SnoozeSuggestionRequest {
  snooze_until: string;
}

// Suggestion status display info
export const SUGGESTION_STATUS_INFO: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  pending: { label: 'Pending Review', color: '#FFA500', icon: 'clock-outline' },
  accepted: { label: 'Added to Tasks', color: '#4CAF50', icon: 'check-circle' },
  dismissed: { label: 'Dismissed', color: '#9E9E9E', icon: 'close-circle' },
  snoozed: { label: 'Snoozed', color: '#2196F3', icon: 'alarm-snooze' },
};

// Frequency display
export const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  semi_annual: 'Every 6 months',
  yearly: 'Yearly',
  every_2_years: 'Every 2 years',
  every_3_years: 'Every 3 years',
  every_5_years: 'Every 5 years',
};

// Season display
export const SEASON_LABELS: Record<string, string> = {
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
  winter: 'Winter',
  any: 'Any Season',
};

// API functions
const remoteMaintenanceSuggestionsApi = {
  /**
   * Get all maintenance suggestions for a household
   */
  async getSuggestions(householdId: string): Promise<SuggestionWithTemplate[]> {
    const response = await api.get<{ suggestions: SuggestionWithTemplate[] }>(
      `/households/${householdId}/maintenance-suggestions`
    );
    return ensureData(response, 'Failed to get maintenance suggestions').suggestions;
  },

  /**
   * Get pending suggestions only
   */
  async getPendingSuggestions(householdId: string): Promise<SuggestionWithTemplate[]> {
    const params = new URLSearchParams({ status: 'pending' });
    const response = await api.get<{ suggestions: SuggestionWithTemplate[] }>(
      `/households/${householdId}/maintenance-suggestions?${params.toString()}`
    );
    return ensureData(response, 'Failed to get pending suggestions').suggestions;
  },

  /**
   * Get a single suggestion
   */
  async getSuggestion(
    householdId: string,
    suggestionId: string
  ): Promise<SuggestionWithTemplate> {
    const response = await api.get<{ suggestion: SuggestionWithTemplate }>(
      `/households/${householdId}/maintenance-suggestions/${suggestionId}`
    );
    return ensureData(response, 'Failed to get suggestion').suggestion;
  },

  /**
   * Apply suggestions (convert to maintenance tasks)
   */
  async applySuggestions(
    householdId: string,
    data: ApplySuggestionsRequest
  ): Promise<{ applied: number; task_ids: string[] }> {
    const response = await api.post<{ applied: number; task_ids: string[] }>(
      `/households/${householdId}/maintenance-suggestions/apply`,
      data
    );
    return ensureData(response, 'Failed to apply suggestions');
  },

  /**
   * Dismiss a suggestion
   */
  async dismissSuggestion(
    householdId: string,
    suggestionId: string,
    data?: DismissSuggestionRequest
  ): Promise<void> {
    await api.post(
      `/households/${householdId}/maintenance-suggestions/${suggestionId}/dismiss`,
      data || {}
    );
  },

  /**
   * Snooze a suggestion
   */
  async snoozeSuggestion(
    householdId: string,
    suggestionId: string,
    data: SnoozeSuggestionRequest
  ): Promise<void> {
    await api.post(
      `/households/${householdId}/maintenance-suggestions/${suggestionId}/snooze`,
      data
    );
  },

  /**
   * Generate new suggestions for household (manual trigger)
   */
  async generateSuggestions(householdId: string): Promise<{ generated: number }> {
    const response = await api.post<{ generated: number }>(
      `/households/${householdId}/maintenance-suggestions/generate`,
      {}
    );
    return ensureData(response, 'Failed to generate suggestions');
  },
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens and stores call
 * `maintenanceSuggestionsApi` exactly as before.
 *
 * Every method has a local counterpart, so there is no `remoteMethods` entry:
 * the template catalogue these suggestions join is Tier C and is reached
 * through `catalogCache` INSIDE the local module rather than by falling back to
 * the server here — otherwise a read would work offline for the row and fail
 * for the join, which is the worst of both.
 */
export const maintenanceSuggestionsApi: typeof remoteMaintenanceSuggestionsApi =
  createHouseLocalProxy(remoteMaintenanceSuggestionsApi, {
    moduleName: 'maintenance-suggestions',
    // Narrow require: the barrel would pull the sync orchestrator and status
    // store into every api call from every screen.
    resolveLocal: () =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@features/house/local/localMaintenanceSuggestionsApi')
        .localMaintenanceSuggestionsApi,
  });
