import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import type { ClaudeProvider } from '../ai/claude-provider';
import { TASK_DRAFT_SYSTEM_PROMPT } from '../ai/prompts/generate-task-drafts';
import { createProviderAdapter } from '../ai/provider-factory';
import * as schema from '../db/schema';
import type { Database, Env } from '../types';
import { generateId, now } from '../utils/id';

import { resolveProviderApiKey } from './ai-credential-resolver';
import { usageRecorderFor } from './ai-usage-service';




/**
 * Task Draft Service
 *
 * Manages task drafts generated from report findings.
 * Users can review, sort, filter, and convert drafts to tasks.
 */
export class TaskDraftService {
  private db: Database;
  private env: Env;
  private userId: string | null;

  constructor(env: Env, d1: D1Database, userId?: string | null) {
    this.db = drizzle(d1, { schema });
    this.env = env;
    // Bill the acting user's own Anthropic key when connected (BYOK).
    this.userId = userId ?? null;
  }

  /**
   * Generate task drafts from report findings
   */
  async generateTaskDraftsFromReport(
    reportId: string,
    householdId: string
  ): Promise<{ draftsCreated: number; error?: string; errors?: string[] }> {
    try {
      // Get all findings for this report
      const findings = await this.db
        .select()
        .from(schema.findings)
        .where(eq(schema.findings.report_id, reportId))
        .all();

      if (findings.length === 0) {
        return { draftsCreated: 0, error: 'No findings found for report' };
      }

      // Initialize Claude — with the acting member's own key when they connected
      // one, so a BYOK-only account is not blocked by an absent managed key.
      const { apiKey } = await resolveProviderApiKey(this.env, this.userId, 'anthropic');
      if (!apiKey) {
        return { draftsCreated: 0, error: 'AI not configured' };
      }

      const claude = createProviderAdapter({
        provider: 'anthropic',
        apiKey,
        options: {
          onUsage: usageRecorderFor(this.env, {
            feature: 'task_drafts',
            householdId,
            userId: this.userId,
          }),
        },
      }) as ClaudeProvider;

      // Format findings for the prompt
      const findingsForPrompt = findings.map((f) => ({
        id: f.id,
        system_category: f.system_category,
        severity: f.severity,
        title: f.title,
        description: f.description,
        plain_language_summary: f.plain_language_summary,
        evidence_page_numbers: f.evidence_page_numbers
          ? JSON.parse(f.evidence_page_numbers)
          : [],
        location: f.location_description,
        urgency_score: f.urgency_score,
        impact: f.impact_description,
      }));

      // Generate task drafts for each finding individually to avoid large JSON parsing issues
      const timestamp = now();
      let draftsCreated = 0;
      const errors: string[] = [];

      for (const finding of findingsForPrompt) {
        try {
          const singleFindingPrompt = `Generate a task draft for this single finding:

${JSON.stringify(finding, null, 2)}

Return ONLY valid JSON with this exact structure:
{
  "finding_id": "${finding.id}",
  "title": "Action-oriented title",
  "description": "Detailed description",
  "plain_language_summary": "Why this matters",
  "system_category": "${finding.system_category}",
  "severity": "${finding.severity}",
  "priority_score": 1-100,
  "suggested_timeframe": "0-30_days|3-6_months|1_year|2-5_years|5-10_years",
  "suggested_frequency": "one_time|monthly|quarterly|yearly|custom",
  "is_recurring_suggestion": false,
  "estimated_cost_min": 15000,
  "estimated_cost_max": 50000,
  "diy_possible": false,
  "diy_difficulty": "easy|medium|hard|professional_only",
  "diy_cost_min": null,
  "diy_cost_max": null,
  "source_page_numbers": [],
  "source_quotes": ["Quote from finding"]
}`;

          const response = await claude.generateJSON<{
            finding_id: string;
            title: string;
            description: string;
            plain_language_summary: string;
            system_category: string;
            severity: string;
            priority_score: number;
            suggested_timeframe: string;
            suggested_frequency: string;
            is_recurring_suggestion: boolean;
            estimated_cost_min: number;
            estimated_cost_max: number;
            diy_possible: boolean;
            diy_difficulty: string;
            diy_cost_min: number | null;
            diy_cost_max: number | null;
            source_page_numbers: number[];
            source_quotes: string[];
          }>({
            systemPrompt: TASK_DRAFT_SYSTEM_PROMPT,
            userPrompt: singleFindingPrompt,
            model: 'claude-sonnet-4-5-20250929',
            maxTokens: 2048,
          });

          const draft = response;

          await this.db.insert(schema.taskDrafts).values({
            id: generateId(),
            household_id: householdId,
            report_id: reportId,
            finding_id: draft.finding_id,
            title: draft.title,
            description: draft.description,
            plain_language_summary: draft.plain_language_summary,
            system_category: draft.system_category,
            severity: draft.severity,
            priority_score: draft.priority_score,
            suggested_timeframe: draft.suggested_timeframe,
            suggested_frequency: draft.suggested_frequency,
            is_recurring_suggestion: draft.is_recurring_suggestion,
            estimated_cost_min: draft.estimated_cost_min,
            estimated_cost_max: draft.estimated_cost_max,
            diy_possible: draft.diy_possible,
            diy_difficulty: draft.diy_difficulty,
            diy_cost_min: draft.diy_cost_min,
            diy_cost_max: draft.diy_cost_max,
            source_page_numbers: JSON.stringify(draft.source_page_numbers || []),
            source_quotes: JSON.stringify(draft.source_quotes || []),
            status: 'draft',
            created_at: timestamp,
            updated_at: timestamp,
          });
          draftsCreated++;
        } catch (findingError) {
          console.error(`Failed to generate task draft for finding ${finding.id}:`, findingError);
          errors.push(`Finding ${finding.id}: ${findingError instanceof Error ? findingError.message : 'Unknown error'}`);
          // Continue with other findings even if one fails
        }
      }

      console.log(`[TASK-DRAFTS] Generated ${draftsCreated} drafts, ${errors.length} failures`);
      return { 
        draftsCreated,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      console.error('Failed to generate task drafts:', error);
      return {
        draftsCreated: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get task drafts with filtering and sorting
   */
  async getTaskDrafts(
    householdId: string,
    options: {
      reportId?: string;
      status?: 'draft' | 'converted' | 'dismissed';
      severity?: string;
      systemCategory?: string;
      sortBy?: 'severity' | 'category' | 'priority_score' | 'created_at';
      sortOrder?: 'asc' | 'desc';
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const {
      reportId,
      status = 'draft',
      severity,
      systemCategory,
      sortBy = 'priority_score',
      sortOrder = 'desc',
      limit = 100,
      offset = 0,
    } = options;

    // Build conditions
    const conditions = [eq(schema.taskDrafts.household_id, householdId)];

    if (reportId) {
      conditions.push(eq(schema.taskDrafts.report_id, reportId));
    }

    if (status) {
      conditions.push(eq(schema.taskDrafts.status, status));
    }

    if (severity) {
      conditions.push(eq(schema.taskDrafts.severity, severity));
    }

    if (systemCategory) {
      conditions.push(eq(schema.taskDrafts.system_category, systemCategory));
    }

    // Build sort
    let orderBy;
    const order = sortOrder === 'asc' ? asc : desc;

    switch (sortBy) {
      case 'severity':
        // Custom severity order: critical > major > minor > informational
        orderBy = sql`CASE
          WHEN ${schema.taskDrafts.severity} = 'critical' THEN 1
          WHEN ${schema.taskDrafts.severity} = 'major' THEN 2
          WHEN ${schema.taskDrafts.severity} = 'minor' THEN 3
          ELSE 4
        END ${sortOrder === 'desc' ? sql`DESC` : sql`ASC`}`;
        break;
      case 'category':
        orderBy = order(schema.taskDrafts.system_category);
        break;
      case 'priority_score':
        orderBy = order(schema.taskDrafts.priority_score);
        break;
      case 'created_at':
      default:
        orderBy = order(schema.taskDrafts.created_at);
    }

    const drafts = await this.db
      .select()
      .from(schema.taskDrafts)
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset)
      .all();

    // Get total count for pagination
    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.taskDrafts)
      .where(and(...conditions))
      .get();

    return {
      drafts,
      total: countResult?.count || 0,
      limit,
      offset,
    };
  }

  /**
   * Get task draft by ID
   */
  async getTaskDraft(draftId: string, householdId: string) {
    const draft = await this.db
      .select()
      .from(schema.taskDrafts)
      .where(
        and(
          eq(schema.taskDrafts.id, draftId),
          eq(schema.taskDrafts.household_id, householdId)
        )
      )
      .get();

    if (!draft) {
      return null;
    }

    // Get associated finding
    let finding = null;
    if (draft.finding_id) {
      finding = await this.db
        .select()
        .from(schema.findings)
        .where(eq(schema.findings.id, draft.finding_id))
        .get();
    }

    // Get associated images from report
    let images: any[] = [];
    if (draft.report_id) {
      images = await this.db
        .select()
        .from(schema.reportImages)
        .where(eq(schema.reportImages.report_id, draft.report_id))
        .all();

      // Filter to images on pages mentioned in draft
      if (draft.source_page_numbers) {
        const pageNumbers = JSON.parse(draft.source_page_numbers) as number[];
        images = images.filter(
          (img) => img.page_number && pageNumbers.includes(img.page_number)
        );
      }
    }

    return {
      ...draft,
      finding,
      images,
    };
  }

  /**
   * Get summary statistics for task drafts
   */
  async getTaskDraftsSummary(householdId: string, reportId?: string) {
    const conditions = [
      eq(schema.taskDrafts.household_id, householdId),
      eq(schema.taskDrafts.status, 'draft'),
    ];

    if (reportId) {
      conditions.push(eq(schema.taskDrafts.report_id, reportId));
    }

    const drafts = await this.db
      .select()
      .from(schema.taskDrafts)
      .where(and(...conditions))
      .all();

    const summary = {
      total: drafts.length,
      by_severity: {
        critical: 0,
        major: 0,
        minor: 0,
        informational: 0,
      },
      by_category: {} as Record<string, number>,
      total_cost_min: 0,
      total_cost_max: 0,
      diy_possible_count: 0,
      recurring_suggestions: 0,
    };

    for (const draft of drafts) {
      // Count by severity
      if (draft.severity in summary.by_severity) {
        summary.by_severity[draft.severity as keyof typeof summary.by_severity]++;
      }

      // Count by category
      if (!summary.by_category[draft.system_category]) {
        summary.by_category[draft.system_category] = 0;
      }
      summary.by_category[draft.system_category]++;

      // Sum costs
      summary.total_cost_min += draft.estimated_cost_min || 0;
      summary.total_cost_max += draft.estimated_cost_max || 0;

      // Count DIY possible
      if (draft.diy_possible) {
        summary.diy_possible_count++;
      }

      // Count recurring suggestions
      if (draft.is_recurring_suggestion) {
        summary.recurring_suggestions++;
      }
    }

    return summary;
  }

  /**
   * Convert task draft to maintenance task
   */
  async convertToMaintenanceTask(
    draftId: string,
    householdId: string,
    options: {
      addRecurring?: boolean;
      frequency?: string;
      startDate?: string;
    } = {}
  ) {
    const draft = await this.getTaskDraft(draftId, householdId);

    if (!draft) {
      throw new Error('Task draft not found');
    }

    if (draft.status !== 'draft') {
      throw new Error('Task draft already processed');
    }

    const timestamp = now();

    // Create maintenance task
    const taskId = generateId();
    await this.db.insert(schema.tasks).values({
      id: taskId,
      household_id: householdId,
      system_category: draft.system_category,
      title: draft.title,
      description: draft.description,
      frequency: options.addRecurring
        ? options.frequency || draft.suggested_frequency || 'yearly'
        : 'custom',
      next_due_date: options.startDate || timestamp,
      is_active: true,
      source: 'ai_generated',
      reminder_days_before: 7,
      suggested_by: 'report',
      suggestion_reason: `Generated from inspection report finding`,
      why_important: draft.plain_language_summary,
      created_at: timestamp,
      updated_at: timestamp,
    });

    // Update draft status
    await this.db
      .update(schema.taskDrafts)
      .set({
        status: 'converted',
        converted_to_task_id: taskId,
        converted_at: timestamp,
        updated_at: timestamp,
      })
      .where(eq(schema.taskDrafts.id, draftId));

    return { taskId };
  }

  /**
   * Bulk convert multiple drafts to tasks
   */
  async bulkConvert(draftIds: string[], householdId: string) {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const draftId of draftIds) {
      try {
        await this.convertToMaintenanceTask(draftId, householdId);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(
          `${draftId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return results;
  }

  /**
   * Dismiss a task draft
   */
  async dismissDraft(
    draftId: string,
    householdId: string,
    reason?: string
  ) {
    const timestamp = now();

    await this.db
      .update(schema.taskDrafts)
      .set({
        status: 'dismissed',
        dismissed_reason: reason,
        dismissed_at: timestamp,
        updated_at: timestamp,
      })
      .where(
        and(
          eq(schema.taskDrafts.id, draftId),
          eq(schema.taskDrafts.household_id, householdId)
        )
      );

    return { success: true };
  }

  /**
   * Delete a task draft
   */
  async deleteDraft(draftId: string, householdId: string) {
    await this.db
      .delete(schema.taskDrafts)
      .where(
        and(
          eq(schema.taskDrafts.id, draftId),
          eq(schema.taskDrafts.household_id, householdId)
        )
      );

    return { success: true };
  }
}

// Add the taskDrafts table to the schema export
// This should be added to src/db/schema.ts:
/*
export const taskDrafts = sqliteTable(
  'task_drafts',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id').notNull(),
    report_id: text('report_id').notNull(),
    finding_id: text('finding_id'),
    title: text('title').notNull(),
    description: text('description'),
    plain_language_summary: text('plain_language_summary'),
    system_category: text('system_category').notNull(),
    severity: text('severity').notNull(),
    priority_score: integer('priority_score'),
    suggested_timeframe: text('suggested_timeframe'),
    suggested_frequency: text('suggested_frequency'),
    is_recurring_suggestion: integer('is_recurring_suggestion'),
    estimated_cost_min: integer('estimated_cost_min'),
    estimated_cost_max: integer('estimated_cost_max'),
    diy_possible: integer('diy_possible'),
    diy_difficulty: text('diy_difficulty'),
    diy_cost_min: integer('diy_cost_min'),
    diy_cost_max: integer('diy_cost_max'),
    source_page_numbers: text('source_page_numbers'),
    source_quotes: text('source_quotes'),
    image_ids: text('image_ids'),
    status: text('status'),
    converted_to_task_id: text('converted_to_task_id'),
    dismissed_reason: text('dismissed_reason'),
    dismissed_at: text('dismissed_at'),
    converted_at: text('converted_at'),
    created_at: text('created_at'),
    updated_at: text('updated_at'),
  }
);
*/
