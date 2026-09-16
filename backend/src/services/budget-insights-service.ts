import { eq, and } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { generateStructuredWithFallback } from '../ai/fallback';
import {
  buildBudgetInsightsUserPrompt,
  BUDGET_INSIGHTS_SCHEMA,
  BUDGET_INSIGHTS_SYSTEM_PROMPT,
  type BudgetInsightResult,
} from '../ai/prompts/budget-insights';
import type { AIProvider } from '../ai/provider';
import { createProviderAdapter } from '../ai/provider-factory';
import { budgetInsights, type BudgetInsight } from '../db/schema-budget';
import type { Env } from '../types';
import { budgetDebug, newTraceId } from '../utils/budget-debug';
import { nowIso } from '../utils/id';
import { hashToken } from '../utils/password';

import { resolveProviderApiKey } from './ai-credential-resolver';
import { usageRecorderFor } from './ai-usage-service';
import { BudgetService } from './budget-service';

const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface BudgetInsightsResponse extends BudgetInsightResult {
  generatedAt: string;
  cached: boolean;
}

export class BudgetInsightsService {
  private db: DrizzleD1Database;
  private env: Env;
  private budgetService: BudgetService;
  private injectedAi?: AIProvider;

  /** `aiProvider` is injectable for tests; production call sites omit it. */
  constructor(env: Env, d1: D1Database, aiProvider?: AIProvider) {
    this.env = env;
    this.db = drizzle(d1);
    this.budgetService = new BudgetService(env, d1);
    this.injectedAi = aiProvider;
  }

  /**
   * Anthropic provider bound to the acting user: their own connected BYOK key
   * when present, else the SimpleHouse-managed key. Test-injected provider wins.
   */
  private async aiFor(
    householdId: string,
    userId: string | null | undefined
  ): Promise<AIProvider> {
    if (this.injectedAi) return this.injectedAi;
    const { apiKey } = await resolveProviderApiKey(this.env, userId, 'anthropic');
    return createProviderAdapter({
      provider: 'anthropic',
      apiKey,
      options: {
        onUsage: usageRecorderFor(this.env, {
          feature: 'budget_insights',
          householdId,
          userId,
        }),
      },
    });
  }

  async getInsights(
    householdId: string,
    userId: string,
    year: number,
    month: number,
    forceRefresh = false
  ): Promise<BudgetInsightsResponse> {
    const trace = newTraceId();
    // getMonthlyOverview performs the household-access check internally.
    const overview = await this.budgetService.getMonthlyOverview(householdId, userId, year, month);
    const period = `${year}-${String(month).padStart(2, '0')}`;
    budgetDebug(this.env, 'insights', {
      trace,
      stage: 'start',
      householdId,
      userId,
      period,
      forceRefresh,
      plannedBudget: overview.plannedBudget,
      actualSpent: overview.actualSpent,
      committedTotal: overview.committedTotal,
      remainingBudget: overview.remainingBudget,
      savedTotal: overview.savedTotal,
      affordableCount: overview.affordability.affordable.length,
      deferredCount: overview.affordability.deferred.length,
    });

    const inputHash = await hashToken(
      JSON.stringify({
        plannedBudget: overview.plannedBudget,
        actualSpent: overview.actualSpent,
        committedTotal: overview.committedTotal,
        remainingBudget: overview.remainingBudget,
        affordable: overview.affordability.affordable.map((i) => i.id),
        deferred: overview.affordability.deferred.map((i) => i.id),
      })
    );

    if (!forceRefresh) {
      const existing = await this.db
        .select()
        .from(budgetInsights)
        .where(and(eq(budgetInsights.household_id, householdId), eq(budgetInsights.period, period)))
        .get();

      if (existing && existing.input_hash === inputHash && this.isFresh(existing.generated_at)) {
        budgetDebug(this.env, 'insights', {
          trace,
          stage: 'cache-hit',
          period,
          generatedAt: existing.generated_at,
        });
        return { ...(JSON.parse(existing.insight_json) as BudgetInsightResult), generatedAt: existing.generated_at, cached: true };
      }
    }

    const aiStart = Date.now();
    budgetDebug(this.env, 'insights.ai', {
      trace,
      stage: 'request',
      period,
      primaryModel: this.env.AIHOUSEKEEPER_NUDGE_MODEL,
      fallbackModel: this.env.AIHOUSEKEEPER_FALLBACK_MODEL,
    });

    const ai = await this.aiFor(householdId, userId);
    const result = await generateStructuredWithFallback<BudgetInsightResult>(
      ai,
      this.env.AIHOUSEKEEPER_NUDGE_MODEL,
      this.env.AIHOUSEKEEPER_FALLBACK_MODEL,
      {
        systemPrompt: BUDGET_INSIGHTS_SYSTEM_PROMPT,
        userPrompt: buildBudgetInsightsUserPrompt({
          year,
          month,
          plannedBudget: overview.plannedBudget,
          actualSpent: overview.actualSpent,
          committedTotal: overview.committedTotal,
          remainingBudget: overview.remainingBudget,
          affordableItems: overview.affordability.affordable.map((i) => ({
            title: i.title,
            priority: i.priority,
            estimatedCost: i.estimatedCost,
          })),
          deferredItems: overview.affordability.deferred.map((i) => ({
            title: i.title,
            priority: i.priority,
            estimatedCost: i.estimatedCost,
          })),
        }),
        schema: BUDGET_INSIGHTS_SCHEMA,
        maxTokens: 1024,
      }
    );

    budgetDebug(this.env, 'insights.ai', {
      trace,
      stage: 'response',
      period,
      elapsedMs: Date.now() - aiStart,
      summaryLength: result.summary?.length ?? 0,
      summaryPreview: result.summary?.slice(0, 300) ?? null,
      result,
    });

    await this.upsertCache(householdId, period, result, inputHash);

    return { ...result, generatedAt: nowIso(), cached: false };
  }

  private isFresh(generatedAt: string): boolean {
    const generated = new Date(generatedAt).getTime();
    if (Number.isNaN(generated)) return false;
    return Date.now() - generated < FRESHNESS_WINDOW_MS;
  }

  private async upsertCache(
    householdId: string,
    period: string,
    result: BudgetInsightResult,
    inputHash: string
  ): Promise<void> {
    const now = nowIso();

    const existing = await this.db
      .select()
      .from(budgetInsights)
      .where(and(eq(budgetInsights.household_id, householdId), eq(budgetInsights.period, period)))
      .get();

    if (existing) {
      await this.db
        .update(budgetInsights)
        .set({
          insight_text: result.summary,
          insight_json: JSON.stringify(result),
          input_hash: inputHash,
          generated_at: now,
        })
        .where(eq(budgetInsights.id, existing.id));
      return;
    }

    const row: BudgetInsight = {
      id: crypto.randomUUID(),
      household_id: householdId,
      period,
      insight_text: result.summary,
      insight_json: JSON.stringify(result),
      input_hash: inputHash,
      generated_at: now,
      created_at: now,
    };
    await this.db.insert(budgetInsights).values(row);
  }
}
