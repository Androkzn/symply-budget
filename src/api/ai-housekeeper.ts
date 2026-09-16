import { apiClient } from './client';

export interface AIHousekeeperPreferences {
  id: string;
  user_id: string;
  enabled: boolean;
  notification_frequency: 'daily' | 'three_per_week' | 'weekly' | 'disabled';
  ai_personality: 'friendly' | 'professional' | 'data_driven';
  diy_skill_level: 'none' | 'beginner' | 'intermediate' | 'advanced';
  budget_preference: 'tight' | 'moderate' | 'flexible';
  preferred_learning_style: 'video' | 'article' | 'expert_call';
  enable_predictions: boolean;
  enable_seasonal_reminders: boolean;
  enable_cost_insights: boolean;
  enable_procrastination_nudges: boolean;
  enable_celebrations: boolean;
  created_at: string;
  updated_at: string;
}

export interface AIHousekeeperSuggestion {
  id: string;
  household_id: string;
  suggestion_type: 'prediction' | 'seasonal_reminder' | 'cost_optimization' | 'procrastination_nudge' | 'celebration' | 'batching_opportunity';
  title: string;
  description: string;
  confidence_score: number | null;
  priority_score: number | null;
  generated_at: string;
  expires_at: string | null;
  status: 'pending' | 'accepted' | 'dismissed' | 'snoozed' | 'expired' | 'completed';
  user_action_at: string | null;
  user_action_by: string | null;
  user_feedback: string | null;
  related_task_id: string | null;
  related_feature_ids: string | null;
  related_appliance_ids: string | null;
  related_finding_ids: string | null;
  ai_reasoning: string | null;
  data_sources: string | null;
  created_at: string;
  updated_at: string;
}

export interface AIMaintenancePrediction {
  id: string;
  household_id: string;
  feature_id: string | null;
  appliance_id: string | null;
  prediction_type: 'failure' | 'service_needed' | 'replacement_recommended' | 'inspection_due';
  predicted_date_min: string | null;
  predicted_date_max: string | null;
  confidence_level: 'high' | 'medium' | 'low';
  reasoning: string;
  recommended_action: string;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  status: 'pending' | 'scheduled' | 'resolved' | 'false_alarm' | 'deferred';
  created_at: string;
  resolved_at: string | null;
  actual_outcome: string | null;
  accuracy_score: number | null;
  related_task_id: string | null;
}

export interface AISeasonalChecklist {
  id: string;
  household_id: string;
  season: 'spring' | 'summer' | 'fall' | 'winter';
  year: number;
  climate_zone: string | null;
  checklist_items: string; // JSON array
  generated_at: string;
  completed_items: string | null; // JSON array
  completion_rate: number | null;
  created_at: string;
  updated_at: string;
}

export interface AIInsight {
  id: string;
  household_id: string;
  insight_type: 'cost_savings' | 'risk_prevention' | 'batching_opportunity' | 'efficiency_improvement' | 'warranty_expiration';
  title: string;
  description: string;
  potential_savings: number | null;
  risk_level: string | null;
  priority: number | null;
  generated_at: string;
  expires_at: string | null;
  status: 'active' | 'accepted' | 'dismissed' | 'expired' | 'completed';
  related_task_ids: string | null;
  related_quote_ids: string | null;
  related_suggestion_ids: string | null;
  user_feedback: string | null;
  user_feedback_note: string | null;
  created_at: string;
  updated_at: string;
}

export const aiHousekeeperApi = {
  // ============ PREFERENCES ============

  /**
   * Get user's AI housekeeper preferences
   */
  async getPreferences(): Promise<AIHousekeeperPreferences> {
    const response = await apiClient.get('/api/ai-housekeeper/preferences');
    return response.data;
  },

  /**
   * Update user's AI housekeeper preferences
   */
  async updatePreferences(
    preferences: Partial<Omit<AIHousekeeperPreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
  ): Promise<AIHousekeeperPreferences> {
    const response = await apiClient.put('/api/ai-housekeeper/preferences', preferences);
    return response.data;
  },

  // ============ SUGGESTIONS ============

  /**
   * Get AI suggestions for a household
   */
  async getSuggestions(
    householdId: string,
    status?: 'pending' | 'accepted' | 'dismissed' | 'snoozed' | 'expired' | 'completed'
  ): Promise<AIHousekeeperSuggestion[]> {
    const params = status ? { status } : {};
    const response = await apiClient.get(`/api/ai-housekeeper/households/${householdId}/suggestions`, { params });
    return response.data;
  },

  /**
   * Accept an AI suggestion (creates a task)
   */
  async acceptSuggestion(suggestionId: string): Promise<AIHousekeeperSuggestion> {
    const response = await apiClient.post(`/api/ai-housekeeper/suggestions/${suggestionId}/accept`);
    return response.data;
  },

  /**
   * Dismiss an AI suggestion
   */
  async dismissSuggestion(suggestionId: string): Promise<AIHousekeeperSuggestion> {
    const response = await apiClient.post(`/api/ai-housekeeper/suggestions/${suggestionId}/dismiss`);
    return response.data;
  },

  /**
   * Snooze an AI suggestion
   */
  async snoozeSuggestion(suggestionId: string, days: number = 7): Promise<AIHousekeeperSuggestion> {
    const response = await apiClient.post(`/api/ai-housekeeper/suggestions/${suggestionId}/snooze`, { days });
    return response.data;
  },

  /**
   * Provide feedback on a suggestion
   */
  async feedbackSuggestion(
    suggestionId: string,
    feedback: 'helpful' | 'not_helpful' | 'neutral'
  ): Promise<AIHousekeeperSuggestion> {
    const response = await apiClient.post(`/api/ai-housekeeper/suggestions/${suggestionId}/feedback`, { feedback });
    return response.data;
  },

  // ============ PREDICTIONS ============

  /**
   * Get maintenance predictions for a household
   */
  async getPredictions(
    householdId: string,
    status?: 'pending' | 'scheduled' | 'resolved' | 'false_alarm' | 'deferred'
  ): Promise<AIMaintenancePrediction[]> {
    const params = status ? { status } : {};
    const response = await apiClient.get(`/api/ai-housekeeper/households/${householdId}/predictions`, { params });
    return response.data;
  },

  // ============ SEASONAL CHECKLISTS ============

  /**
   * Get current seasonal checklist for a household
   */
  async getSeasonalChecklist(householdId: string): Promise<AISeasonalChecklist> {
    const response = await apiClient.get(`/api/ai-housekeeper/households/${householdId}/seasonal-checklist`);
    return response.data;
  },

  /**
   * Mark a checklist item as complete
   */
  async completeChecklistItem(checklistId: string, itemId: string): Promise<AISeasonalChecklist> {
    const response = await apiClient.post(`/api/ai-housekeeper/seasonal-checklist/${checklistId}/complete-item`, {
      itemId,
    });
    return response.data;
  },

  // ============ INSIGHTS ============

  /**
   * Get AI insights for a household
   */
  async getInsights(
    householdId: string,
    status?: 'active' | 'accepted' | 'dismissed' | 'expired' | 'completed'
  ): Promise<AIInsight[]> {
    const params = status ? { status } : {};
    const response = await apiClient.get(`/api/ai-housekeeper/households/${householdId}/insights`, { params });
    return response.data;
  },

  // ============ TRIGGER ANALYSIS ============

  /**
   * Manually trigger AI analysis for a household
   */
  async analyzeHousehold(householdId: string): Promise<{
    success: boolean;
    suggestions_count: number;
    predictions_count: number;
    insights_count: number;
    seasonal_checklist_exists: boolean;
  }> {
    const response = await apiClient.post(`/api/ai-housekeeper/households/${householdId}/analyze`);
    return response.data;
  },
};
