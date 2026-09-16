import { eq, and, desc, isNull, inArray } from 'drizzle-orm';
import { DrizzleD1Database } from 'drizzle-orm/d1';
import { v4 as uuidv4 } from 'uuid';

import type { AIProvider } from '../ai/provider';
import {
  tasks as taskTable,
  households,
  homeFeatures,
  type Task,
  type Household,
  type HomeFeature,
} from '../db/schema';
import { findings, reports, type Finding, type Report } from '../db/schema';
import {
  aiHousekeeperSuggestions,
  aiMaintenancePredictions,
  aiSeasonalChecklists,
  aiHousekeeperPreferences,
  type AIHousekeeperSuggestion,
  type AIMaintenancePrediction,
  type AISeasonalChecklist,
  type AIInsight,
} from '../db/schema-ai-housekeeper';
import {
  appliances,
  type Appliance,
} from '../db/schema-maintenance';
import { nowIso } from '../utils/id';

/** JSON schema for predictive suggestion structured output (via AIProvider.generateStructured). */
const PREDICTIVE_SUGGESTIONS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          confidence_score: { type: 'number' },
          priority_score: { type: 'number' },
          expires_at: { type: 'string' },
          related_feature_ids: { type: 'array', items: { type: 'string' } },
          related_appliance_ids: { type: 'array', items: { type: 'string' } },
          reasoning: { type: 'string' },
          data_sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'description', 'confidence_score', 'priority_score', 'reasoning'],
      },
    },
  },
  required: ['suggestions'],
};

/**
 * AI Housekeeper Service
 *
 * Provides intelligent, proactive home maintenance assistance:
 * - Predicts maintenance needs before failures occur
 * - Generates personalized task suggestions
 * - Creates seasonal checklists
 * - Identifies cost-saving opportunities
 * - Prioritizes tasks based on urgency and context
 */
export class AIHousekeeperService {
  constructor(
    private db: DrizzleD1Database,
    private ai: AIProvider,
    private model: string = 'claude-sonnet-4-5-20250929'
  ) {}

  /**
   * Main analysis entry point - analyzes entire household
   */
  async analyzeHousehold(householdId: string): Promise<{
    suggestions: AIHousekeeperSuggestion[];
    predictions: AIMaintenancePrediction[];
    insights: AIInsight[];
    seasonal_checklist?: AISeasonalChecklist;
  }> {
    // Fetch all household data
    const context = await this.fetchHouseholdContext(householdId);

    // Check if user has AI housekeeper enabled
    const prefs = await this.getUserPreferences(context.household.id);
    if (!prefs?.enabled) {
      return { suggestions: [], predictions: [], insights: [] };
    }

    // Generate suggestions, predictions, and insights in parallel
    const [suggestions, predictions, insights] = await Promise.all([
      this.generateSuggestions(householdId, context, prefs),
      this.generatePredictions(householdId, context, prefs),
      this.generateInsights(householdId, context, prefs),
    ]);

    // Generate seasonal checklist if enabled
    let seasonal_checklist: AISeasonalChecklist | undefined;
    if (prefs.enable_seasonal_reminders) {
      seasonal_checklist = await this.generateSeasonalChecklist(householdId, context);
    }

    return {
      suggestions,
      predictions,
      insights,
      seasonal_checklist,
    };
  }

  /**
   * Fetch all relevant household data for analysis
   */
  private async fetchHouseholdContext(householdId: string): Promise<HouseholdContext> {
    const [household, tasks, features, appliancesList, reportsList, findingsList] = await Promise.all([
      this.db.select().from(households).where(eq(households.id, householdId)).get(),
      this.db
        .select()
        .from(taskTable)
        .where(
          and(
            eq(taskTable.household_id, householdId),
            isNull(taskTable.deleted_at)
          )
        )
        .all(),
      this.db
        .select()
        .from(homeFeatures)
        .where(eq(homeFeatures.household_id, householdId))
        .all(),
      this.db
        .select()
        .from(appliances)
        .where(eq(appliances.household_id, householdId))
        .all(),
      this.db
        .select()
        .from(reports)
        .where(
          and(
            eq(reports.household_id, householdId),
            eq(reports.status, 'completed')
          )
        )
        .orderBy(desc(reports.inspection_date))
        .limit(3)
        .all(),
      this.db
        .select()
        .from(findings)
        .where(
          inArray(
            findings.report_id,
            this.db.select({ id: reports.id }).from(reports).where(eq(reports.household_id, householdId))
          )
        )
        .orderBy(desc(findings.created_at))
        .limit(50)
        .all(),
    ]);

    if (!household) {
      throw new Error(`Household not found: ${householdId}`);
    }

    return {
      household,
      tasks,
      features,
      appliances: appliancesList,
      reports: reportsList,
      findings: findingsList,
    };
  }

  /**
   * Get user preferences, create default if not exists
   */
  private async getUserPreferences(userId: string) {
    let prefs = await this.db
      .select()
      .from(aiHousekeeperPreferences)
      .where(eq(aiHousekeeperPreferences.user_id, userId))
      .get();

    if (!prefs) {
      // Create default preferences
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
      };

      await this.db.insert(aiHousekeeperPreferences).values(newPrefs).run();
      prefs = newPrefs as any;
    }

    return prefs;
  }

  /**
   * Generate AI-powered suggestions
   */
  private async generateSuggestions(
    _householdId: string,
    context: HouseholdContext,
    prefs: any
  ): Promise<AIHousekeeperSuggestion[]> {
    const suggestions: AIHousekeeperSuggestion[] = [];

    // 1. Predictive maintenance suggestions
    const predictiveSuggestions = await this.generatePredictiveSuggestions(context, prefs);
    suggestions.push(...predictiveSuggestions);

    // 2. Procrastination nudges (if enabled)
    if (prefs.enable_procrastination_nudges) {
      const procrastinationNudges = this.generateProcrastinationNudges(context);
      suggestions.push(...procrastinationNudges);
    }

    // 3. Cost optimization suggestions (if enabled)
    if (prefs.enable_cost_insights) {
      const batchingSuggestions = this.generateBatchingSuggestions(context);
      suggestions.push(...batchingSuggestions);
    }

    // 4. Celebration nudges (if enabled)
    if (prefs.enable_celebrations) {
      const celebrations = this.generateCelebrations(context);
      suggestions.push(...celebrations);
    }

    // Save suggestions to database
    if (suggestions.length > 0) {
      await this.db.insert(aiHousekeeperSuggestions).values(suggestions).run();
    }

    return suggestions;
  }

  /**
   * Generate predictive maintenance suggestions using Claude AI
   */
  private async generatePredictiveSuggestions(
    context: HouseholdContext,
    prefs: any
  ): Promise<AIHousekeeperSuggestion[]> {
    // Build prompt for Claude
    const prompt = this.buildPredictiveSuggestionsPrompt(context, prefs);

    try {
      const aiSuggestions = await this.ai.generateStructured<{
        suggestions: Array<Record<string, unknown>>;
      }>({
        systemPrompt: this.getPredictiveSuggestionsSystemPrompt(prefs),
        userPrompt: prompt,
        model: this.model,
        schema: PREDICTIVE_SUGGESTIONS_SCHEMA,
      });

      // Convert to database format
      return aiSuggestions.suggestions.map((s: any) => ({
        id: uuidv4(),
        household_id: context.household.id,
        suggestion_type: 'prediction',
        title: s.title,
        description: s.description,
        confidence_score: s.confidence_score,
        priority_score: s.priority_score,
        generated_at: nowIso(),
        expires_at: s.expires_at,
        status: 'pending',
        related_feature_ids: s.related_feature_ids ? JSON.stringify(s.related_feature_ids) : null,
        related_appliance_ids: s.related_appliance_ids ? JSON.stringify(s.related_appliance_ids) : null,
        ai_reasoning: s.reasoning,
        data_sources: JSON.stringify(s.data_sources || []),
      })) as AIHousekeeperSuggestion[];
    } catch (error) {
      console.error('Error generating predictive suggestions:', error);
      return [];
    }
  }

  /**
   * Generate procrastination nudges for overdue tasks
   */
  private generateProcrastinationNudges(context: HouseholdContext): AIHousekeeperSuggestion[] {
    const now = new Date();
    const overdueTasks = context.tasks.filter((task) => {
      if (!task.next_due_date || !task.is_active) return false;
      const dueDate = new Date(task.next_due_date);
      const daysSince = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysSince >= 7; // Overdue by 7+ days
    });

    return overdueTasks.slice(0, 3).map((task) => {
      const dueDate = new Date(task.next_due_date!);
      const daysSince = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      return {
        id: uuidv4(),
        household_id: context.household.id,
        suggestion_type: 'procrastination_nudge',
        title: `Task Overdue: ${task.title}`,
        description: `This task has been overdue for ${daysSince} days. Delaying maintenance can lead to more expensive repairs later. Need help getting started?`,
        confidence_score: 1.0,
        priority_score: Math.min(10, 5 + Math.floor(daysSince / 7)),
        generated_at: nowIso(),
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days
        status: 'pending',
        related_task_id: task.id,
        ai_reasoning: `Task is overdue by ${daysSince} days and needs attention`,
        data_sources: JSON.stringify(['maintenance_tasks']),
      } as any;
    });
  }

  /**
   * Generate batching suggestions for cost savings
   */
  private generateBatchingSuggestions(context: HouseholdContext): AIHousekeeperSuggestion[] {
    // Group tasks by contractor category
    const activeTasks = context.tasks.filter((t) => t.is_active && t.needs_contractor);
    const tasksByCategory: { [key: string]: Task[] } = {};

    activeTasks.forEach((task) => {
      const category = task.contractor_category || 'general';
      if (!tasksByCategory[category]) {
        tasksByCategory[category] = [];
      }
      tasksByCategory[category].push(task);
    });

    // Find categories with 2+ tasks
    const batchingOpportunities = Object.entries(tasksByCategory).filter(
      ([_, tasks]) => tasks.length >= 2
    );

    return batchingOpportunities.slice(0, 2).map(([category, tasks]) => ({
      id: uuidv4(),
      household_id: context.household.id,
      suggestion_type: 'batching_opportunity',
      title: `Batch ${tasks.length} ${category} tasks to save money`,
      description: `You have ${tasks.length} tasks that need a ${category}. Scheduling them together could save you $100-$200 on the service call fee.`,
      confidence_score: 0.8,
      priority_score: 6,
      generated_at: nowIso(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      status: 'pending',
      related_task_id: null,
      ai_reasoning: `Multiple tasks in same category (${category}) can be batched for cost savings`,
      data_sources: JSON.stringify(['maintenance_tasks']),
    })) as any[];
  }

  /**
   * Generate celebration nudges for completed tasks
   */
  private generateCelebrations(context: HouseholdContext): AIHousekeeperSuggestion[] {
    // Count tasks completed in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const completedTasks = context.tasks.filter((task) => {
      if (!task.updated_at) return false;
      const updatedDate = new Date(task.updated_at);
      return (
        task.workflow_stage === 'completed' &&
        updatedDate >= thirtyDaysAgo
      );
    });

    if (completedTasks.length >= 5) {
      return [
        {
          id: uuidv4(),
          household_id: context.household.id,
          suggestion_type: 'celebration',
          title: `🎉 Great job! ${completedTasks.length} tasks completed this month`,
          description: `You've completed ${completedTasks.length} tasks in the last 30 days. Your property is in great hands! Keep up the momentum!`,
          confidence_score: 1.0,
          priority_score: 3,
          generated_at: nowIso(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
          status: 'pending',
          ai_reasoning: `User completed ${completedTasks.length} tasks in last 30 days`,
          data_sources: JSON.stringify(['maintenance_tasks']),
        } as any,
      ];
    }

    return [];
  }

  /**
   * Generate maintenance predictions
   */
  private async generatePredictions(
    _householdId: string,
    context: HouseholdContext,
    prefs: any
  ): Promise<AIMaintenancePrediction[]> {
    if (!prefs.enable_predictions) {
      return [];
    }

    const predictions: AIMaintenancePrediction[] = [];

    // Analyze appliances for failure predictions
    for (const appliance of context.appliances) {
      const prediction = this.predictApplianceFailure(appliance, context);
      if (prediction) {
        predictions.push(prediction);
      }
    }

    // Save predictions to database
    if (predictions.length > 0) {
      await this.db.insert(aiMaintenancePredictions).values(predictions).run();
    }

    return predictions;
  }

  /**
   * Predict appliance failure based on age and expected lifespan
   */
  private predictApplianceFailure(
    appliance: Appliance,
    context: HouseholdContext
  ): AIMaintenancePrediction | null {
    if (!appliance.expected_lifespan || !appliance.install_date) {
      return null;
    }

    const installDate = new Date(appliance.install_date);
    const now = new Date();
    const ageYears = (now.getTime() - installDate.getTime()) / (1000 * 60 * 60 * 24 * 365);
    const expectedLifespan = appliance.expected_lifespan;

    // Predict if appliance is 80%+ through its expected lifespan
    if (ageYears >= expectedLifespan * 0.8) {
      const remainingYears = expectedLifespan - ageYears;
      const predictedDateMin = new Date(Date.now() + remainingYears * 0.5 * 365 * 24 * 60 * 60 * 1000);
      const predictedDateMax = new Date(Date.now() + remainingYears * 1.5 * 365 * 24 * 60 * 60 * 1000);

      let confidenceLevel = 'low';
      let predictionType = 'inspection_due';

      if (ageYears >= expectedLifespan * 0.95) {
        confidenceLevel = 'high';
        predictionType = 'replacement_recommended';
      } else if (ageYears >= expectedLifespan * 0.9) {
        confidenceLevel = 'medium';
        predictionType = 'service_needed';
      }

      return {
        id: uuidv4(),
        household_id: context.household.id,
        appliance_id: appliance.id,
        feature_id: null,
        prediction_type: predictionType,
        predicted_date_min: predictedDateMin.toISOString().split('T')[0],
        predicted_date_max: predictedDateMax.toISOString().split('T')[0],
        confidence_level: confidenceLevel,
        reasoning: `${appliance.name || appliance.category} is ${Math.round(ageYears)} years old (${Math.round((ageYears / expectedLifespan) * 100)}% of expected ${expectedLifespan}-year lifespan). ${predictionType === 'replacement_recommended' ? 'Replacement is recommended soon to avoid unexpected failure.' : 'Schedule inspection to assess condition.'}`,
        recommended_action: predictionType === 'replacement_recommended'
          ? `Budget for replacement in the next ${Math.round(remainingYears)} year(s). Get quotes from contractors.`
          : `Schedule professional inspection to assess condition and plan for future replacement.`,
        estimated_cost_min: this.estimateReplacementCost(appliance, 0.8),
        estimated_cost_max: this.estimateReplacementCost(appliance, 1.2),
        status: 'pending',
        created_at: nowIso(),
      } as any;
    }

    return null;
  }

  /**
   * Estimate replacement cost based on appliance category
   */
  private estimateReplacementCost(appliance: Appliance, multiplier: number): number {
    const baseCosts: { [key: string]: number } = {
      hvac: 500000, // $5000
      water_heater: 150000, // $1500
      washer: 80000, // $800
      dryer: 70000, // $700
      dishwasher: 60000, // $600
      refrigerator: 150000, // $1500
      oven: 120000, // $1200
      microwave: 20000, // $200
    };

    const baseCost = baseCosts[appliance.category] || 50000; // Default $500
    return Math.round(baseCost * multiplier);
  }

  /**
   * Generate insights (cost savings, risk prevention, etc.)
   */
  private async generateInsights(
    _householdId: string,
    _context: HouseholdContext,
    _prefs: any
  ): Promise<AIInsight[]> {
    // For now, insights are generated as part of suggestions
    // This method can be expanded to analyze patterns and generate strategic insights
    return [];
  }

  /**
   * Generate seasonal checklist
   */
  private async generateSeasonalChecklist(
    householdId: string,
    context: HouseholdContext
  ): Promise<AISeasonalChecklist | undefined> {
    const season = this.getCurrentSeason();
    const year = new Date().getFullYear();

    // Check if checklist already exists for this season/year
    const existing = await this.db
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

    if (existing) {
      return existing;
    }

    // Generate new checklist
    const checklist = this.generateSeasonalChecklistItems(season, context);

    const newChecklist = {
      id: uuidv4(),
      household_id: householdId,
      season,
      year,
      climate_zone: this.deriveClimateZone(context.household),
      checklist_items: JSON.stringify(checklist),
      generated_at: nowIso(),
      completed_items: JSON.stringify([]),
      completion_rate: 0,
    };

    await this.db.insert(aiSeasonalChecklists).values(newChecklist as any).run();
    return newChecklist as any;
  }

  /**
   * Get current season based on date
   */
  private getCurrentSeason(): string {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'fall';
    return 'winter';
  }

  /**
   * Derive climate zone from household address (simplified)
   */
  private deriveClimateZone(household: Household): string {
    // Simplified - in production, use a geocoding service
    const state = household.state_province?.toLowerCase();

    if (['fl', 'tx', 'ca', 'az'].includes(state || '')) return 'hot';
    if (['mn', 'wi', 'nd', 'sd', 'mt'].includes(state || '')) return 'cold';
    return 'moderate';
  }

  /**
   * Generate seasonal checklist items
   */
  private generateSeasonalChecklistItems(season: string, _context: HouseholdContext): any[] {
    const checklists: { [key: string]: any[] } = {
      spring: [
        { id: '1', title: 'Inspect roof for winter damage', priority: 'high' },
        { id: '2', title: 'Clean gutters and downspouts', priority: 'high' },
        { id: '3', title: 'Test AC before summer', priority: 'high' },
        { id: '4', title: 'Check for cracks in driveway/walkways', priority: 'medium' },
        { id: '5', title: 'Inspect exterior paint and siding', priority: 'medium' },
      ],
      summer: [
        { id: '1', title: 'Change AC filters monthly', priority: 'high' },
        { id: '2', title: 'Check irrigation system', priority: 'medium' },
        { id: '3', title: 'Inspect deck/patio for repairs', priority: 'medium' },
        { id: '4', title: 'Clean dryer vents', priority: 'high' },
      ],
      fall: [
        { id: '1', title: 'Clean gutters before winter', priority: 'high' },
        { id: '2', title: 'Schedule furnace inspection', priority: 'high' },
        { id: '3', title: 'Check weather stripping on doors/windows', priority: 'medium' },
        { id: '4', title: 'Drain outdoor faucets', priority: 'high' },
        { id: '5', title: 'Chimney cleaning and inspection', priority: 'medium' },
      ],
      winter: [
        { id: '1', title: 'Test smoke and CO detectors', priority: 'high' },
        { id: '2', title: 'Check insulation in attic', priority: 'medium' },
        { id: '3', title: 'Prevent frozen pipes', priority: 'high' },
        { id: '4', title: 'Reverse ceiling fans', priority: 'low' },
      ],
    };

    return checklists[season] || [];
  }

  /**
   * Build prompt for predictive suggestions
   */
  private buildPredictiveSuggestionsPrompt(context: HouseholdContext, prefs: any): string {
    return `Analyze this household's maintenance situation and generate 2-3 proactive suggestions.

**Household Context:**
- Features: ${context.features.length} home features tracked
- Appliances: ${context.appliances.length} appliances (${context.appliances.map(a => `${a.category} (${this.getAge(a.install_date)} yrs old)`).join(', ')})
- Tasks: ${context.tasks.filter(t => t.is_active).length} active tasks
- Recent Reports: ${context.reports.length} inspection reports

**User Preferences:**
- DIY Skill Level: ${prefs.diy_skill_level}
- Budget: ${prefs.budget_preference}

**Instructions:**
Generate 2-3 actionable suggestions that:
1. Predict upcoming maintenance needs (before they become urgent)
2. Consider appliance ages and expected lifespans
3. Match user's DIY skill level and budget
4. Include clear reasoning and data sources

Return JSON format:
{
  "suggestions": [
    {
      "title": "Short, actionable title",
      "description": "2-3 sentence explanation of why this matters and what to do",
      "confidence_score": 0.0-1.0,
      "priority_score": 1-10,
      "expires_at": "ISO date string (when suggestion is no longer relevant)",
      "related_appliance_ids": ["id1", "id2"],
      "reasoning": "Why this suggestion was made",
      "data_sources": ["appliances", "reports", etc]
    }
  ]
}`;
  }

  /**
   * System prompt for predictive suggestions
   */
  private getPredictiveSuggestionsSystemPrompt(prefs: any): string {
    const personalities: { [key: string]: string } = {
      friendly: 'You are a friendly and encouraging home maintenance assistant. Use warm, supportive language.',
      professional: 'You are a professional home maintenance advisor. Use clear, concise, data-driven language.',
      data_driven: 'You are a technical home maintenance analyst. Focus on data, statistics, and detailed reasoning.',
    };

    return `${personalities[prefs.ai_personality] || personalities.friendly}

You analyze home maintenance data to predict future needs and help homeowners stay ahead of problems.

Key principles:
- Prevent failures before they happen
- Provide clear, actionable guidance
- Explain why each suggestion matters
- Consider cost and DIY feasibility
- Be specific about timing and urgency

Return suggestions as valid JSON only.`;
  }

  /**
   * Helper to calculate age from install date
   */
  private getAge(installDate: string | null): number {
    if (!installDate) return 0;
    const now = new Date();
    const install = new Date(installDate);
    return Math.floor((now.getTime() - install.getTime()) / (1000 * 60 * 60 * 24 * 365));
  }
}

// Type definitions
interface HouseholdContext {
  household: Household;
  tasks: Task[];
  features: HomeFeature[];
  appliances: Appliance[];
  reports: Report[];
  findings: Finding[];
}
