import { eq, and, desc, or, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import type { ClaudeProvider } from '../ai/claude-provider';
import { createProviderAdapter } from '../ai/provider-factory';
import * as schema from '../db/schema';
import type { Database, Env } from '../types';
import { generateId, now } from '../utils/id';

import { hasUsableProviderKey, resolveProviderApiKey } from './ai-credential-resolver';
import { usageRecorderFor } from './ai-usage-service';

// Use schema types directly where available, or define interfaces for API responses
type HomeFeature = typeof schema.homeFeatures.$inferSelect;
type MaintenanceTemplate = typeof schema.maintenanceTemplates.$inferSelect;
type MaintenanceSuggestion = typeof schema.maintenanceSuggestions.$inferSelect;

export class MaintenanceSuggestionService {
  private db: Database;
  private rawDb: D1Database; // Keep raw D1 for remaining SQL queries
  private env: Env;
  private userId: string | null;

  constructor(env: Env, d1: D1Database, userId?: string | null) {
    this.db = drizzle(d1, { schema });
    this.rawDb = d1;
    this.env = env;
    // Bill the acting user's own Anthropic key when connected (BYOK).
    this.userId = userId ?? null;
  }

  /**
   * Get all home features for a household
   */
  async getHomeFeatures(householdId: string): Promise<HomeFeature[]> {
    return await this.db
      .select()
      .from(schema.homeFeatures)
      .where(eq(schema.homeFeatures.household_id, householdId))
      .orderBy(schema.homeFeatures.feature_type, desc(schema.homeFeatures.created_at))
      .all();
  }

  /**
   * Get a single home feature
   */
  async getHomeFeature(featureId: string, householdId: string): Promise<HomeFeature | null> {
    const result = await this.db
      .select()
      .from(schema.homeFeatures)
      .where(
        and(
          eq(schema.homeFeatures.id, featureId),
          eq(schema.homeFeatures.household_id, householdId)
        )
      )
      .get();

    return result || null;
  }

  /**
   * Create a home feature
   */
  async createHomeFeature(
    householdId: string,
    data: Partial<HomeFeature>
  ): Promise<HomeFeature> {
    const id = generateId();
    const timestamp = now();

    await this.db.insert(schema.homeFeatures).values({
      id,
      household_id: householdId,
      feature_type: data.feature_type || 'other',
      feature_subtype: data.feature_subtype || null,
      quantity: data.quantity || 1,
      location: data.location || null,
      brand: data.brand || null,
      model: data.model || null,
      install_date: data.install_date || null,
      age_years: data.age_years || null,
      condition: data.condition || 'unknown',
      notes: data.notes || null,
      source: data.source || 'manual',
      source_report_id: data.source_report_id || null,
      extraction_confidence: data.extraction_confidence || null,
      created_at: timestamp,
      updated_at: timestamp,
    });

    return this.getHomeFeature(id, householdId) as Promise<HomeFeature>;
  }

  /**
   * Bulk create home features from report extraction
   */
  async bulkCreateHomeFeatures(
    householdId: string,
    features: Array<Partial<HomeFeature>>
  ): Promise<{ created: number; errors: string[] }> {
    const errors: string[] = [];
    let created = 0;

    for (const feature of features) {
      try {
        await this.createHomeFeature(householdId, {
          ...feature,
          source: 'report_extraction',
        });
        created++;
      } catch (error) {
        errors.push(`Failed to create feature ${feature.feature_type}: ${error}`);
      }
    }

    // After creating features, generate suggestions
    await this.generateSuggestionsForHousehold(householdId);

    return { created, errors };
  }

  /**
   * Get maintenance templates matching a feature type
   */
  async getTemplatesForFeature(featureType: string, featureSubtype?: string | null): Promise<MaintenanceTemplate[]> {
    const baseConditions = and(
      eq(schema.maintenanceTemplates.feature_type, featureType),
      eq(schema.maintenanceTemplates.is_active, true)
    );

    const subtypeCondition = featureSubtype
      ? or(
          isNull(schema.maintenanceTemplates.feature_subtype),
          eq(schema.maintenanceTemplates.feature_subtype, featureSubtype)
        )
      : isNull(schema.maintenanceTemplates.feature_subtype);

    return await this.db
      .select()
      .from(schema.maintenanceTemplates)
      .where(and(baseConditions, subtypeCondition))
      .orderBy(schema.maintenanceTemplates.frequency, schema.maintenanceTemplates.title)
      .all();
  }

  /**
   * Generate maintenance suggestions for all features in a household
   */
  async generateSuggestionsForHousehold(householdId: string): Promise<{ generated: number }> {
    // Get all home features
    const features = await this.getHomeFeatures(householdId);

    let generated = 0;

    for (const feature of features) {
      // Get matching templates
      const templates = await this.getTemplatesForFeature(feature.feature_type, feature.feature_subtype);

      for (const template of templates) {
        // Check if suggestion already exists
        const existing = await this.db
          .select({ id: schema.maintenanceSuggestions.id })
          .from(schema.maintenanceSuggestions)
          .where(
            and(
              eq(schema.maintenanceSuggestions.household_id, householdId),
              eq(schema.maintenanceSuggestions.home_feature_id, feature.id),
              eq(schema.maintenanceSuggestions.template_id, template.id)
            )
          )
          .get();

        if (!existing) {
          // Create new suggestion
          await this.createSuggestion(householdId, feature.id, template);
          generated++;
        }
      }
    }

    return { generated };
  }

  /**
   * Create a maintenance suggestion
   */
  private async createSuggestion(
    householdId: string,
    featureId: string,
    template: MaintenanceTemplate
  ): Promise<void> {
    const id = generateId();
    const timestamp = now();

    await this.db.insert(schema.maintenanceSuggestions).values({
      id,
      household_id: householdId,
      home_feature_id: featureId,
      template_id: template.id,
      title: template.title,
      description: template.description,
      frequency: template.frequency,
      status: 'pending',
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  /**
   * Get all maintenance suggestions for a household
   */
  async getSuggestions(householdId: string): Promise<Array<MaintenanceSuggestion & { template: Partial<MaintenanceTemplate> }>> {
    // Using Drizzle ORM for type-safe queries
    const suggestions = await this.db
      .select({
        suggestion: schema.maintenanceSuggestions,
        template: schema.maintenanceTemplates,
      })
      .from(schema.maintenanceSuggestions)
      .innerJoin(
        schema.maintenanceTemplates,
        eq(schema.maintenanceSuggestions.template_id, schema.maintenanceTemplates.id)
      )
      .where(
        and(
          eq(schema.maintenanceSuggestions.household_id, householdId),
          eq(schema.maintenanceSuggestions.status, 'pending')
        )
      )
      .orderBy(schema.maintenanceTemplates.frequency, schema.maintenanceTemplates.title)
      .all();

    return suggestions.map(({ suggestion, template }) => ({
      ...suggestion,
      feature_id: suggestion.home_feature_id,
      applied_task_id: suggestion.created_task_id,
      template: {
        id: template.id,
        title: template.title,
        description: template.description,
        frequency: template.frequency,
        best_season: template.best_season,
        diy_difficulty: template.diy_difficulty,
        professional_recommended: template.professional_recommended,
        why_important: template.why_important,
        estimated_cost_min: template.estimated_cost_min,
        estimated_cost_max: template.estimated_cost_max,
      },
    }));
  }

  /**
   * Apply selected suggestions as maintenance tasks
   */
  async applySuggestions(
    householdId: string,
    suggestionIds: string[]
  ): Promise<{ applied: number; errors: string[] }> {
    const errors: string[] = [];
    let applied = 0;
    const timestamp = now();

    for (const suggestionId of suggestionIds) {
      try {
        // Get suggestion with template
        const suggestion = await this.rawDb
          .prepare(
            `SELECT ms.*, mt.*
             FROM maintenance_suggestions ms
             JOIN maintenance_templates mt ON ms.template_id = mt.id
             WHERE ms.id = ? AND ms.household_id = ?`
          )
          .bind(suggestionId, householdId)
          .first<any>();

        if (!suggestion) {
          errors.push(`Suggestion ${suggestionId} not found`);
          continue;
        }

        // Create maintenance task
        const taskId = generateId();
        const nextDueDate = this.calculateNextDueDate(suggestion.frequency, suggestion.best_season);

        await this.rawDb
          .prepare(
            `INSERT INTO tasks (
              id, household_id, title, description, system_category, frequency,
              next_due_date, reminder_enabled, reminder_days_before,
              suggested_by, home_feature_id, suggestion_reason,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 7, 'system', ?, ?, ?, ?)`
          )
          .bind(
            taskId,
            householdId,
            suggestion.title,
            suggestion.description || suggestion.why_important || '',
            this.mapFeatureTypeToCategory(suggestion.feature_type),
            suggestion.frequency,
            nextDueDate,
            suggestion.feature_id,
            `Auto-suggested based on home feature: ${suggestion.feature_type}`,
            timestamp,
            timestamp
          )
          .run();

        // Update suggestion status
        await this.rawDb
          .prepare(
            `UPDATE maintenance_suggestions
             SET status = 'applied', applied_task_id = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(taskId, timestamp, suggestionId)
          .run();

        applied++;
      } catch (error) {
        errors.push(`Failed to apply suggestion ${suggestionId}: ${error}`);
      }
    }

    return { applied, errors };
  }

  /**
   * Dismiss a suggestion
   */
  async dismissSuggestion(
    suggestionId: string,
    householdId: string,
    reason?: string
  ): Promise<void> {
    const timestamp = now();

    await this.rawDb
      .prepare(
        `UPDATE maintenance_suggestions
         SET status = 'dismissed', dismissed_reason = ?, updated_at = ?
         WHERE id = ? AND household_id = ?`
      )
      .bind(reason || null, timestamp, suggestionId, householdId)
      .run();
  }

  /**
   * Calculate next due date based on frequency and best season
   */
  private calculateNextDueDate(frequency: string, bestSeason?: string | null): string {
    const now = new Date();
    const nextDate = new Date(now);

    // Add time based on frequency
    switch (frequency) {
      case 'daily':
        nextDate.setDate(nextDate.getDate() + 1);
        break;
      case 'weekly':
        nextDate.setDate(nextDate.getDate() + 7);
        break;
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case 'quarterly':
        nextDate.setMonth(nextDate.getMonth() + 3);
        break;
      case 'yearly':
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
      case '3_years':
        nextDate.setFullYear(nextDate.getFullYear() + 3);
        break;
      case '5_years':
        nextDate.setFullYear(nextDate.getFullYear() + 5);
        break;
      default:
        nextDate.setMonth(nextDate.getMonth() + 1);
    }

    // Adjust to best season if specified
    if (bestSeason) {
      const currentMonth = nextDate.getMonth();
      let targetMonth: number;

      switch (bestSeason) {
        case 'spring':
          targetMonth = 3; // April
          break;
        case 'summer':
          targetMonth = 6; // July
          break;
        case 'fall':
          targetMonth = 9; // October
          break;
        case 'winter':
          targetMonth = 0; // January
          break;
        default:
          targetMonth = currentMonth;
      }

      // If target season is earlier this year, schedule for next year
      if (targetMonth < currentMonth && frequency === 'yearly') {
        nextDate.setFullYear(nextDate.getFullYear() + 1);
      }
      nextDate.setMonth(targetMonth);
      nextDate.setDate(1); // First of the month
    }

    return nextDate.toISOString().split('T')[0];
  }

  /**
   * Map feature type to system category
   */
  private mapFeatureTypeToCategory(featureType: string): string {
    const mapping: Record<string, string> = {
      hvac: 'hvac',
      central_ac: 'hvac',
      furnace: 'hvac',
      heat_pump: 'hvac',
      boiler: 'hvac',
      mini_split: 'hvac',
      window_ac: 'hvac',
      water_heater: 'plumbing',
      tankless_water_heater: 'plumbing',
      well: 'plumbing',
      septic: 'plumbing',
      water_softener: 'plumbing',
      sump_pump: 'plumbing',
      fireplace: 'safety',
      wood_stove: 'safety',
      pellet_stove: 'safety',
      pool: 'exterior',
      hot_tub: 'exterior',
      irrigation_system: 'exterior',
      outdoor_kitchen: 'exterior',
      roof: 'roof',
      foundation: 'foundation',
      basement: 'basement',
      crawl_space: 'basement',
      attic: 'attic',
      deck: 'exterior',
      garage: 'garage',
      garage_door: 'garage',
      solar_panels: 'electrical',
      generator: 'electrical',
      security_system: 'safety',
      smart_home: 'electrical',
      radon_mitigation: 'safety',
      central_vacuum: 'interior',
      smoke_detector: 'safety',
      co_detector: 'safety',
      fire_extinguisher: 'safety',
      refrigerator: 'appliances',
      dishwasher: 'appliances',
      washing_machine: 'appliances',
      dryer: 'appliances',
      range: 'appliances',
      microwave: 'appliances',
      garbage_disposal: 'appliances',
      gutter: 'roof',
      siding: 'exterior',
      windows: 'windows_doors',
      doors: 'windows_doors',
      plumbing: 'plumbing',
      electrical: 'electrical',
    };

    return mapping[featureType] || 'other';
  }

  /**
   * Extract home features from a processed report and generate suggestions
   * Called after report processing is complete
   */
  async extractHomeFeaturesFromReport(
    reportId: string,
    householdId: string
  ): Promise<{ featuresExtracted: number; suggestionsGenerated: number }> {
    // "Can this member run inference" — their own connected key counts, so a
    // BYOK-only account still gets extraction when no managed key is set.
    if (!(await hasUsableProviderKey(this.env, this.userId, 'anthropic'))) {
      console.log('[MAINTENANCE-SUGGESTION] No usable AI key for this user, skipping feature extraction');
      return { featuresExtracted: 0, suggestionsGenerated: 0 };
    }

    // Get findings from the report
    const findingsResult = await this.rawDb
      .prepare('SELECT * FROM findings WHERE report_id = ?')
      .bind(reportId)
      .all<{
        id: string;
        system_category: string;
        title: string;
        description: string;
        plain_language_summary: string | null;
      }>();

    const findings = findingsResult.results || [];
    if (findings.length === 0) {
      return { featuresExtracted: 0, suggestionsGenerated: 0 };
    }

    // Build content for AI extraction
    const findingsContent = findings
      .map(f => `[${f.system_category.toUpperCase()}] ${f.title}\n${f.description}`)
      .join('\n\n');

    try {
      const { apiKey } = await resolveProviderApiKey(this.env, this.userId, 'anthropic');
      const claude = createProviderAdapter({
        provider: 'anthropic',
        apiKey,
        options: {
        onUsage: usageRecorderFor(this.env, {
          feature: 'maintenance_home_features',
          householdId,
          userId: this.userId,
        }),
      },
      }) as ClaudeProvider;

      // Use AI to extract home features
      const extractionResult = await claude.generateJSON<{
        features: Array<{
          feature_type: string;
          feature_subtype: string | null;
          quantity: number;
          location: string | null;
          brand: string | null;
          model: string | null;
          age_years: number | null;
          condition: string | null;
          notes: string | null;
          confidence: number;
        }>;
      }>({
        systemPrompt: `You are an expert at identifying home features from inspection report findings.
Extract all identifiable home features (HVAC, appliances, fireplaces, pools, water heaters, etc.) from the findings.
Return ONLY valid JSON with no explanation.`,
        userPrompt: `Extract all home features mentioned in these inspection findings:

${findingsContent}

Return JSON in this format:
{
  "features": [
    {
      "feature_type": "hvac" | "water_heater" | "fireplace" | "pool" | "septic" | "well" | "solar_panels" | "generator" | "security_system" | "garage_door" | "sump_pump" | "radon_mitigation" | etc,
      "feature_subtype": "gas" | "electric" | "wood_burning" | "tankless" | etc or null,
      "quantity": 1,
      "location": "basement" | "garage" | "attic" | "living room" | etc or null,
      "brand": "brand name" or null,
      "model": "model number" or null,
      "age_years": estimated age or null,
      "condition": "excellent" | "good" | "fair" | "poor" | "unknown",
      "notes": "any relevant notes" or null,
      "confidence": 0.0 to 1.0
    }
  ]
}`,
        maxTokens: 2000,
      });

      // Filter features with reasonable confidence and create them
      const validFeatures = extractionResult.features.filter(f => f.confidence >= 0.6);
      const timestamp = now();
      let featuresCreated = 0;

      for (const feature of validFeatures) {
        try {
          const id = generateId();
          await this.rawDb
            .prepare(
              `INSERT INTO home_features (
                id, household_id, feature_type, feature_subtype, quantity, location,
                brand, model, notes, condition, source, source_report_id, extraction_confidence,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              id,
              householdId,
              feature.feature_type,
              feature.feature_subtype,
              feature.quantity,
              feature.location,
              feature.brand,
              feature.model,
              feature.notes,
              feature.condition || 'unknown',
              'report_extraction',
              reportId,
              feature.confidence,
              timestamp,
              timestamp
            )
            .run();
          featuresCreated++;
        } catch (error) {
          console.error(`[MAINTENANCE-SUGGESTION] Failed to create feature ${feature.feature_type}:`, error);
        }
      }

      // Generate maintenance suggestions for the new features
      let suggestionsCreated = 0;
      if (featuresCreated > 0) {
        const suggestionResult = await this.generateSuggestionsForHousehold(householdId);
        suggestionsCreated = suggestionResult.generated;
      }

      console.log(`[MAINTENANCE-SUGGESTION] Extracted ${featuresCreated} features, generated ${suggestionsCreated} suggestions for report ${reportId}`);

      return { featuresExtracted: featuresCreated, suggestionsGenerated: suggestionsCreated };
    } catch (error) {
      console.error('[MAINTENANCE-SUGGESTION] Failed to extract features from report:', error);
      return { featuresExtracted: 0, suggestionsGenerated: 0 };
    }
  }
}
