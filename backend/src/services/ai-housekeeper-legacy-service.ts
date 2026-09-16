import { eq, and, desc, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { v4 as uuidv4 } from 'uuid';

import { createAnthropicAdapterForUser } from '../ai/provider-factory';
import { householdMembers } from '../db/schema';
import {
  aiHousekeeperPreferences,
  aiHousekeeperSuggestions,
  aiMaintenancePredictions,
  aiSeasonalChecklists,
  aiInsights,
} from '../db/schema-ai-housekeeper';
import type { Env } from '../types';
import { NotFoundError, ValidationError } from '../utils/errors';
import { nowIso } from '../utils/id';

import { AIHousekeeperService } from './ai-housekeeper-service';
import { assertCanUseAI } from './entitlement-service';

export class AIHousekeeperLegacyRouteService {
  private db;

  constructor(private env: Env, d1: D1Database) {
    this.db = drizzle(d1);
  }

  async getOrCreatePreferences(userId: string) {
    let prefs = await this.db
      .select()
      .from(aiHousekeeperPreferences)
      .where(eq(aiHousekeeperPreferences.user_id, userId))
      .get();

    if (!prefs) {
      const newPrefs = {
        id: uuidv4(),
        user_id: userId,
        enabled: true,
        notification_frequency: 'daily',
        ai_personality: 'friendly',
        diy_skill_level: 'beginner',
        budget_preference: 'moderate',
        preferred_learning_style: 'article',
        enable_predictions: true,
        enable_seasonal_reminders: true,
        enable_cost_insights: true,
        enable_procrastination_nudges: true,
        enable_celebrations: true,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      await this.db.insert(aiHousekeeperPreferences).values(newPrefs as any).run();
      prefs = newPrefs as any;
    }
    return prefs;
  }

  async updatePreferences(userId: string, body: Record<string, unknown>) {
    const allowedFields = [
      'enabled',
      'notification_frequency',
      'ai_personality',
      'diy_skill_level',
      'budget_preference',
      'preferred_learning_style',
      'enable_predictions',
      'enable_seasonal_reminders',
      'enable_cost_insights',
      'enable_procrastination_nudges',
      'enable_celebrations',
    ];

    const updates: any = { updated_at: nowIso() };
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    const existing = await this.db
      .select()
      .from(aiHousekeeperPreferences)
      .where(eq(aiHousekeeperPreferences.user_id, userId))
      .get();

    if (!existing) {
      const newPrefs = { id: uuidv4(), user_id: userId, ...updates };
      await this.db.insert(aiHousekeeperPreferences).values(newPrefs as any).run();
      return newPrefs;
    }

    await this.db
      .update(aiHousekeeperPreferences)
      .set(updates)
      .where(eq(aiHousekeeperPreferences.user_id, userId))
      .run();

    return this.db
      .select()
      .from(aiHousekeeperPreferences)
      .where(eq(aiHousekeeperPreferences.user_id, userId))
      .get();
  }

  private async verifyHouseholdAccess(householdId: string, userId: string) {
    const member = await this.db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, householdId),
          eq(householdMembers.user_id, userId),
          isNull(householdMembers.deleted_at)
        )
      )
      .get();
    if (!member) {
      throw new NotFoundError('Household not found or access denied');
    }
    return member;
  }

  private async verifySuggestionAccess(suggestionId: string, userId: string) {
    const suggestion = await this.db
      .select()
      .from(aiHousekeeperSuggestions)
      .where(eq(aiHousekeeperSuggestions.id, suggestionId))
      .get();
    if (!suggestion) throw new NotFoundError('Suggestion not found');

    const member = await this.db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, suggestion.household_id),
          eq(householdMembers.user_id, userId),
          isNull(householdMembers.deleted_at)
        )
      )
      .get();
    if (!member) throw new NotFoundError('Access denied');
    return suggestion;
  }

  async listSuggestions(householdId: string, userId: string, status = 'pending') {
    await this.verifyHouseholdAccess(householdId, userId);
    return this.db
      .select()
      .from(aiHousekeeperSuggestions)
      .where(
        and(
          eq(aiHousekeeperSuggestions.household_id, householdId),
          status ? eq(aiHousekeeperSuggestions.status, status) : undefined
        )
      )
      .orderBy(
        desc(aiHousekeeperSuggestions.priority_score),
        desc(aiHousekeeperSuggestions.generated_at)
      )
      .limit(50)
      .all();
  }

  async acceptSuggestion(suggestionId: string, userId: string) {
    await this.verifySuggestionAccess(suggestionId, userId);
    await this.db
      .update(aiHousekeeperSuggestions)
      .set({
        status: 'accepted',
        user_action_at: nowIso(),
        user_action_by: userId,
        updated_at: nowIso(),
      })
      .where(eq(aiHousekeeperSuggestions.id, suggestionId))
      .run();
    return this.db
      .select()
      .from(aiHousekeeperSuggestions)
      .where(eq(aiHousekeeperSuggestions.id, suggestionId))
      .get();
  }

  async dismissSuggestion(suggestionId: string, userId: string) {
    await this.verifySuggestionAccess(suggestionId, userId);
    await this.db
      .update(aiHousekeeperSuggestions)
      .set({
        status: 'dismissed',
        user_action_at: nowIso(),
        user_action_by: userId,
        updated_at: nowIso(),
      })
      .where(eq(aiHousekeeperSuggestions.id, suggestionId))
      .run();
    return this.db
      .select()
      .from(aiHousekeeperSuggestions)
      .where(eq(aiHousekeeperSuggestions.id, suggestionId))
      .get();
  }

  async snoozeSuggestion(suggestionId: string, userId: string, days = 7) {
    await this.verifySuggestionAccess(suggestionId, userId);
    const newExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await this.db
      .update(aiHousekeeperSuggestions)
      .set({
        status: 'snoozed',
        expires_at: newExpiresAt,
        user_action_at: nowIso(),
        user_action_by: userId,
        updated_at: nowIso(),
      })
      .where(eq(aiHousekeeperSuggestions.id, suggestionId))
      .run();
    return this.db
      .select()
      .from(aiHousekeeperSuggestions)
      .where(eq(aiHousekeeperSuggestions.id, suggestionId))
      .get();
  }

  async feedbackSuggestion(suggestionId: string, userId: string, feedback: string) {
    if (!['helpful', 'not_helpful', 'neutral'].includes(feedback)) {
      throw new ValidationError('Invalid feedback value');
    }
    await this.verifySuggestionAccess(suggestionId, userId);
    await this.db
      .update(aiHousekeeperSuggestions)
      .set({ user_feedback: feedback, updated_at: nowIso() })
      .where(eq(aiHousekeeperSuggestions.id, suggestionId))
      .run();
    return this.db
      .select()
      .from(aiHousekeeperSuggestions)
      .where(eq(aiHousekeeperSuggestions.id, suggestionId))
      .get();
  }

  async listPredictions(householdId: string, userId: string, status = 'pending') {
    await this.verifyHouseholdAccess(householdId, userId);
    return this.db
      .select()
      .from(aiMaintenancePredictions)
      .where(
        and(
          eq(aiMaintenancePredictions.household_id, householdId),
          status ? eq(aiMaintenancePredictions.status, status) : undefined
        )
      )
      .orderBy(desc(aiMaintenancePredictions.created_at))
      .limit(50)
      .all();
  }

  async getSeasonalChecklist(householdId: string, userId: string) {
    await this.verifyHouseholdAccess(householdId, userId);

    const now = new Date();
    const month = now.getMonth();
    let season = 'winter';
    if (month >= 2 && month <= 4) season = 'spring';
    else if (month >= 5 && month <= 7) season = 'summer';
    else if (month >= 8 && month <= 10) season = 'fall';
    const year = now.getFullYear();

    const checklist = await this.db
      .select()
      .from(aiSeasonalChecklists)
      .where(
        and(
          eq(aiSeasonalChecklists.household_id, householdId),
          eq(aiSeasonalChecklists.season, season),
          eq(aiSeasonalChecklists.year, year)
        )
      )
      .get();

    if (!checklist) {
      await assertCanUseAI(userId, this.env);
      const ai = await createAnthropicAdapterForUser(this.env, userId, {
        feature: 'aihousekeeper_seasonal_checklist',
        householdId,
        userId,
      });
      const aiService = new AIHousekeeperService(this.db, ai);
      const context = await (aiService as any).fetchHouseholdContext(householdId);
      return (aiService as any).generateSeasonalChecklist(householdId, context);
    }
    return checklist;
  }

  async completeChecklistItem(checklistId: string, userId: string, itemId: string) {
    const checklist = await this.db
      .select()
      .from(aiSeasonalChecklists)
      .where(eq(aiSeasonalChecklists.id, checklistId))
      .get();
    if (!checklist) throw new NotFoundError('Checklist not found');

    const member = await this.db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, checklist.household_id),
          eq(householdMembers.user_id, userId),
          isNull(householdMembers.deleted_at)
        )
      )
      .get();
    if (!member) throw new NotFoundError('Access denied');

    const completedItems = checklist.completed_items ? JSON.parse(checklist.completed_items) : [];
    if (!completedItems.includes(itemId)) {
      completedItems.push(itemId);
    }
    const allItems = JSON.parse(checklist.checklist_items);
    const completionRate = completedItems.length / allItems.length;

    await this.db
      .update(aiSeasonalChecklists)
      .set({
        completed_items: JSON.stringify(completedItems),
        completion_rate: completionRate,
        updated_at: nowIso(),
      })
      .where(eq(aiSeasonalChecklists.id, checklistId))
      .run();

    return this.db
      .select()
      .from(aiSeasonalChecklists)
      .where(eq(aiSeasonalChecklists.id, checklistId))
      .get();
  }

  async listInsights(householdId: string, userId: string, status = 'active') {
    await this.verifyHouseholdAccess(householdId, userId);
    return this.db
      .select()
      .from(aiInsights)
      .where(
        and(
          eq(aiInsights.household_id, householdId),
          status ? eq(aiInsights.status, status) : undefined
        )
      )
      .orderBy(desc(aiInsights.priority), desc(aiInsights.generated_at))
      .limit(50)
      .all();
  }

  async analyzeHousehold(householdId: string, userId: string) {
    await this.verifyHouseholdAccess(householdId, userId);
    await assertCanUseAI(userId, this.env);

    const ai = await createAnthropicAdapterForUser(this.env, userId, {
      feature: 'aihousekeeper_analysis',
      householdId,
      userId,
    });
    const aiService = new AIHousekeeperService(this.db, ai);
    const results = await aiService.analyzeHousehold(householdId);

    return {
      success: true,
      suggestions_count: results.suggestions.length,
      predictions_count: results.predictions.length,
      insights_count: results.insights.length,
      seasonal_checklist_exists: !!results.seasonal_checklist,
    };
  }
}
