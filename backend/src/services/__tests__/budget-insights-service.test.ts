/**
 * budget-insights-service.ts — AI narrative insights with input-hash caching.
 *
 * Covers: first call generates + caches (cached:false), a second call with
 * unchanged inputs serves the cache without calling the AI provider again,
 * forceRefresh bypasses the cache, and changed inputs invalidate it even
 * within the freshness window. No live AI calls — the provider is mocked.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AIProvider } from '../../ai/provider';
import * as schema from '../../db/schema';
import { budgetGoals } from '../../db/schema-budget';
import { createBudgetTables, resetBudgetTables } from '../../routes/__tests__/budget-test-helpers';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { BudgetInsightsService } from '../budget-insights-service';

const testEnv = env as unknown as Env;
const HID = 'hh_budget_insights_01';
const UID = 'u_budget_insights_owner';
const MID = 'm_budget_insights_owner';

function mockProvider(): { provider: AIProvider; generateStructured: ReturnType<typeof vi.fn> } {
  const generateStructured = vi.fn(async () => ({
    summary: 'You are on track this month.',
    alerts: [],
    recommendations: [],
    projected_month_end_balance: 10000,
  }));
  return {
    provider: { generateStructured } as unknown as AIProvider,
    generateStructured,
  };
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({ id: UID, email: 'bi@example.com', email_verified: true });
  await db.insert(schema.households).values({ id: HID, name: 'BudgetInsightsTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
  const now = new Date().toISOString();
  await db.insert(budgetGoals).values({
    id: 'goal-1',
    household_id: HID,
    year: 2026,
    month: 6,
    planned_budget: 100000,
    actual_spent: 0,
    created_at: now,
    updated_at: now,
  });
}

describe('BudgetInsightsService', () => {
  beforeEach(seed);

  it('generates fresh insights on first call and persists the cache', async () => {
    const { provider, generateStructured } = mockProvider();
    const service = new BudgetInsightsService(testEnv, testEnv.DB, provider);

    const result = await service.getInsights(HID, UID, 2026, 6);

    expect(result.cached).toBe(false);
    expect(result.summary).toBe('You are on track this month.');
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it('serves the cached payload on a second call with unchanged inputs', async () => {
    const { provider, generateStructured } = mockProvider();
    const service = new BudgetInsightsService(testEnv, testEnv.DB, provider);

    await service.getInsights(HID, UID, 2026, 6);
    const second = await service.getInsights(HID, UID, 2026, 6);

    expect(second.cached).toBe(true);
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh bypasses the cache even when inputs are unchanged', async () => {
    const { provider, generateStructured } = mockProvider();
    const service = new BudgetInsightsService(testEnv, testEnv.DB, provider);

    await service.getInsights(HID, UID, 2026, 6);
    const second = await service.getInsights(HID, UID, 2026, 6, true);

    expect(second.cached).toBe(false);
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });

  it('regenerates when the underlying inputs change, even within the freshness window', async () => {
    const { provider, generateStructured } = mockProvider();
    const service = new BudgetInsightsService(testEnv, testEnv.DB, provider);

    await service.getInsights(HID, UID, 2026, 6);

    // Raise the monthly cap — changes plannedBudget, which feeds the input hash.
    const db = drizzle(testEnv.DB, { schema: { budgetGoals } });
    await db.update(budgetGoals).set({ planned_budget: 200000 }).where(eq(budgetGoals.id, 'goal-1'));

    const second = await service.getInsights(HID, UID, 2026, 6);
    expect(second.cached).toBe(false);
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });
});
